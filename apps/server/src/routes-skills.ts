/**
 * /api/skills — skill enumeration across every omp provider.
 *
 * - `GET /api/skills?cwd=<abs>` lists every skill `loadCapability(skillCapability.id)`
 *   returns, native-first.
 * - `GET /api/skills/:id?cwd=<abs>` returns one skill's body + co-located files.
 *   `id` is the server-issued opaque identifier carried on every list row;
 *   clients never construct it from parts.
 */

import { Hono } from "hono";

import { logger } from "./log.ts";
import type { SkillsService } from "./skills-service.ts";

const log = logger("routes:skills");

export function buildSkillsRouter(service: SkillsService): Hono {
	const app = new Hono();

	app.get("/skills", async (c) => {
		const cwd = c.req.query("cwd");
		try {
			const body = await service.listSkills(cwd);
			return c.json(body);
		} catch (err) {
			log.error(`listSkills failed`, err);
			return c.json({ error: String(err) }, 500);
		}
	});

	app.get("/skills/:id", async (c) => {
		const id = c.req.param("id");
		const cwd = c.req.query("cwd");
		if (!id) return c.json({ error: "id is required" }, 400);
		try {
			const detail = await service.getSkillDetail(id, cwd);
			if (!detail) return c.json({ error: "skill not found" }, 404);
			return c.json(detail);
		} catch (err) {
			log.error(`getSkillDetail failed`, err);
			return c.json({ error: String(err) }, 500);
		}
	});

	return app;
}
