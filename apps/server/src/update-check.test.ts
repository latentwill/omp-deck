/**
 * Update-check tests.
 *
 * Coverage:
 *   - Disabled env var short-circuits everything (no network, no cache read).
 *   - Cache hit returns the persisted value without hitting the network.
 *   - updateAvailable=true when cached latest > current.
 *   - updateAvailable=false when cached latest === or < current.
 *   - Semver-aware comparison (0.10.0 > 0.9.0; prereleases handled).
 *   - Registry-error cache state doesn't claim an update.
 *   - First call with no cache returns empty state and triggers background fetch.
 *   - Response carries releaseUrl + packageUrl for the web pill.
 *
 * Cache-read tests use `seedCache` to write the file directly (no network),
 * so they're deterministic and don't depend on background-refresh timing
 * or registry reachability. Tests that exercise the network path stub
 * `fetch` explicitly.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	getUpdateCheck,
	peekUpdateCacheForTests,
	resetUpdateCheckForTests,
} from "./update-check.ts";

let savedDataDir: string | undefined;
let savedDisable: string | undefined;
let savedFetch: typeof fetch;
let tmpDir: string;

beforeEach(() => {
	savedDataDir = process.env.OMP_DECK_DATA_DIR;
	savedDisable = process.env.OMP_DECK_DISABLE_UPDATE_CHECK;
	savedFetch = globalThis.fetch;
	tmpDir = mkdtempSync(path.join(os.tmpdir(), "omp-deck-updatecheck-"));
	process.env.OMP_DECK_DATA_DIR = tmpDir;
	delete process.env.OMP_DECK_DISABLE_UPDATE_CHECK;
	resetUpdateCheckForTests();
});

afterEach(() => {
	if (savedDataDir === undefined) delete process.env.OMP_DECK_DATA_DIR;
	else process.env.OMP_DECK_DATA_DIR = savedDataDir;
	if (savedDisable === undefined) delete process.env.OMP_DECK_DISABLE_UPDATE_CHECK;
	else process.env.OMP_DECK_DISABLE_UPDATE_CHECK = savedDisable;
	globalThis.fetch = savedFetch;
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* best-effort */
	}
});

/**
 * Stub fetch to return a registry-shaped response with the given latest
 * version. Returns a small spy that records call count. `null` simulates a
 * 503 from the registry.
 */
function stubRegistry(latest: string | null): { calls: number } {
	const spy = { calls: 0 };
	globalThis.fetch = ((_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
		spy.calls += 1;
		if (latest === null) {
			return Promise.resolve(new Response("registry unreachable", { status: 503 }));
		}
		const body = JSON.stringify({ "dist-tags": { latest } });
		return Promise.resolve(new Response(body, { status: 200 }));
	}) as typeof fetch;
	return spy;
}

/** Write the cache file directly so tests don't depend on network timing. */
function seedCache(latest: string | null): void {
	const file = path.join(tmpDir, "update-check.json");
	writeFileSync(
		file,
		JSON.stringify(
			{ checkedAt: new Date().toISOString(), latest, registryUrl: "test://stub" },
			null,
			"\t",
		),
		"utf8",
	);
}

describe("update-check", () => {
	test("disabled env var → returns disabled, no fetch", async () => {
		process.env.OMP_DECK_DISABLE_UPDATE_CHECK = "1";
		const spy = stubRegistry("0.7.0");
		const res = await getUpdateCheck({ currentVersion: "0.6.0" });
		expect(res.disabled).toBe(true);
		expect(res.updateAvailable).toBe(false);
		expect(res.latest).toBeNull();
		expect(spy.calls).toBe(0);
		expect(peekUpdateCacheForTests()).toBeUndefined();
	});

	test("disabled accepts truthy variants (1, true) but not 0/false", async () => {
		// Stub the registry so the falsy-iterations' background fetch doesn't
		// hit npmjs.com — we're only testing flag handling here.
		stubRegistry(null);
		const truthy = ["1", "true", "TRUE", "yes"];
		const falsy = ["0", "false", "FALSE", ""];
		for (const v of truthy) {
			process.env.OMP_DECK_DISABLE_UPDATE_CHECK = v;
			const res = await getUpdateCheck({ currentVersion: "0.6.0" });
			expect({ v, disabled: res.disabled }).toEqual({ v, disabled: true });
		}
		for (const v of falsy) {
			process.env.OMP_DECK_DISABLE_UPDATE_CHECK = v;
			const res = await getUpdateCheck({ currentVersion: "0.6.0" });
			expect({ v, disabled: res.disabled }).toEqual({ v, disabled: false });
		}
	});

	test("cache hit with newer version → updateAvailable=true", async () => {
		seedCache("0.7.0");
		const res = await getUpdateCheck({ currentVersion: "0.6.0" });
		expect(res.current).toBe("0.6.0");
		expect(res.latest).toBe("0.7.0");
		expect(res.updateAvailable).toBe(true);
		expect(res.lastCheckedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
	});

	test("cache hit with same version → updateAvailable=false", async () => {
		seedCache("0.6.0");
		const res = await getUpdateCheck({ currentVersion: "0.6.0" });
		expect(res.latest).toBe("0.6.0");
		expect(res.updateAvailable).toBe(false);
	});

	test("cache hit with older version → updateAvailable=false (we're ahead)", async () => {
		seedCache("0.5.0");
		const res = await getUpdateCheck({ currentVersion: "0.6.0" });
		expect(res.latest).toBe("0.5.0");
		expect(res.updateAvailable).toBe(false);
	});

	test("semver-aware: 0.10.0 > 0.9.0 (not string-compared)", async () => {
		seedCache("0.10.0");
		const res = await getUpdateCheck({ currentVersion: "0.9.0" });
		expect(res.updateAvailable).toBe(true);
	});

	test("prerelease: 1.0.0-beta < 1.0.0", async () => {
		seedCache("1.0.0");
		const res = await getUpdateCheck({ currentVersion: "1.0.0-beta" });
		expect(res.updateAvailable).toBe(true);
	});

	test("registry error → cached latest:null → no update advertised", async () => {
		seedCache(null);
		const res = await getUpdateCheck({ currentVersion: "0.6.0" });
		expect(res.latest).toBeNull();
		expect(res.updateAvailable).toBe(false);
	});

	test("no cache + first call returns empty state and triggers background fetch", async () => {
		const spy = stubRegistry("0.7.0");
		const first = await getUpdateCheck({ currentVersion: "0.6.0" });
		// Initial call has no cache yet.
		expect(first.latest).toBeNull();
		expect(first.lastCheckedAt).toBeNull();
		expect(first.updateAvailable).toBe(false);
		// Background refresh kicks in.
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setTimeout(r, 50));
			if (peekUpdateCacheForTests()) break;
		}
		expect(spy.calls).toBeGreaterThan(0);
		// Subsequent call reflects the cache.
		const second = await getUpdateCheck({ currentVersion: "0.6.0" });
		expect(second.latest).toBe("0.7.0");
		expect(second.updateAvailable).toBe(true);
	});

	test("response shape includes releaseUrl + packageUrl for the web pill", async () => {
		seedCache("0.7.0");
		const res = await getUpdateCheck({ currentVersion: "0.6.0" });
		expect(res.releaseUrl).toMatch(/github\.com.*releases/);
		expect(res.packageUrl).toMatch(/npmjs\.com.*omp-deck/);
	});
});
