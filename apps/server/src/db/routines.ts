/**
 * Routines + routine_runs queries.
 *
 * `next_run_at` is recomputed whenever a routine is created/updated or fires,
 * driven by the in-process runner. We persist it so a server restart can
 * rebuild the schedule without re-evaluating every cron expression up front.
 */

import type { Routine, RoutineActionKind, RoutineRun } from "@omp-deck/protocol";

import { getDb, id, nowIso } from "./index.ts";

interface RoutineRow {
	id: string;
	name: string;
	description: string;
	cron: string;
	action_kind: string;
	action_body: string;
	action_cwd: string | null;
	enabled: number;
	created_at: string;
	updated_at: string;
	last_run_at: string | null;
	next_run_at: string | null;
}

interface RunRow {
	id: string;
	routine_id: string;
	started_at: string;
	ended_at: string | null;
	exit_code: number | null;
	stdout_excerpt: string;
	stderr_excerpt: string;
	error: string | null;
	trigger: string;
}

function rowToRoutine(r: RoutineRow): Routine {
	const out: Routine = {
		id: r.id,
		name: r.name,
		description: r.description,
		cron: r.cron,
		actionKind: r.action_kind as RoutineActionKind,
		actionBody: r.action_body,
		enabled: r.enabled === 1,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
	if (r.action_cwd !== null) out.actionCwd = r.action_cwd;
	if (r.last_run_at !== null) out.lastRunAt = r.last_run_at;
	if (r.next_run_at !== null) out.nextRunAt = r.next_run_at;
	return out;
}

function rowToRun(r: RunRow): RoutineRun {
	const out: RoutineRun = {
		id: r.id,
		routineId: r.routine_id,
		startedAt: r.started_at,
		stdoutExcerpt: r.stdout_excerpt,
		stderrExcerpt: r.stderr_excerpt,
		trigger: r.trigger as "cron" | "manual",
	};
	if (r.ended_at !== null) out.endedAt = r.ended_at;
	if (r.exit_code !== null) out.exitCode = r.exit_code;
	if (r.error !== null) out.error = r.error;
	return out;
}

export function listRoutines(): Routine[] {
	const rows = getDb()
		.query<RoutineRow, []>(
			`SELECT id, name, description, cron, action_kind, action_body, action_cwd, enabled,
			        created_at, updated_at, last_run_at, next_run_at
			 FROM routines ORDER BY name ASC`,
		)
		.all() as RoutineRow[];
	return rows.map(rowToRoutine);
}

export function getRoutine(routineId: string): Routine | undefined {
	const row = getDb()
		.query<RoutineRow, [string]>(
			`SELECT id, name, description, cron, action_kind, action_body, action_cwd, enabled,
			        created_at, updated_at, last_run_at, next_run_at
			 FROM routines WHERE id = ?`,
		)
		.get(routineId) as RoutineRow | null;
	return row ? rowToRoutine(row) : undefined;
}

export function createRoutine(input: {
	name: string;
	description?: string;
	cron: string;
	actionKind: RoutineActionKind;
	actionBody: string;
	actionCwd?: string;
	enabled?: boolean;
}): Routine {
	const routineId = `r_${id().toLowerCase().slice(0, 18)}`;
	const now = nowIso();
	getDb()
		.prepare<
			unknown,
			[string, string, string, string, string, string, string | null, number, string, string]
		>(
			`INSERT INTO routines
			   (id, name, description, cron, action_kind, action_body, action_cwd, enabled, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			routineId,
			input.name,
			input.description ?? "",
			input.cron,
			input.actionKind,
			input.actionBody,
			input.actionCwd ?? null,
			input.enabled === false ? 0 : 1,
			now,
			now,
		);
	const out = getRoutine(routineId);
	if (!out) throw new Error("createRoutine failed");
	return out;
}

export function updateRoutine(
	routineId: string,
	patch: Partial<{
		name: string;
		description: string;
		cron: string;
		actionKind: RoutineActionKind;
		actionBody: string;
		actionCwd: string | null;
		enabled: boolean;
	}>,
): Routine | undefined {
	const existing = getRoutine(routineId);
	if (!existing) return undefined;
	const next = { ...existing, ...patch };
	getDb()
		.prepare<
			unknown,
			[string, string, string, string, string, string | null, number, string, string]
		>(
			`UPDATE routines SET name = ?, description = ?, cron = ?, action_kind = ?, action_body = ?,
			        action_cwd = ?, enabled = ?, updated_at = ?
			 WHERE id = ?`,
		)
		.run(
			next.name,
			next.description,
			next.cron,
			next.actionKind,
			next.actionBody,
			(patch.actionCwd === null ? null : (next.actionCwd ?? null)) as string | null,
			next.enabled ? 1 : 0,
			nowIso(),
			routineId,
		);
	return getRoutine(routineId);
}

export function deleteRoutine(routineId: string): boolean {
	const r = getDb().prepare<unknown, [string]>("DELETE FROM routines WHERE id = ?").run(routineId);
	return Number(r.changes ?? 0) > 0;
}

export function setRoutineSchedule(
	routineId: string,
	patch: { lastRunAt?: string; nextRunAt?: string | null },
): void {
	const sets: string[] = [];
	const args: Array<string | null> = [];
	if (patch.lastRunAt !== undefined) {
		sets.push("last_run_at = ?");
		args.push(patch.lastRunAt);
	}
	if (patch.nextRunAt !== undefined) {
		sets.push("next_run_at = ?");
		args.push(patch.nextRunAt);
	}
	if (sets.length === 0) return;
	args.push(routineId);
	getDb()
		.prepare<unknown, (string | null)[]>(`UPDATE routines SET ${sets.join(", ")} WHERE id = ?`)
		.run(...args);
}

// ─── Runs ──────────────────────────────────────────────────────────────────

export function startRun(routineId: string, trigger: "cron" | "manual"): RoutineRun {
	const runId = `run_${id().toLowerCase().slice(0, 18)}`;
	const startedAt = nowIso();
	getDb()
		.prepare<unknown, [string, string, string, string]>(
			"INSERT INTO routine_runs (id, routine_id, started_at, trigger) VALUES (?, ?, ?, ?)",
		)
		.run(runId, routineId, startedAt, trigger);
	const out = getRun(runId);
	if (!out) throw new Error("startRun failed");
	return out;
}

export function finishRun(
	runId: string,
	patch: { exitCode?: number; stdoutExcerpt?: string; stderrExcerpt?: string; error?: string },
): void {
	getDb()
		.prepare<unknown, [string, number | null, string, string, string | null, string]>(
			`UPDATE routine_runs
			   SET ended_at = ?, exit_code = ?, stdout_excerpt = ?, stderr_excerpt = ?, error = ?
			 WHERE id = ?`,
		)
		.run(
			nowIso(),
			patch.exitCode ?? null,
			patch.stdoutExcerpt ?? "",
			patch.stderrExcerpt ?? "",
			patch.error ?? null,
			runId,
		);
}

export function listRuns(routineId: string, limit = 20): RoutineRun[] {
	const rows = getDb()
		.query<RunRow, [string, number]>(
			`SELECT id, routine_id, started_at, ended_at, exit_code, stdout_excerpt, stderr_excerpt, error, trigger
			 FROM routine_runs
			 WHERE routine_id = ?
			 ORDER BY started_at DESC
			 LIMIT ?`,
		)
		.all(routineId, limit) as RunRow[];
	return rows.map(rowToRun);
}

export function getRun(runId: string): RoutineRun | undefined {
	const row = getDb()
		.query<RunRow, [string]>(
			`SELECT id, routine_id, started_at, ended_at, exit_code, stdout_excerpt, stderr_excerpt, error, trigger
			 FROM routine_runs WHERE id = ?`,
		)
		.get(runId) as RunRow | null;
	return row ? rowToRun(row) : undefined;
}
