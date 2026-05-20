import { Hono } from "hono";
import type {
	CreateRoutineRequest,
	ListRoutineRunsResponse,
	ListRoutinesResponse,
	UpdateRoutineRequest,
} from "@omp-deck/protocol";

import { logger } from "./log.ts";
import {
	createRoutine,
	deleteRoutine,
	getRoutine,
	listRoutines,
	listRuns,
	updateRoutine,
} from "./db/routines.ts";
import type { RoutinesRunner } from "./routines-runner.ts";

const log = logger("routes:routines");

export function buildRoutinesRouter(runner: RoutinesRunner): Hono {
	const app = new Hono();

	app.get("/routines", (c) => {
		const body: ListRoutinesResponse = { routines: listRoutines() };
		return c.json(body);
	});

	app.post("/routines", async (c) => {
		let body: CreateRoutineRequest;
		try {
			body = (await c.req.json()) as CreateRoutineRequest;
		} catch {
			return c.json({ error: "invalid json" }, 400);
		}
		if (!body.name || !body.cron || !body.actionKind || body.actionBody === undefined) {
			return c.json({ error: "name, cron, actionKind, actionBody required" }, 400);
		}
		try {
			const routine = createRoutine(body);
			runner.schedule(routine);
			return c.json(routine, 201);
		} catch (err) {
			log.error("createRoutine failed", err);
			return c.json({ error: String(err) }, 400);
		}
	});

	app.get("/routines/:id", (c) => {
		const r = getRoutine(c.req.param("id"));
		if (!r) return c.json({ error: "not found" }, 404);
		return c.json(r);
	});

	app.patch("/routines/:id", async (c) => {
		let body: UpdateRoutineRequest;
		try {
			body = (await c.req.json()) as UpdateRoutineRequest;
		} catch {
			return c.json({ error: "invalid json" }, 400);
		}
		const updated = updateRoutine(c.req.param("id"), body);
		if (!updated) return c.json({ error: "not found" }, 404);
		runner.schedule(updated);
		return c.json(updated);
	});

	app.delete("/routines/:id", (c) => {
		const id = c.req.param("id");
		runner.unschedule(id);
		const ok = deleteRoutine(id);
		return c.json({ ok });
	});

	app.post("/routines/:id/run", async (c) => {
		const id = c.req.param("id");
		const r = getRoutine(id);
		if (!r) return c.json({ error: "not found" }, 404);
		// Don't await — fire in background and return immediately. Polling
		// `/runs` shows progress.
		void runner.fire(id, "manual").catch((err) => log.warn("manual fire failed", err));
		return c.json({ ok: true });
	});

	app.get("/routines/:id/runs", (c) => {
		const id = c.req.param("id");
		const limit = Number(c.req.query("limit") ?? "20");
		const body: ListRoutineRunsResponse = { runs: listRuns(id, limit) };
		return c.json(body);
	});

	return app;
}
