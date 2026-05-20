/**
 * /api/kb — Karpathy llm-wiki viewer over `~/kb`.
 *
 * Phase 1 (T-34): tree listing + single-file read. Mutations (PUT/POST) land
 * in T-36; graph + backlinks land in T-37.
 */

import { Hono } from "hono";

import { logger } from "./log.ts";
import type { KbService } from "./kb-service.ts";

const log = logger("routes:kb");

export function buildKbRouter(service: KbService): Hono {
	const app = new Hono();

	app.get("/kb/tree", async (c) => {
		const subpath = c.req.query("path") ?? "";
		try {
			const body = await service.getTree(subpath);
			if (!body) return c.json({ error: "not found" }, 404);
			return c.json(body);
		} catch (err) {
			log.error(`getTree failed`, err);
			return c.json({ error: String(err) }, 500);
		}
	});

	app.get("/kb/file", async (c) => {
		const subpath = c.req.query("path");
		if (!subpath) return c.json({ error: "path required" }, 400);
		try {
			const body = await service.getFile(subpath);
			if (!body) return c.json({ error: "not found" }, 404);
			return c.json(body);
		} catch (err) {
			log.error(`getFile failed`, err);
			return c.json({ error: String(err) }, 500);
		}
	});

	return app;
}
