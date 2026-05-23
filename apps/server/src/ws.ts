import type { ServerWebSocket } from "bun";
import type { ClientFrame, ServerFrame } from "@omp-deck/protocol";

import type { AgentBridge } from "./bridge/types.ts";
import { broadcastBus } from "./broadcast-bus.ts";
import { logger } from "./log.ts";
const log = logger("ws");

/** Per-connection state. */
export interface ConnectionData {
	connectionId: string;
	subscriptions: Map<string, () => void>;
}

export class WsHub {
	private readonly connections = new Set<ServerWebSocket<ConnectionData>>();

	constructor(private bridge: AgentBridge) {
		broadcastBus.subscribe((frame) => this.broadcast(frame));
	}

	createConnectionData(): ConnectionData {
		return {
			connectionId: crypto.randomUUID(),
			subscriptions: new Map(),
		};
	}

	onOpen(ws: ServerWebSocket<ConnectionData>): void {
		this.connections.add(ws);
		send(ws, { type: "hello", connectionId: ws.data.connectionId });
		log.debug(`open ${ws.data.connectionId}`);
	}

	async onMessage(ws: ServerWebSocket<ConnectionData>, raw: string | Buffer): Promise<void> {
		let frame: ClientFrame;
		try {
			frame = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as ClientFrame;
		} catch {
			send(ws, { type: "error", error: "invalid json" });
			return;
		}

		switch (frame.type) {
			case "ping":
				send(ws, { type: "pong" });
				return;

			case "subscribe":
				await this.handleSubscribe(ws, frame.sessionId);
				return;

			case "unsubscribe":
				this.handleUnsubscribe(ws, frame.sessionId);
				return;

			case "prompt":
				await this.handlePrompt(ws, frame);
				return;

			case "abort":
				await this.handleAbort(ws, frame.sessionId);
				return;

			case "ext_ui_dialog_response":
				this.handleExtUiDialogResponse(ws, frame);
				return;

			default:
				send(ws, { type: "error", error: `unknown frame type` });
		}
	}

	onClose(ws: ServerWebSocket<ConnectionData>): void {
		this.connections.delete(ws);
		const subs = ws.data.subscriptions;
		const connectionId = ws.data.connectionId;
		log.debug(`close ${connectionId} subs=${subs.size}`);
		for (const [sessionId, unsub] of subs.entries()) {
			try {
				unsub();
			} catch (err) {
				log.warn(`unsubscribe on close failed`, err);
			}
			this.bridge.trackSubscriberRemoved(sessionId, connectionId);
		}
		subs.clear();
	}

	private broadcast(frame: ServerFrame): void {
		const payload = JSON.stringify(frame);
		for (const ws of this.connections) {
			try {
				ws.send(payload);
			} catch (err) {
				log.warn(`broadcast send failed`, err);
			}
		}
	}

	// ───────────────────────────────────────────────────────────────────────

	private async handleSubscribe(ws: ServerWebSocket<ConnectionData>, sessionId: string): Promise<void> {
		const connectionId = ws.data.connectionId;
		if (ws.data.subscriptions.has(sessionId)) {
			const handle = this.bridge.getSession(sessionId);
			if (handle) {
				this.bridge.bumpActivity(sessionId);
				send(ws, { type: "subscribed", sessionId, snapshot: handle.snapshot() });
			}
			return;
		}

		const handle = this.bridge.getSession(sessionId);
		if (!handle) {
			send(ws, { type: "error", sessionId, error: "session not active" });
			return;
		}

		const unsubSession = handle.subscribe((event) => {
			send(ws, { type: "session_event", sessionId, event });
		});
		// Mirror extension-UI dialog frames (ask tool etc.) into this connection.
		// `subscribeUiFrames` also replays any already-open dialogs so a page-
		// reload subscriber sees the pending modal immediately.
		const unsubUi = this.bridge.subscribeUiFrames(sessionId, (frame) => {
			send(ws, frame);
		});
		const teardown = (): void => {
			try {
				unsubSession();
			} catch (err) {
				log.warn(`session unsubscribe threw`, err);
			}
			try {
				unsubUi();
			} catch (err) {
				log.warn(`ui unsubscribe threw`, err);
			}
		};
		ws.data.subscriptions.set(sessionId, teardown);
		this.bridge.trackSubscriberAdded(sessionId, connectionId);
		send(ws, { type: "subscribed", sessionId, snapshot: handle.snapshot() });
	}

