#!/usr/bin/env node
// omp-deck CLI entrypoint.
//
// This is a tiny Node-runnable shim. It checks for Bun on PATH (the deck is a
// Bun-native server) and spawns the bundled server, inheriting stdio + signals
// + exit code. Default data directory is ~/.omp-deck; overridable via
// OMP_DECK_DATA_DIR or the existing OMP_DECK_DB_PATH / OMP_DECK_UPLOADS_ROOT
// env vars. Default web dist is the bundled `apps/web/dist/` shipped in the
// package; overridable via OMP_DECK_WEB_DIST.
//
// Why Node, not Bun: the user may not have Bun yet — we want to print an
// actionable install message instead of an ENOENT.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Package root is the directory containing `bin/`.
const PKG_ROOT = path.resolve(HERE, "..");
const SERVER_ENTRY = path.join(PKG_ROOT, "apps", "server", "src", "index.ts");
const WEB_DIST = path.join(PKG_ROOT, "apps", "web", "dist");
const STARTER_SKILLS = path.join(PKG_ROOT, "starter-skills");
const STARTER_EXTENSIONS = path.join(PKG_ROOT, "starter-extensions");

function fail(msg) {
	console.error(`omp-deck: ${msg}`);
	process.exit(1);
}

function ensureBun() {
	const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["bun"], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (probe.status === 0 && probe.stdout.toString().trim().length > 0) return;
	console.error("omp-deck requires Bun (https://bun.sh) — not found on PATH.");
	console.error("");
	console.error("Install:");
	console.error("  curl -fsSL https://bun.sh/install | bash    (macOS / Linux)");
	console.error("  powershell -c \"irm bun.sh/install.ps1 | iex\"  (Windows)");
	console.error("");
	console.error("Then re-run: omp-deck");
	process.exit(127);
}

function resolveDataDir() {
	const explicit = process.env.OMP_DECK_DATA_DIR?.trim();
	if (explicit) return path.resolve(explicit);
	return path.join(os.homedir(), ".omp-deck");
}

function main() {
	if (!existsSync(SERVER_ENTRY)) {
		fail(`server entry missing at ${SERVER_ENTRY} — broken install?`);
	}
	ensureBun();

	const dataDir = resolveDataDir();
	mkdirSync(dataDir, { recursive: true });

	const env = { ...process.env };
	// Only set defaults — let user overrides win.
	env.OMP_DECK_DB_PATH ??= path.join(dataDir, "deck.db");
	env.OMP_DECK_UPLOADS_ROOT ??= path.join(dataDir, "uploads");
	env.OMP_DECK_WEB_DIST ??= WEB_DIST;
	env.OMP_DECK_STARTER_SKILLS_DIR ??= STARTER_SKILLS;
	env.OMP_DECK_STARTER_EXTENSIONS_DIR ??= STARTER_EXTENSIONS;
	// Default cwd: the data dir, not wherever the user happened to invoke from.
	// The agent's own session cwd is independent and still defaults to $HOME.
	env.OMP_DECK_DEFAULT_CWD ??= os.homedir();

	const args = process.argv.slice(2);
	const child = spawn("bun", [SERVER_ENTRY, ...args], {
		stdio: "inherit",
		env,
		// Bun resolves relative imports against the script path; cwd here only
		// influences where Bun looks for bunfig.toml — keep it at package root
		// so workspace settings (if any) apply.
		cwd: PKG_ROOT,
	});

	function forward(sig) {
		try {
			child.kill(sig);
		} catch {
			/* child already exited */
		}
	}
	process.on("SIGINT", () => forward("SIGINT"));
	process.on("SIGTERM", () => forward("SIGTERM"));

	child.on("exit", (code, signal) => {
		if (signal) {
			// Re-raise the signal in this process so the parent shell sees it.
			process.kill(process.pid, signal);
		} else {
			process.exit(code ?? 0);
		}
	});
	child.on("error", (err) => {
		fail(`failed to spawn bun: ${err.message}`);
	});
}

main();
