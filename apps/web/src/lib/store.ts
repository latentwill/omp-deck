import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import type {
	ListSessionsResponse,
	ListWorkspacesResponse,
	SessionSummary,
	ServerFrame,
	WorkspaceEntry,
} from "@omp-deck/protocol";

import { api } from "./api";
import { applyEvent, initSession } from "./reducer";
import type { SessionUi } from "./types";
import { WsClient, type WsStatus } from "./ws";

function readBool(key: string, fallback: boolean): boolean {
	if (typeof localStorage === "undefined") return fallback;
	const raw = localStorage.getItem(key);
	if (raw === null) return fallback;
	return raw === "1";
}

/** Matches the Tailwind `lg` breakpoint (1024px) used by `Layout`. Below this
 * width the sidebar and inspector behave as overlay drawers, so persisting
 * "open" state would auto-open them on every mobile load and bury the main
 * content under a backdrop.  */
function isDesktopViewport(): boolean {
	return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

/** Chrome panel state is only persisted on desktop. On mobile we always start
 * with the panel closed and never write back, so toggling on a phone does not
 * pollute the desktop preference. */
function readChromeOpen(key: string, desktopFallback: boolean): boolean {
	if (!isDesktopViewport()) return false;
	return readBool(key, desktopFallback);
}

interface StoreState {
	ws: WsClient | null;
	wsStatus: WsStatus;
	connectionId?: string;

	workspaces: WorkspaceEntry[];
	defaultCwd: string;
	sessions: SessionSummary[];

	activeId?: string;
	sessionsById: Record<string, SessionUi>;

	// Track subscriptions to avoid duplicate subscribe messages.
	subscribed: Set<string>;

	/**
	 * Tool-card view state. `allCollapsed` is the bulk default; `perCard` holds
	 * user overrides (key = toolCallId, value = isOpen). On bulk toggle we clear
	 * `perCard` so the new default applies to every card uniformly.
	 */
	toolView: {
		allCollapsed: boolean;
		perCard: Record<string, boolean>;
	};

	/** Composer pre-fill used by `Open in chat` from the Tasks view. */
	pendingDraft?: { text: string };

	/** Shared chrome state — each view can open/close the inspector and sidebar. */
	sidebarOpen: boolean;
	inspectorOpen: boolean;

	/**
	 * Monotonic counter bumped every time the server broadcasts a `tasks_changed`
	 * frame (any kanban mutation, whether triggered by the deck UI, a deck slash
	 * command, or an agent calling the REST API). Views that own a local tasks
	 * cache (e.g. TasksView) subscribe to this counter and refetch when it
	 * changes — keeps the kanban view live without polling.
	 */
	tasksChangeCounter: number;

	/**
	 * Mirror of {@link tasksChangeCounter} for the skill catalog. Bumped on every
	 * `skills_changed` frame (plugin install / uninstall / enable / disable, or
	 * a SKILL.md mutation under the plugins cache dir). Drives live refetch in
	 * `SkillsView` without polling.
	 */
	skillsChangeCounter: number;

	/**
	 * Counter for `kb_changed` broadcasts. Bumped on any mutation under the
	 * watched kb root; `KbView` watches it and refetches the current file +
	 * tree. Same pattern as `tasksChangeCounter` / `skillsChangeCounter`.
	 */
	kbChangeCounter: number;

	// ─── Actions ─────────────────────────────────────────────────────────
	bootstrap(): Promise<void>;
	connect(): void;
	disconnect(): void;
	refreshWorkspaces(): Promise<void>;
	refreshSessions(cwd?: string): Promise<void>;
	createSession(opts: { cwd: string; resumeFromPath?: string }): Promise<string>;
	selectSession(id: string): void;
	sendPrompt(text: string, images?: import("@omp-deck/protocol").ImageAttachment[]): void;
	abort(): void;
	disposeSession(id: string): Promise<void>;
	renameSession(id: string, name: string): Promise<void>;
	toggleAllToolCards(): void;
	setToolCardOpen(id: string, open: boolean): void;
	setPendingDraft(draft: { text: string } | undefined): void;
	setSidebarOpen(open: boolean): void;
	setInspectorOpen(open: boolean): void;
}

export const useStore = create<StoreState>()(
	subscribeWithSelector((set, get) => ({
		ws: null,
		wsStatus: "closed",
		workspaces: [],
		defaultCwd: "",
		sessions: [],
		sessionsById: {},
		subscribed: new Set<string>(),
		toolView: { allCollapsed: false, perCard: {} },
		tasksChangeCounter: 0,
		skillsChangeCounter: 0,
		kbChangeCounter: 0,
		// Hydrate chrome state from localStorage at module init so first render
		// matches the user's last preference — but only on desktop. On mobile the
		// panels are overlay drawers and always start closed.
		sidebarOpen: readChromeOpen("omp-deck:sidebar-open", true),
		inspectorOpen: readChromeOpen("omp-deck:inspector-open", false),

		async bootstrap() {
			get().connect();
			await Promise.all([get().refreshWorkspaces(), get().refreshSessions()]);
		},

		connect() {
			if (get().ws) return;
			const ws = new WsClient();
			ws.onStatus((status) => set({ wsStatus: status }));
			ws.subscribe((frame) => handleFrame(frame, set, get));
			ws.connect();
			set({ ws });
		},

		disconnect() {
			get().ws?.dispose();
			set({ ws: null, wsStatus: "closed" });
		},

		async refreshWorkspaces() {
			try {
				const resp: ListWorkspacesResponse = await api.listWorkspaces();
				set({ workspaces: resp.workspaces, defaultCwd: resp.defaultCwd });
			} catch (err) {
				console.warn("listWorkspaces failed", err);
			}
		},

		async refreshSessions(cwd?: string) {
			try {
				const resp: ListSessionsResponse = await api.listSessions(cwd);
				set({ sessions: resp.sessions });
			} catch (err) {
				console.warn("listSessions failed", err);
			}
		},

		async createSession(opts) {
			const created = await api.createSession({
				cwd: opts.cwd,
				...(opts.resumeFromPath ? { resumeFromPath: opts.resumeFromPath } : {}),
			});
			// Subscribe immediately; reducer will hydrate from the `subscribed` snapshot.
			get().ws?.send({ type: "subscribe", sessionId: created.sessionId });
			get().subscribed.add(created.sessionId);
			set({ activeId: created.sessionId });
			// Background-refresh sidebar to reflect the new entry.
			void get().refreshSessions();
			void get().refreshWorkspaces();
			return created.sessionId;
		},

		selectSession(id: string) {
			set({ activeId: id });
			if (!get().subscribed.has(id)) {
				get().ws?.send({ type: "subscribe", sessionId: id });
				get().subscribed.add(id);
			}
		},

		sendPrompt(text, images) {
			const id = get().activeId;
			if (!id) return;
			const frame: Parameters<NonNullable<StoreState["ws"]>["send"]>[0] = images && images.length > 0
				? { type: "prompt", sessionId: id, text, images }
				: { type: "prompt", sessionId: id, text };
			get().ws?.send(frame);
		},

		abort() {
			const id = get().activeId;
			if (!id) return;
			get().ws?.send({ type: "abort", sessionId: id });
		},

		async disposeSession(id: string) {
			try {
				await api.disposeSession(id);
			} catch (err) {
				console.warn("dispose failed", err);
			}
			set((s) => {
				const next = { ...s.sessionsById };
				delete next[id];
				return {
					sessionsById: next,
					activeId: s.activeId === id ? undefined : s.activeId,
				};
			});
		},

		async renameSession(id, name) {
			try {
				await api.renameSession(id, name);
			} catch (err) {
				console.warn("rename failed", err);
				return;
			}
			set((s) => {
				const existing = s.sessionsById[id];
				const next = existing ? { ...s.sessionsById, [id]: { ...existing, sessionName: name } } : s.sessionsById;
				const sessions = s.sessions.map((r) => (r.id === id ? { ...r, title: name } : r));
				return { sessionsById: next, sessions };
			});
		},

		toggleAllToolCards() {
			set((s) => ({
				toolView: { allCollapsed: !s.toolView.allCollapsed, perCard: {} },
			}));
		},

		setToolCardOpen(id, open) {
			set((s) => ({
				toolView: {
					allCollapsed: s.toolView.allCollapsed,
					perCard: { ...s.toolView.perCard, [id]: open },
				},
			}));
		},

		setPendingDraft(draft) {
			set({ pendingDraft: draft });
		},

		setSidebarOpen(open) {
			// Only persist on desktop so toggling on mobile (where the panel is an
			// ephemeral overlay) doesn't auto-open it the next time the user lands
			// on the page from a wider screen.
			if (isDesktopViewport()) {
				try {
					localStorage.setItem("omp-deck:sidebar-open", open ? "1" : "0");
				} catch {}
			}
			set({ sidebarOpen: open });
		},

		setInspectorOpen(open) {
			if (isDesktopViewport()) {
				try {
					localStorage.setItem("omp-deck:inspector-open", open ? "1" : "0");
				} catch {}
			}
			set({ inspectorOpen: open });
		},
	})),
);

function handleFrame(
	frame: ServerFrame,
	set: (partial: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>)) => void,
	get: () => StoreState,
): void {
	switch (frame.type) {
		case "hello":
			set({ connectionId: frame.connectionId });
			// Re-subscribe to any previously-active sessions.
			for (const id of get().subscribed) {
				get().ws?.send({ type: "subscribe", sessionId: id });
			}
			return;

		case "subscribed":
			set((s) => ({
				sessionsById: {
					...s.sessionsById,
					[frame.sessionId]: initSession(frame.snapshot),
				},
			}));
			return;

		case "unsubscribed":
			get().subscribed.delete(frame.sessionId);
			return;

		case "session_event": {
			set((s) => {
				const prev = s.sessionsById[frame.sessionId];
				if (!prev) return {};
				const next = applyEvent(prev, frame.event);
				return { sessionsById: { ...s.sessionsById, [frame.sessionId]: next } };
			});
			return;
		}

		case "tasks_changed":
			set((s) => ({ tasksChangeCounter: s.tasksChangeCounter + 1 }));
			return;

		case "skills_changed":
			set((s) => ({ skillsChangeCounter: s.skillsChangeCounter + 1 }));
			return;

		case "kb_changed":
			set((s) => ({ kbChangeCounter: s.kbChangeCounter + 1 }));
			return;

		case "session_disposed":
			set((s) => {
				const next = { ...s.sessionsById };
				delete next[frame.sessionId];
				return {
					sessionsById: next,
					activeId: s.activeId === frame.sessionId ? undefined : s.activeId,
				};
			});
			return;

		case "error":
			set((s) => {
				const id = frame.sessionId;
				if (!id) return {};
				const prev = s.sessionsById[id];
				if (!prev) return {};
				return {
					sessionsById: {
						...s.sessionsById,
						[id]: { ...prev, lastError: frame.error },
					},
				};
			});
			return;

		case "pong":
		default:
			return;
	}
}

// Selectors ────────────────────────────────────────────────────────────────
export const selectActiveSession = (s: StoreState): SessionUi | undefined =>
	s.activeId ? s.sessionsById[s.activeId] : undefined;
