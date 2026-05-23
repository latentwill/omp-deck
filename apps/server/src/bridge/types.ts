import type {
	AgentMessageJson,
	AgentSessionEventJson,
	ContextUsage,
	ExtUiDialogResponse,
	ImageAttachment,
	ModelInfo,
	ModelRef,
	ServerFrame,
	SessionSnapshot,
	SessionSummary,
} from "@omp-deck/protocol";

/**
 * Abstract bridge to omp. The in-process impl embeds @oh-my-pi/pi-coding-agent
 * directly; a future RPC impl will spawn `omp --mode rpc` subprocesses behind
 * the same surface. Anything the server needs from omp MUST flow through this.
 */
export interface AgentBridge {
	createSession(opts: CreateSessionOpts): Promise<SessionHandle>;
	resumeSession(opts: ResumeSessionOpts): Promise<SessionHandle>;
	getSession(sessionId: string): SessionHandle | undefined;
	listSessions(opts: { cwd?: string }): Promise<SessionSummary[]>;
	/** Pin a session against the idle reaper while a client is subscribed. */
	trackSubscriberAdded(sessionId: string, connectionId: string): void;
	/** Drop a subscriber; once subscribers hit zero and idle window elapses, the reaper claims it. */
	trackSubscriberRemoved(sessionId: string, connectionId: string): void;
	/** Bump last-activity-ts; called for explicit user actions outside subscribe. */
	bumpActivity(sessionId: string): void;
	/** Hot-apply runtime env values that do not require process restart. */
	applyEnvUpdate?(update: RuntimeEnvUpdate): void;
	/** Catalog of models the SDK knows about, plus a marker on the current one when sessionId is given. */
	listModels(opts?: { sessionId?: string }): Promise<ModelInfo[]>;
	/**
	 * Subscribe to extension-UI dialog frames for `sessionId` (open + cancel).
	 * Returns an unsubscribe function. Implementations MAY immediately replay
	 * any already-open dialogs to a new subscriber so a late client (page
	 * reload, second tab) does not miss an active modal.
	 */
	subscribeUiFrames(
		sessionId: string,
		listener: (frame: Extract<ServerFrame, { type: "ext_ui_dialog_open" | "ext_ui_dialog_cancel" }>) => void,
	): () => void;
	/** Settle a previously-emitted dialog with the client's response. */
	respondToUiDialog(sessionId: string, dialogId: string, response: ExtUiDialogResponse): void;
	dispose(): Promise<void>;
}

export interface RuntimeEnvUpdate {
	idleTimeoutMs?: number;
	autoStartCommand?: string | null;
}

export interface CreateSessionOpts {
	cwd: string;
	model?: ModelRef;
	suppressAutoStart?: boolean;
}

export interface ResumeSessionOpts {
	sessionPath: string;
}

export type EventListener = (event: AgentSessionEventJson) => void;

export interface SessionHandle {
	readonly sessionId: string;
	readonly sessionFile: string | undefined;
	readonly cwd: string;

	subscribe(listener: EventListener): () => void;
	snapshot(): SessionSnapshot;
	prompt(
		text: string,
		opts?: { streamingBehavior?: "steer" | "followUp"; images?: ImageAttachment[] },
	): Promise<void>;
	abort(): Promise<void>;
	setName(name: string): Promise<void>;
	/**
	 * Trigger manual compaction with optional focus instructions. Resolves once
	 * the SDK acknowledges the call; the actual compaction event arrives via
	 * the regular session event stream so the deck UI can react.
	 */
	compact(focus?: string): Promise<void>;
	/** Swap the live agent session to a different model. Throws on unknown ref or missing auth. */
	setModel(ref: ModelRef): Promise<void>;
	/**
	 * Try to dispatch a leading slash command via the omp SDK's text-mode
	 * dispatcher. Returns `"fallthrough"` when nothing matched — caller should
	 * forward the original text via `prompt()`. `"consumed"` means the SDK ran
	 * the command and there is no follow-up turn. `"rewritten"` means the
	 * command produced a new prompt string the caller should send instead.
	 */
	dispatchSlashCommand(text: string): Promise<SlashDispatchResult>;
	/**
	 * Try to dispatch a leading slash command via the deck's own registry
	 * (kanban operations etc). Same return shape as `dispatchSlashCommand` so
	 * the WS hub can branch identically.
	 */
	dispatchDeckSlashCommand(text: string): Promise<SlashDispatchResult>;
	/**
	 * Snapshot of context-window utilization. Returns `undefined` when the
	 * underlying model has no declared context window.
	 */
	getContextUsage(): ContextUsage | undefined;
	dispose(): Promise<void>;
}

export type SlashDispatchResult =
	| { kind: "fallthrough" }
	| { kind: "consumed"; output: string }
	| { kind: "rewritten"; output: string; prompt: string };

export interface AgentMessagePassthrough extends AgentMessageJson {}