	private handleUnsubscribe(ws: ServerWebSocket<ConnectionData>, sessionId: string): void {
		const unsub = ws.data.subscriptions.get(sessionId);
		if (unsub) {
			unsub();
			ws.data.subscriptions.delete(sessionId);
			this.bridge.trackSubscriberRemoved(sessionId, ws.data.connectionId);
		}
		send(ws, { type: "unsubscribed", sessionId });
	}

	private async handlePrompt(
		ws: ServerWebSocket<ConnectionData>,
		frame: Extract<ClientFrame, { type: "prompt" }>,
	): Promise<void> {
		const handle = this.bridge.getSession(frame.sessionId);
		if (!handle) {
			send(ws, { type: "error", sessionId: frame.sessionId, error: "session not active" });
			return;
		}
		const opts: { streamingBehavior?: "steer" | "followUp"; images?: typeof frame.images } = {};
		if (frame.streamingBehavior) opts.streamingBehavior = frame.streamingBehavior;
		if (frame.images && frame.images.length > 0) opts.images = frame.images;
		this.bridge.bumpActivity(frame.sessionId);
		const sendError = (err: unknown): void => {
			send(ws, {
				type: "error",
				sessionId: frame.sessionId,
				error: `prompt failed: ${String(err)}`,
			});
		};
		if (frame.text.startsWith("/")) {
			handle
				.dispatchDeckSlashCommand(frame.text)
				.then((deck) => {
					if (deck.kind === "consumed") return undefined;
					if (deck.kind === "rewritten") return handle.prompt(deck.prompt, opts);
					return handle
						.dispatchSlashCommand(frame.text)
						.then((sdk) => {
							if (sdk.kind === "consumed") return undefined;
							if (sdk.kind === "rewritten") return handle.prompt(sdk.prompt, opts);
							return handle.prompt(frame.text, opts);
						});
				})
				.catch(sendError);
			return;
		}
		handle.prompt(frame.text, opts).catch(sendError);
	}

	private async handleAbort(ws: ServerWebSocket<ConnectionData>, sessionId: string): Promise<void> {
		const handle = this.bridge.getSession(sessionId);
		if (!handle) {
			send(ws, { type: "error", sessionId, error: "session not active" });
			return;
		}
		this.bridge.bumpActivity(sessionId);
		try {
			await handle.abort();
		} catch (err) {
			send(ws, { type: "error", sessionId, error: `abort failed: ${String(err)}` });
		}
	}

	private handleExtUiDialogResponse(
		ws: ServerWebSocket<ConnectionData>,
		frame: Extract<ClientFrame, { type: "ext_ui_dialog_response" }>,
	): void {
		// We don't gate on subscription state here: a user can answer a dialog
		// from any connection that received the open frame (the bridge replays
		// pending frames on subscribe). Bumping activity keeps the reaper away
		// while the user is mid-decision.
		this.bridge.bumpActivity(frame.sessionId);
		const { type: _t, sessionId, dialogId, ...response } = frame;
		void _t;
		try {
			this.bridge.respondToUiDialog(sessionId, dialogId, response);
		} catch (err) {
			log.warn(`respondToUiDialog threw`, err);
			send(ws, {
				type: "error",
				sessionId,
				error: `ext_ui_dialog_response failed: ${String(err)}`,
			});
		}
	}
}

function send(ws: ServerWebSocket<ConnectionData>, frame: ServerFrame): void {
	ws.send(JSON.stringify(frame));
}
