#!/usr/bin/env node
// Pre-publish step. Runs automatically before `npm pack` and `npm publish`.
//
// Two jobs:
//   1. Ensure the web app is built — the tarball ships pre-built static assets
//      (apps/web/dist/) so the installed package doesn't need a build step.
//   2. Materialize `node_modules/@omp-deck/protocol` as a real directory copy
//      (not a workspace symlink) so npm's `bundledDependencies` mechanism
//      picks it up in the tarball. Without this, the published package
//      resolves `@omp-deck/protocol` to nothing on the user's machine.
//
// `scripts/postpack.mjs` reverses the protocol materialization so the dev
// workflow (which relies on the symlink) keeps working after a local
// `npm pack`.

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROTOCOL_SRC = path.join(ROOT, "packages", "protocol");
const PROTOCOL_DEST = path.join(ROOT, "node_modules", "@omp-deck", "protocol");
const WEB_DIST = path.join(ROOT, "apps", "web", "dist");

function step(msg, fn) {
	process.stdout.write(`prepack: ${msg}... `);
	try {
		fn();
		process.stdout.write("ok\n");
	} catch (err) {
		process.stdout.write("FAIL\n");
		throw err;
	}
}

step("build web", () => {
	if (existsSync(path.join(WEB_DIST, "index.html"))) {
		// Already built — skip the 7s rebuild. Run `bun run clean` if you want
		// to force a fresh build before publishing.
		return;
	}
	const r = spawnSync("bun", ["run", "--filter", "@omp-deck/web", "build"], {
		cwd: ROOT,
		stdio: "inherit",
	});
	if (r.status !== 0) throw new Error(`web build exited with ${r.status}`);
});

step("materialize @omp-deck/protocol", () => {
	mkdirSync(path.dirname(PROTOCOL_DEST), { recursive: true });
	// If it's a symlink (workspace dev layout) or a stale copy, remove first.
	if (existsSync(PROTOCOL_DEST) || isSymlink(PROTOCOL_DEST)) {
		rmSync(PROTOCOL_DEST, { recursive: true, force: true });
	}
	cpSync(PROTOCOL_SRC, PROTOCOL_DEST, {
		recursive: true,
		// Skip the dev junk; we only need source + package.json.
		filter: (src) => {
			const base = path.basename(src);
			return base !== "node_modules" && base !== ".turbo" && !base.endsWith(".test.ts");
		},
	});

	// Rewrite the bundled package.json: drop `private` (npm bundling refuses
	// some private deps in strict modes) and drop `dependencies` / `devDeps`
	// so npm doesn't think the bundled package's transitive deps are
	// "already satisfied" and skip installing them. The root package.json
	// declares the same deps (ajv, ajv-formats) so they get hoisted and
	// resolved via the normal node_modules walk.
	const pkgPath = path.join(PROTOCOL_DEST, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
	delete pkg.private;
	delete pkg.dependencies;
	delete pkg.devDependencies;
	delete pkg.scripts;
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
});

function isSymlink(p) {
	try {
		return lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}
