/**
 * Windows console-window suppression for python.exe spawns.
 *
 * omp's Python eval kernel (`packages/coding-agent/src/eval/py/kernel.ts`)
 * spawns Python via `Bun.spawn(..., { windowsHide: true })`. The `windowsHide`
 * flag does NOT actually suppress the console for console-subsystem binaries
 * like `python.exe` on many Windows hosts — a black terminal window pops up
 * anyway and leaks until the kernel dies.
 *
 * The robust fix: launch `pythonw.exe` (the GUI-subsystem twin shipped with
 * every standard CPython install) instead. API-compatible with `python.exe`
 * but never allocates a console.
 *
 * We do this by wrapping `Bun.spawn` at module-load time, BEFORE the omp SDK
 * is imported. The wrapper handles both call shapes:
 *   - `Bun.spawn(["python", ...], options)`           // bare name (PATH-resolved)
 *   - `Bun.spawn(["C:\\Python313\\python.exe", ...])` // absolute path
 *   - `Bun.spawn({ cmd: [...], options })`            // option-object shape
 *
 * Import at the very top of `index.ts` before anything that pulls in
 * `@oh-my-pi/pi-coding-agent`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

if (process.platform === "win32") {
	const originalSpawn = Bun.spawn;

	// Cache the resolved pythonw.exe path (from PATH) so we only `which` once.
	// `Bun.which` is sync and cheap, but we still avoid hot-loop overhead.
	let cachedPythonw: string | undefined | null;
	function resolvePythonwOnPath(): string | undefined {
		if (cachedPythonw !== undefined) return cachedPythonw ?? undefined;
		try {
			cachedPythonw = Bun.which("pythonw") ?? Bun.which("pythonw.exe") ?? null;
		} catch {
			cachedPythonw = null;
		}
		return cachedPythonw ?? undefined;
	}

	console.log("[silence-python] installed; Bun.spawn patched");

	(Bun as unknown as { spawn: typeof Bun.spawn }).spawn = function patchedSpawn(
		...args: Parameters<typeof Bun.spawn>
	): ReturnType<typeof Bun.spawn> {
		try {
			const before = inspectFirst(args);
			rewriteCmdInPlace(args, resolvePythonwOnPath);
			const after = inspectFirst(args);
			if (before !== after) {
				console.log(`[silence-python] rewrote ${before} -> ${after}`);
			} else if (before && /^(?:.*[\\/])?python(?:3)?(?:\.exe)?$/i.test(before)) {
				console.log(`[silence-python] could not rewrite python spawn: ${before}`);
			}
		} catch (err) {
			console.warn("[silence-python] rewrite threw", err);
		}
		// eslint-disable-next-line prefer-spread
		return originalSpawn.apply(Bun, args);
	} as typeof Bun.spawn;
}

function inspectFirst(args: unknown[]): string | undefined {
	const first = args[0];
	if (Array.isArray(first) && typeof first[0] === "string") return first[0];
	if (first && typeof first === "object") {
		const cmd = (first as Record<string, unknown>).cmd;
		if (Array.isArray(cmd) && typeof cmd[0] === "string") return cmd[0];
	}
	return undefined;
}

/**
 * Rewrites `python` / `python3` / `python.exe` / `python3.exe` (bare or
 * absolute) → `pythonw.exe` in place, when a corresponding `pythonw.exe`
 * exists. Pass-through if substitution is not feasible.
 */
function rewriteCmdInPlace(args: unknown[], resolvePythonwOnPath: () => string | undefined): void {
	const first = args[0];
	let cmd: unknown[] | undefined;
	if (Array.isArray(first)) {
		cmd = first;
	} else if (first && typeof first === "object") {
		const maybeCmd = (first as Record<string, unknown>).cmd;
		if (Array.isArray(maybeCmd)) cmd = maybeCmd;
	}
	if (!cmd || typeof cmd[0] !== "string") return;

	const exe = cmd[0];

	// Match: optional dir prefix + (python|python3) + optional .exe extension.
	const m = /^(?<prefix>.*?)(?<base>python3?)(?<ext>\.exe)?$/i.exec(exe);
	if (!m || !m.groups) return;
	const prefix = m.groups.prefix ?? "";

	if (prefix && /[\\/]/.test(prefix)) {
		// Absolute or relative path. Look for pythonw.exe in the same directory.
		const dir = path.dirname(exe);
		const candidate = path.join(dir, "pythonw.exe");
		if (fs.existsSync(candidate)) {
			cmd[0] = candidate;
		}
		return;
	}

	// Bare name. Resolve `pythonw` via PATH so the eventual spawn knows the full
	// path; if we passed just `"pythonw.exe"` Bun would also try PATH but the
	// resolved-path form makes the substitution observable in logs.
	const resolved = resolvePythonwOnPath();
	if (resolved) {
		cmd[0] = resolved;
	}
}
