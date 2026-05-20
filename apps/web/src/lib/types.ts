/**
 * Local UI types derived from the protocol contract.
 *
 * The web app reduces AgentSessionEvent passthroughs into this shape so the
 * components render against a stable, opinionated state — never against the
 * raw SDK events.
 */

import type { ModelRef } from "@omp-deck/protocol";

// ─── Content blocks ────────────────────────────────────────────────────────

export interface TextBlock {
	type: "text";
	text: string;
}
export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
}
export interface RedactedThinkingBlock {
	type: "redactedThinking";
	data: string;
}
export interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	intent?: string;
}
export interface ImageBlock {
	type: "image";
	data: string;
	mimeType: string;
}

export type AssistantContentBlock =
	| TextBlock
	| ThinkingBlock
	| RedactedThinkingBlock
	| ToolCallBlock;

// ─── Messages ──────────────────────────────────────────────────────────────

export interface UserMsg {
	id: string;
	role: "user";
	text: string;
	images?: ImageBlock[];
	timestamp?: number;
	synthetic?: boolean;
}

export interface AssistantMsg {
	id: string;
	role: "assistant";
	blocks: AssistantContentBlock[];
	model?: string;
	provider?: string;
	usage?: UsageRollup;
	stopReason?: string;
	isStreaming: boolean;
	errorMessage?: string;
	timestamp?: number;
	durationMs?: number;
	ttft?: number;
}

export interface ToolResultMsg {
	id: string;
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: Array<TextBlock | ImageBlock>;
	isError: boolean;
	timestamp?: number;
}

export interface NoticeMsg {
	id: string;
	role: "notice";
	level: "info" | "warning" | "error";
	message: string;
	source?: string;
	timestamp: number;
}

export interface CompactionMsg {
	id: string;
	role: "compaction";
	reason: string;
	action: string;
	summary?: string;
	timestamp: number;
}

export interface TtsrMsg {
	id: string;
	role: "ttsr";
	rules: Array<{ name?: string; description?: string; body?: string }>;
	timestamp: number;
}

export interface IrcMsg {
	id: string;
	role: "irc";
	customType?: string;
	content: string;
	from?: string;
	timestamp: number;
}

export type ChatMessage =
	| UserMsg
	| AssistantMsg
	| ToolResultMsg
	| NoticeMsg
	| CompactionMsg
	| TtsrMsg
	| IrcMsg;

// ─── Tool call lifecycle ───────────────────────────────────────────────────

export interface ToolCallStream {
	id: string;
	name: string;
	args: Record<string, unknown> | undefined;
	intent?: string;
	status: "running" | "complete" | "error";
	partialResult?: unknown;
	result?: unknown;
	isError: boolean;
	startedAt: number;
	endedAt?: number;
	/** Set when a paired tool_result message arrives. Mirrors result content for compatibility. */
	resultContent?: Array<TextBlock | ImageBlock>;
}

// ─── Todos ─────────────────────────────────────────────────────────────────

export interface TodoTask {
	id?: string;
	content: string;
	status: "pending" | "in_progress" | "completed" | "dropped" | string;
	notes?: string[];
}

export interface TodoPhase {
	id?: string;
	name?: string;
	tasks: TodoTask[];
}

// ─── Cost / usage ──────────────────────────────────────────────────────────

export interface UsageRollup {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
	reasoningTokens?: number;
}

// ─── Session ───────────────────────────────────────────────────────────────

export interface SessionUi {
	sessionId: string;
	cwd: string;
	sessionFile?: string;
	sessionName?: string;
	model?: ModelRef;
	thinkingLevel?: string;

	messages: ChatMessage[];
	/** Tool calls keyed by toolCallId for richer per-call rendering. */
	toolCalls: Record<string, ToolCallStream>;
	todoPhases: TodoPhase[];

	status: "idle" | "streaming" | "compacting" | "retrying";

	retry?: {
		attempt: number;
		maxAttempts: number;
		errorMessage: string;
	};

	compaction?: {
		reason: string;
		action: string;
		startedAt: number;
	};

	ttsr?: {
		rules: Array<{ name?: string; description?: string }>;
		at: number;
	};

	mode?: { mode: string; data?: unknown };
	goal?: { goal: unknown; state?: unknown } | null;

	usage: UsageRollup;
	turnCount: number;
	/**
	 * Live context-window utilization. `undefined` when the model doesn't
	 * declare a window. Updated by the bridge's synthetic `context_usage` event
	 * after every turn-end / compaction.
	 */
	contextUsage?: import("@omp-deck/protocol").ContextUsage;

	/** Latest provider error displayed in chrome (cleared on next turn_start). */
	lastError?: string;
}
