/**
 * In-process cron runner for omp-deck routines.
 *
 * One `Cron` instance per enabled routine, managed in a Map keyed by routine
 * id. The runner subscribes to CRUD events via direct method calls (the bridge
 * for routines is just this module — there is no separate event bus).
 *
 * Actions
 *   - bash   → spawn `bash -lc "<body>"` on unix, `cmd /c "<body>"` on windows
 *   - script → spawn the path verbatim (treats body as a file path; pass args
 *              after a space on the same line)
 *   - prompt → spawn `omp -p "<body>"` headless; captures the final assistant
 *              text via stdout. Requires `omp` on PATH.
 *
 * stdout/stderr captures are clipped to MAX_EXCERPT chars; the full output is
 * not stored. If you want a full log we'll need a separate file-backed runs
 * table — out of scope for v1.
 */

import { Cron } from "croner";
import type { Routine, RoutineActionKind } from "@omp-deck/protocol";

import { logger } from "./log.ts";
import {
	finishRun,
	listRoutines,
	setRoutineSchedule,
	startRun,
} from "./db/routines.ts";

const log = logger("routines-runner");

const MAX_EXCERPT = 8 * 1024; // 8 KB per stream
const MAX_RUNTIME_MS = 10 * 60_000; // hard cap so a stuck routine can't leak

type RunningCron = { cron: Cron; routineId: string };

export class RoutinesRunner {
	private crons = new Map<string, RunningCron>();
	private disposed = false;

	start(): void {
		const routines = listRoutines();
		for (const r of routines) {
			if (r.enabled) this.schedule(r);
		}
		log.info(`scheduled ${routines.filter((r) => r.enabled).length} routine(s)`);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const entry of this.crons.values()) {
			try {
				entry.cron.stop();
			} catch (err) {
				log.warn(`stop failed for routine ${entry.routineId}`, err);
			}
		}
		this.crons.clear();
	}

	/** Called by routes after create/update. Idempotent — replaces any existing cron. */
	schedule(r: Routine): void {
		this.unschedule(r.id);
		if (!r.enabled) return;
		try {
			const cron = new Cron(r.cron, { catch: true, protect: true }, () => {
				void this.fire(r.id, "cron");
			});
			this.crons.set(r.id, { cron, routineId: r.id });
			const nextRun = cron.nextRun();
			setRoutineSchedule(r.id, { nextRunAt: nextRun?.toISOString() ?? null });
		} catch (err) {
			log.warn(`failed to schedule ${r.id} (${r.cron})`, err);
			setRoutineSchedule(r.id, { nextRunAt: null });
		}
	}

	/** Stop a scheduled cron. */
	unschedule(routineId: string): void {
		const existing = this.crons.get(routineId);
		if (!existing) return;
		try {
			existing.cron.stop();
		} catch (err) {
			log.warn(`stop failed for ${routineId}`, err);
		}
		this.crons.delete(routineId);
	}

	/** Fire a routine immediately, regardless of schedule. */
	async fire(routineId: string, trigger: "cron" | "manual" = "manual"): Promise<void> {
		const all = listRoutines();
		const routine = all.find((r) => r.id === routineId);
		if (!routine) {
			log.warn(`fire: routine ${routineId} not found`);
			return;
		}
		if (!routine.enabled && trigger === "cron") return; // safety

		const run = startRun(routineId, trigger);
		const cwd = routine.actionCwd && routine.actionCwd.trim() ? routine.actionCwd : process.cwd();
		log.info(`firing routine ${routine.name} (${routine.actionKind})`);

		try {
			const result = await runAction(routine.actionKind, routine.actionBody, cwd);
			finishRun(run.id, result);
		} catch (err) {
			finishRun(run.id, { error: String(err) });
		}

		const reschedule = this.crons.get(routineId);
		const now = new Date().toISOString();
		setRoutineSchedule(routineId, {
			lastRunAt: now,
			nextRunAt: reschedule?.cron.nextRun()?.toISOString() ?? null,
		});
	}
}

async function runAction(
	kind: RoutineActionKind,
	body: string,
	cwd: string,
): Promise<{ exitCode?: number; stdoutExcerpt: string; stderrExcerpt: string; error?: string }> {
	const cmd = buildCmd(kind, body);
	if (!cmd) return { error: `unsupported action kind: ${kind}`, stdoutExcerpt: "", stderrExcerpt: "" };

	const proc = Bun.spawn(cmd, {
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
	});

	const timer = setTimeout(() => {
		try {
			proc.kill();
		} catch {
			/* already gone */
		}
	}, MAX_RUNTIME_MS);
	timer.unref?.();

	const [stdout, stderr, exitCode] = await Promise.all([
		readClipped(proc.stdout),
		readClipped(proc.stderr),
		proc.exited,
	]);
	clearTimeout(timer);

	return {
		exitCode: typeof exitCode === "number" ? exitCode : undefined,
		stdoutExcerpt: stdout,
		stderrExcerpt: stderr,
	};
}

function buildCmd(kind: RoutineActionKind, body: string): string[] | null {
	const isWin = process.platform === "win32";
	switch (kind) {
		case "bash":
			return isWin ? ["cmd", "/c", body] : ["bash", "-lc", body];
		case "script": {
			const parts = body.trim().split(/\s+/);
			if (parts.length === 0 || !parts[0]) return null;
			return parts as string[];
		}
		case "prompt":
			return ["omp", "-p", body];
		default:
			return null;
	}
}

async function readClipped(stream: ReadableStream<Uint8Array> | null): Promise<string> {
	if (!stream) return "";
	const reader = stream.getReader();
	const decoder = new TextDecoder("utf-8");
	let acc = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		acc += decoder.decode(value, { stream: true });
		if (acc.length > MAX_EXCERPT) {
			acc = acc.slice(0, MAX_EXCERPT) + "\n…(truncated)";
			try {
				await reader.cancel();
			} catch {
				/* ignore */
			}
			break;
		}
	}
	acc += decoder.decode();
	return acc;
}
