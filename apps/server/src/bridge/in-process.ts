import {
	createAgentSession,
	discoverAuthStorage,
	ModelRegistry,
	SessionManager,
	settings as ompSettings,
	type AgentSession,
} from "@oh-my-pi/pi-coding-agent";
// `Model` is owned by `@oh-my-pi/pi-ai`, a transitive dep we don't bring in
// directly. Treat it as opaque at the bridge boundary — we only ever pass it
// back into the SDK's own methods.
type SdkModel = {
	id: string;
	name?: string;
	provider: string | { toString(): string };
	contextWindow?: number;
	input?: unknown[];
};
import { executeAcpBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import type {
	AgentMessageJson,
	AgentSessionEventJson,
	ModelInfo,
	ModelRef,
	SessionSnapshot,
	SessionSummary,
} from "@omp-deck/protocol";

import { logger } from "../log.ts";
import type {
	AgentBridge,
	CreateSessionOpts,
	EventListener,
	ResumeSessionOpts,
	RuntimeEnvUpdate,
	SessionHandle,
	SlashDispatchResult,
} from "./types.ts";

const log = logger("bridge:in-process");

/**
 * System-prompt block prepended to every omp session created or resumed via
 * this bridge. Tells the agent omp-deck exists, where to find its REST API,
 * and how the kanban / cron / inbox surfaces are shaped — so it can read and
 * mutate them via `bash` + `curl` without needing the user to re-explain.
 */
const OMP_DECK_CONTEXT = `# omp-deck context

You are running inside an omp-deck session. omp-deck is a local web UI for
the omp coding agent that also exposes a kanban, cron scheduler, and inbox
over HTTP on the loopback interface.

Local API base: http://127.0.0.1:8787/api  (use the \`bash\` tool with \`curl\`).

## Tasks (kanban)
- GET    /api/tasks                 → { tasks, states }
- POST   /api/tasks                 { title, body?, stateId?, cwd? }
- PATCH  /api/tasks/:id             { title?, body?, stateId?, cwd?, archived? }
- DELETE /api/tasks/:id
- POST   /api/tasks/:id/move        { stateId, index }
- GET/POST/PATCH/DELETE /api/task-states  (kanban columns; user-configurable)
- States are user-defined; default seed is backlog / active / blocked / done.
  Always fetch /api/task-states before assuming column ids.

## Routines (cron scheduler)
- GET    /api/routines              → { routines }
- POST   /api/routines              { name, cron, actionKind, actionBody, actionCwd?, enabled? }
- PATCH  /api/routines/:id          { …same fields, all optional }
- DELETE /api/routines/:id
- POST   /api/routines/:id/run      → fire now (out of schedule)
- GET    /api/routines/:id/runs?limit=N
- actionKind ∈ { "bash", "script", "prompt" }. \`prompt\` runs \`omp -p\` headless.

## Inbox
- GET    /api/inbox?kind=&includeProcessed=
- POST   /api/inbox                 { kind, title, body?, source? }
- PATCH  /api/inbox/:id             { kind?, title?, body?, source?, processed? }
- DELETE /api/inbox/:id
- kind ∈ { email, ticket, idea, decision, investigation, capture }

## Conventions
- All timestamps ISO-8601 UTC.
- IDs are app-generated strings; do not synthesize them.
- When the user asks about "tasks", "routines", or "inbox" without qualifier,
  they mean these REST surfaces — not files on disk.
- Before mutating, GET the current state. After mutating, briefly confirm.
`;


interface Active {
	handle: InProcessSessionHandle;
	session: AgentSession;
	unsubscribe: () => void;
	/** Wall-clock ms of the last user-visible activity on this session. */
	lastActivityAt: number;
	/** True between turn_start and turn_end — never reap mid-turn. */
	turnInFlight: boolean;
	/** Set of WS connection ids currently subscribed. Reaping requires zero subscribers. */
	subscribers: Set<string>;
}

export class InProcessAgentBridge implements AgentBridge {
	private active = new Map<string, Active>();
	private disposed = false;
	private reaperTimer: ReturnType<typeof setInterval> | null = null;
	private idleTimeoutMs: number;
	private readonly reapIntervalMs: number;
	private autoStartCommand: string | null;
	/** Prompts queued to fire as soon as the named session gets its first WS subscriber. */
	private pendingAutoPrompts = new Map<string, string>();
	/** Shared SDK model registry, lazily constructed on first session create. */
	private modelRegistry: ModelRegistry | undefined;
	private modelRegistryPromise: Promise<ModelRegistry> | undefined;

	constructor(opts: {
		idleTimeoutMs?: number;
		reapIntervalMs?: number;
		autoStartCommand?: string | null;
	} = {}) {
		this.idleTimeoutMs = opts.idleTimeoutMs ?? 15 * 60_000; // 15 min default
		this.reapIntervalMs = opts.reapIntervalMs ?? 60_000; // scan once a minute
		this.autoStartCommand = opts.autoStartCommand ?? "/start";
		if (this.idleTimeoutMs > 0) this.startReaper();
	}

	async createSession(opts: CreateSessionOpts): Promise<SessionHandle> {
		const sessionManager = SessionManager.create(opts.cwd);
		const modelRegistry = await this.ensureModelRegistry();
		const result = await createAgentSession({
			cwd: opts.cwd,
			sessionManager,
			modelRegistry,
			authStorage: modelRegistry.authStorage,
			// Skip eval-tool Python warmup on session create. On Windows this otherwise
			// flashes a python.exe console window each turn-zero; on demand spawn is fine.
			skipPythonPreflight: true,
			systemPrompt: (defaults) => [OMP_DECK_CONTEXT, ...defaults],
			// `opts.model` is a ModelRef ({provider,id}); the SDK's `model` option expects a
			// fully-shaped Model — resolve via the registry when present.
			...(opts.model
				? (() => {
						const m = modelRegistry.find(opts.model!.provider, opts.model!.id);
						return m ? { model: m } : {};
					})()
				: {}),
		});

		const session = result.session;
		const handle = this.attach(session, opts.cwd, sessionManager);
		if (!opts.suppressAutoStart && this.autoStartCommand) {
			this.pendingAutoPrompts.set(handle.sessionId, this.autoStartCommand);
		}
		log.info(`created session ${handle.sessionId} cwd=${opts.cwd}`);
		return handle;
	}

	async resumeSession(opts: ResumeSessionOpts): Promise<SessionHandle> {
		const sessionManager = await SessionManager.open(opts.sessionPath);
		const cwd = (sessionManager.getCwd?.() as string | undefined) ?? process.cwd();
		const modelRegistry = await this.ensureModelRegistry();
		const result = await createAgentSession({
			cwd,
			sessionManager,
			modelRegistry,
			authStorage: modelRegistry.authStorage,
			skipPythonPreflight: true,
			systemPrompt: (defaults) => [OMP_DECK_CONTEXT, ...defaults],
		});
		const session = result.session;
		const handle = this.attach(session, cwd, sessionManager);
		log.info(`resumed session ${handle.sessionId} from ${opts.sessionPath}`);
		return handle;
	}

	getSession(sessionId: string): SessionHandle | undefined {
		return this.active.get(sessionId)?.handle;
	}

	async listSessions(opts: { cwd?: string }): Promise<SessionSummary[]> {
		const raw = opts.cwd
			? await SessionManager.list(opts.cwd)
			: await SessionManager.listAll();
		return raw.map((r: any) => summarize(r));
	}

	private ensureModelRegistry(): Promise<ModelRegistry> {
		if (this.modelRegistry) return Promise.resolve(this.modelRegistry);
		if (this.modelRegistryPromise) return this.modelRegistryPromise;
		this.modelRegistryPromise = (async () => {
			const auth = await discoverAuthStorage();
			const registry = new ModelRegistry(auth);
			// `cache` reads models.json + built-ins synchronously without hitting
			// each provider's discovery endpoint — fast deck boot; background
			// refresh runs after the registry is reachable so the catalog stays
			// fresh without blocking the first model lookup.
			await registry.refresh("offline");
			registry.refreshInBackground("online");
			this.modelRegistry = registry;
			return registry;
		})();
		return this.modelRegistryPromise;
	}

	async listModels(opts: { sessionId?: string } = {}): Promise<ModelInfo[]> {
		const registry = await this.ensureModelRegistry();
		const current = opts.sessionId ? this.active.get(opts.sessionId)?.handle.snapshot().model : undefined;
		return registry.getAll().map((model) => modelInfoFromSdk(model as unknown as SdkModel, registry, current));
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		if (this.reaperTimer) {
			clearInterval(this.reaperTimer);
			this.reaperTimer = null;
		}
		log.info(`disposing ${this.active.size} active session(s)`);
		const disposals = Array.from(this.active.values()).map((a) =>
			a.handle.dispose().catch((err) => log.warn(`dispose failed`, err)),
		);
		await Promise.all(disposals);
		this.active.clear();
		this.pendingAutoPrompts.clear();
	}

	/** Called by the WS hub when a connection subscribes. Pin the session against the reaper. */
	trackSubscriberAdded(sessionId: string, connectionId: string): void {
		const a = this.active.get(sessionId);
		if (!a) return;
		const wasEmpty = a.subscribers.size === 0;
		a.subscribers.add(connectionId);
		a.lastActivityAt = Date.now();

		// First subscriber attached — flush any queued auto-prompt. Defer one
		// macrotask so the WS layer has flushed the `subscribed` snapshot frame
		// before the agent starts emitting `agent_start` / `message_*`.
		if (wasEmpty) {
			const pending = this.pendingAutoPrompts.get(sessionId);
			if (pending !== undefined) {
				this.pendingAutoPrompts.delete(sessionId);
				setTimeout(() => {
					a.handle.prompt(pending).catch((err) =>
						log.warn(`auto-start prompt failed for ${sessionId}`, err),
					);
				}, 50);
			}
		}
	}

	/** Called by the WS hub on unsubscribe / connection close. */
	trackSubscriberRemoved(sessionId: string, connectionId: string): void {
		const a = this.active.get(sessionId);
		if (!a) return;
		a.subscribers.delete(connectionId);
		a.lastActivityAt = Date.now();
	}

	/** Bumps last-activity to now; called from prompt / abort / explicit access. */
	bumpActivity(sessionId: string): void {
		const a = this.active.get(sessionId);
		if (!a) return;
		a.lastActivityAt = Date.now();
	}

	applyEnvUpdate(update: RuntimeEnvUpdate): void {
		if (update.autoStartCommand !== undefined) {
			this.autoStartCommand = update.autoStartCommand;
			log.info(`hot-applied autoStartCommand`, { enabled: Boolean(update.autoStartCommand) });
		}
		if (update.idleTimeoutMs !== undefined && update.idleTimeoutMs !== this.idleTimeoutMs) {
			this.idleTimeoutMs = update.idleTimeoutMs;
			if (this.reaperTimer) {
				clearInterval(this.reaperTimer);
				this.reaperTimer = null;
			}
			if (this.idleTimeoutMs > 0) this.startReaper();
			log.info(`hot-applied idleTimeoutMs`, { idleTimeoutMs: this.idleTimeoutMs });
		}
	}

	private startReaper(): void {
		this.reaperTimer = setInterval(() => {
			this.reapIdle().catch((err) => log.warn(`reaper failed`, err));
		}, this.reapIntervalMs);
		// Don't keep the event loop alive for the timer alone.
		(this.reaperTimer as unknown as { unref?: () => void }).unref?.();
	}

	private async reapIdle(): Promise<void> {
		if (this.disposed) return;
		const now = Date.now();
		const cutoff = now - this.idleTimeoutMs;
		const candidates: Active[] = [];
		for (const a of this.active.values()) {
			if (a.turnInFlight) continue;
			if (a.subscribers.size > 0) continue;
			if (a.lastActivityAt > cutoff) continue;
			candidates.push(a);
		}
		if (candidates.length === 0) return;
		log.info(`reaping ${candidates.length} idle session(s)`);
		await Promise.all(
			candidates.map((a) =>
				a.handle.dispose().catch((err) => log.warn(`reap dispose failed`, err)),
			),
		);
	}

	private attach(session: AgentSession, cwd: string, sessionManager: SessionManager): InProcessSessionHandle {
		const sessionId = (session as any).sessionId as string;
		const handle = new InProcessSessionHandle({
			session,
			sessionManager,
			cwd,
			sessionId,
			getModelRegistry: () => this.ensureModelRegistry(),
			onDispose: () => {
				this.active.delete(sessionId);
				this.pendingAutoPrompts.delete(sessionId);
			},
		});

		// Bridge SDK events to handle's listeners, AND to bridge-internal activity
		// tracking so the reaper sees real agent work and won't kill an in-flight turn.
		const unsubscribe = session.subscribe((event) => {
			const entry = this.active.get(sessionId);
			if (entry) {
				entry.lastActivityAt = Date.now();
				const type = (event as { type?: string })?.type;
				if (type === "turn_start") entry.turnInFlight = true;
				else if (type === "turn_end" || type === "agent_end") entry.turnInFlight = false;
			}
			handle.emit(event as unknown as AgentSessionEventJson);
			// After the SDK's own event reaches subscribers, fire a synthetic
			// `context_usage` event on the moments where the underlying number
			// changes: a turn finishing (fresh assistant usage now available)
			// or a compaction completing (post-compaction context shrunk).
			const type = (event as { type?: string })?.type;
			if (type === "turn_end" || type === "agent_end" || type === "compaction_complete") {
				const usage = handle.getContextUsage();
				if (usage) {
					handle.emit({ type: "context_usage", contextUsage: usage } as unknown as AgentSessionEventJson);
				}
			}
		});

		this.active.set(sessionId, {
			handle,
			session,
			unsubscribe,
			lastActivityAt: Date.now(),
			turnInFlight: false,
			subscribers: new Set(),
		});
		return handle;
	}
}

class InProcessSessionHandle implements SessionHandle {
	readonly sessionId: string;
	readonly cwd: string;
	private session: AgentSession;
	private readonly sessionManager: SessionManager;
	private readonly modelRegistryRef: () => Promise<ModelRegistry>;
	private listeners = new Set<EventListener>();
	private onDisposeCallback: () => void;
	private disposed = false;

	constructor(args: {
		session: AgentSession;
		sessionManager: SessionManager;
		cwd: string;
		sessionId: string;
		getModelRegistry: () => Promise<ModelRegistry>;
		onDispose: () => void;
	}) {
		this.session = args.session;
		this.sessionManager = args.sessionManager;
		this.cwd = args.cwd;
		this.sessionId = args.sessionId;
		this.modelRegistryRef = args.getModelRegistry;
		this.onDisposeCallback = args.onDispose;
	}

	get sessionFile(): string | undefined {
		return (this.session as any).sessionFile as string | undefined;
	}

	subscribe(listener: EventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: AgentSessionEventJson): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (err) {
				log.warn(`listener failed`, err);
			}
		}
	}

	snapshot(): SessionSnapshot {
		const s = this.session as any;
		const usage = this.getContextUsage();
		const snap: SessionSnapshot = {
			sessionId: this.sessionId,
			sessionFile: this.sessionFile,
			sessionName: typeof s.sessionName === "string" ? s.sessionName : undefined,
			cwd: this.cwd,
			model:
				s.model && typeof s.model === "object"
					? { provider: String(s.model.provider), id: String(s.model.id) }
					: undefined,
			thinkingLevel: typeof s.thinkingLevel === "string" ? s.thinkingLevel : undefined,
			isStreaming: Boolean(s.isStreaming),
			messages: Array.isArray(s.messages) ? (s.messages as AgentMessageJson[]) : [],
			todoPhases: typeof s.getTodoPhases === "function" ? s.getTodoPhases() : [],
		};
		if (usage) snap.contextUsage = usage;
		return snap;
	}

	getContextUsage(): import("@omp-deck/protocol").ContextUsage | undefined {
		// The SDK exposes `session.getContextUsage()` returning
		// `{ tokens: number | null, contextWindow: number, percent: number | null }`
		// or `undefined` when the model has no declared window. We pass it through
		// verbatim — the deck's protocol type mirrors the SDK shape.
		const s = this.session as unknown as {
			getContextUsage?: () => import("@omp-deck/protocol").ContextUsage | undefined;
		};
		if (typeof s.getContextUsage !== "function") return undefined;
		try {
			return s.getContextUsage();
		} catch (err) {
			log.warn(`getContextUsage threw`, err);
			return undefined;
		}
	}

	async compact(focus?: string): Promise<void> {
		// `session.compact(customInstructions?)` is the public SDK entry. The
		// SDK guards against concurrent compactions itself (throws "Compaction
		// already in progress") — we surface that error to the caller as-is so
		// the UI can show it.
		const s = this.session as unknown as {
			compact?: (customInstructions?: string) => Promise<unknown>;
		};
		if (typeof s.compact !== "function") {
			throw new Error("session.compact is not available on this SDK build");
		}
		await s.compact(focus && focus.trim().length > 0 ? focus.trim() : undefined);
	}

	async setModel(ref: ModelRef): Promise<void> {
		const registry = await this.modelRegistryRef();
		const model = registry.find(ref.provider, ref.id);
		if (!model) throw new Error(`unknown model: ${ref.provider}/${ref.id}`);
		if (!registry.hasConfiguredAuth(model)) {
			throw new Error(`no auth configured for ${ref.provider}/${ref.id}`);
		}
		const s = this.session as unknown as {
			setModel?: (model: unknown, role?: string) => Promise<void>;
		};
		if (typeof s.setModel !== "function") {
			throw new Error("session.setModel is not available on this SDK build");
		}
		await s.setModel(model);
		// Synthetic event so WS subscribers refresh the session header's model
		// label without waiting for the next assistant turn.
		this.emit({ type: "session_updated", snapshot: this.snapshot() } as unknown as AgentSessionEventJson);
	}

	async dispatchDeckSlashCommand(text: string): Promise<SlashDispatchResult> {
		if (!text.startsWith("/")) return { kind: "fallthrough" };
		let result: import("../deck-slash-commands.ts").DeckSlashResult | "fallthrough";
		try {
			const { executeDeckSlashCommand } = await import("../deck-slash-commands.ts");
			result = await executeDeckSlashCommand(text, { cwd: this.cwd });
		} catch (err) {
			const message = `Slash command error: ${String((err as Error).message ?? err)}`;
			log.warn(`deck slash dispatch threw for ${text.slice(0, 40)}: ${String(err)}`);
			this.emitSyntheticSlashRoundTrip(text, message);
			return { kind: "consumed", output: message };
		}
		if (result === "fallthrough") return { kind: "fallthrough" };
		this.emitSyntheticSlashRoundTrip(text, result.output || "Done.");
		return { kind: "consumed", output: result.output || "Done." };
	}

	async dispatchSlashCommand(text: string): Promise<SlashDispatchResult> {
		if (!text.startsWith("/")) return { kind: "fallthrough" };
		const chunks: string[] = [];
		const runtime = {
			session: this.session,
			sessionManager: this.sessionManager,
			settings: ompSettings,
			cwd: this.cwd,
			output: (line: string) => {
				if (line) chunks.push(line);
			},
			refreshCommands: () => {},
			reloadPlugins: async () => {},
		};
		let result: unknown;
		try {
			result = await executeAcpBuiltinSlashCommand(text, runtime as unknown as Parameters<typeof executeAcpBuiltinSlashCommand>[1]);
		} catch (err) {
			const message = `Slash command error: ${String((err as Error).message ?? err)}`;
			log.warn(`slash dispatch threw for ${text.slice(0, 40)}: ${String(err)}`);
			this.emitSyntheticSlashRoundTrip(text, message);
			return { kind: "consumed", output: message };
		}
		const output = chunks.join("\n").trim();
		if (result === false) return { kind: "fallthrough" };
		if (result && typeof result === "object" && "prompt" in result && typeof (result as { prompt: unknown }).prompt === "string") {
			this.emitSyntheticSlashRoundTrip(text, output || undefined);
			return { kind: "rewritten", output, prompt: (result as { prompt: string }).prompt };
		}
		const final = output || "Done.";
		this.emitSyntheticSlashRoundTrip(text, final);
		return { kind: "consumed", output: final };
	}

	private emitSyntheticSlashRoundTrip(userText: string, assistantText: string | undefined): void {
		const now = Date.now();
		this.emit({
			type: "message_start",
			message: {
				role: "user",
				content: userText,
				timestamp: now,
				synthetic: true,
			},
		} as unknown as AgentSessionEventJson);
		if (!assistantText) return;
		this.emit({
			type: "message_start",
			message: {
				role: "assistant",
				content: [{ type: "text", text: assistantText }],
				timestamp: now,
				synthetic: true,
			},
		} as unknown as AgentSessionEventJson);
	}

	async prompt(
		text: string,
		opts?: { streamingBehavior?: "steer" | "followUp"; images?: import("@omp-deck/protocol").ImageAttachment[] },
	): Promise<void> {
		const promptOpts: Record<string, unknown> = {};
		if (opts?.streamingBehavior) promptOpts.streamingBehavior = opts.streamingBehavior;
		if (opts?.images && opts.images.length > 0) promptOpts.images = opts.images;
		await this.session.prompt(text, Object.keys(promptOpts).length > 0 ? (promptOpts as any) : undefined);
	}

	async abort(): Promise<void> {
		await this.session.abort();
	}

	async setName(name: string): Promise<void> {
		// The omp SDK signature is `setSessionName(name, source?: "auto" | "user")`
		// and defaults `source` to `"auto"`. Auto-titled names are silently
		// overwritten the next time the input-controller's title generator fires
		// (typically after the first agent turn completes), so a user-supplied
		// rename made before that point would disappear once `/start` finishes.
		// Pass `"user"` so the name takes permanent precedence per SDK contract.
		const s = this.session as unknown as {
			setSessionName?: (n: string, source?: "auto" | "user") => Promise<boolean> | boolean;
		};
		if (typeof s.setSessionName !== "function") {
			throw new Error("session.setSessionName is not available on this SDK build");
		}
		const accepted = await s.setSessionName(name, "user");
		if (accepted === false) {
			throw new Error(`session rejected name (empty after sanitization?): ${JSON.stringify(name)}`);
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.listeners.clear();
		try {
			await this.session.dispose();
		} catch (err) {
			log.warn(`session.dispose threw`, err);
		}
		this.onDisposeCallback();
	}
}

