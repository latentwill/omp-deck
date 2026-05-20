/* Single-process logger. No deps. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

let threshold: number = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

export function setLogLevel(level: string | undefined): boolean {
	const next = LEVELS[(level as Level) ?? "info"];
	if (next === undefined) return false;
	threshold = next;
	return true;
}

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
	if (LEVELS[level] < threshold) return;
	const stamp = new Date().toISOString();
	const line = `${stamp} ${level.padEnd(5)} [${scope}] ${msg}`;
	if (extra !== undefined) {
		// eslint-disable-next-line no-console
		console.log(line, extra);
	} else {
		// eslint-disable-next-line no-console
		console.log(line);
	}
}

export function logger(scope: string) {
	return {
		debug: (msg: string, extra?: unknown) => emit("debug", scope, msg, extra),
		info: (msg: string, extra?: unknown) => emit("info", scope, msg, extra),
		warn: (msg: string, extra?: unknown) => emit("warn", scope, msg, extra),
		error: (msg: string, extra?: unknown) => emit("error", scope, msg, extra),
	};
}
