#!/usr/bin/env node
// Post-pack cleanup. Reverses the materialization done by prepack.mjs so the
// workspace's symlinked `@omp-deck/protocol` is restored and `bun install`
// stays a no-op for the dev workflow.
//
// Runs automatically after `npm pack` / `npm publish`. Safe to run twice.

import { existsSync, rmSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROTOCOL_DEST = path.join(ROOT, "node_modules", "@omp-deck", "protocol");

if (existsSync(PROTOCOL_DEST)) {
	rmSync(PROTOCOL_DEST, { recursive: true, force: true });
	process.stdout.write("postpack: removed materialized @omp-deck/protocol\n");
}

// Restore the workspace symlink by asking bun to re-resolve. Cheap and
// idempotent.
const r = spawnSync("bun", ["install", "--frozen-lockfile"], {
	cwd: ROOT,
	stdio: "inherit",
});
if (r.status !== 0) {
	process.stderr.write(
		"postpack: bun install failed; restore the workspace manually with `bun install`.\n",
	);
}