/** Normalize a SessionManager.list / listAll record into our SessionSummary. */
function summarize(raw: any): SessionSummary {
	// omp's list returns objects like:
	//   { id, path, cwd, title?, timestamp, messageCount?, modifiedAt? }
	const id = String(raw.id ?? raw.sessionId ?? raw.header?.id ?? "");
	const filePath = String(raw.path ?? raw.file ?? raw.sessionFile ?? "");
	const cwd = String(raw.cwd ?? raw.header?.cwd ?? "");
	const title =
		typeof raw.title === "string"
			? raw.title
			: typeof raw.header?.title === "string"
				? raw.header.title
				: undefined;
	const createdAt = String(raw.timestamp ?? raw.createdAt ?? raw.header?.timestamp ?? "");
	const updatedAt = String(raw.modifiedAt ?? raw.updatedAt ?? createdAt);
	const messageCount = Number(raw.messageCount ?? raw.count ?? 0);
	return {
		id,
		path: filePath,
		cwd,
		title,
		createdAt,
		updatedAt,
		messageCount,
	};
}

function modelInfoFromSdk(
	model: SdkModel,
	registry: ModelRegistry,
	current: { provider: string; id: string } | undefined,
): ModelInfo {
	const info: ModelInfo = {
		provider: String(model.provider),
		id: model.id,
		label: model.name || model.id,
		isAvailable: registry.hasConfiguredAuth(model as unknown as Parameters<ModelRegistry["hasConfiguredAuth"]>[0]),
	};
	if (typeof model.contextWindow === "number" && model.contextWindow > 0) {
		info.contextWindow = model.contextWindow;
	}
	if (Array.isArray(model.input) && model.input.length > 0) {
		info.inputModes = model.input.filter((m: unknown): m is "text" | "image" => m === "text" || m === "image");
	}
	if (current && current.provider === info.provider && current.id === info.id) {
		info.isCurrent = true;
	}
	return info;
}
