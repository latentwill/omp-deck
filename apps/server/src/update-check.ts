/**
 * Update check — polls the npm registry once per day to see whether a newer
 * version of `omp-deck` is available. Surfaces the result through
 * `GET /api/version`; the web layer renders a passive pill in the StatusBar
 * when `updateAvailable === true`.
 *
 * Design constraints:
 *   - **Never auto-update.** We only inform; the user decides when to run
 *     `npm install -g omp-deck@latest`. Auto-replacing the running install
 *     under the user is a hard no.
 *   - **Never block the app.** The boot fetch is fire-and-forget. The
 *     /api/version route returns the cached value immediately and triggers
 *     a background refresh if stale.
 *   - **Never leak telemetry.** The fetch hits npmjs.com — same destination
 *     as the install itself. We don't include the user's version in the
 *     request beyond the standard User-Agent (which npm itself would emit).
 *   - **Always graceful on failure.** Registry down? Cache file corrupt?
 *     Network proxy blocks us? Disable via env var? All paths return
 *     `updateAvailable: false`. The pill disappears, the rest of the deck
 *     keeps working.
 *   - **Honors `OMP_DECK_DISABLE_UPDATE_CHECK=1`** for users on locked-down
 *     networks or who just don't want the chrome.
 *
 * Cache layout (`<dataDir>/update-check.json`):
 *   {
 *     "checkedAt": "2026-05-29T23:00:00.000Z",
 *     "latest": "0.7.0" | null,
 *     "registryUrl": "https://registry.npmjs.org/omp-deck"
 *   }
 *
 * `latest: null` means "we tried and got an error" — distinct from "cache
 * empty, never fetched."
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { getDataDir } from "./env-store.ts";
import { logger } from "./log.ts";

const log = logger("update-check");

const REGISTRY_URL = "https://registry.npmjs.org/omp-deck";
const PACKAGE_PAGE_URL = "https://www.npmjs.com/package/omp-deck";
const RELEASES_URL = "https://github.com/bjb2/omp-deck/releases";
const CACHE_FILE = "update-check.json";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
const FETCH_TIMEOUT_MS = 5_000;

interface CachedCheck {
	checkedAt: string;
	latest: string | null;
	registryUrl: string;
}

interface UpdateCheckOptions {
	/**
	 * Override the running deck's version. Caller is expected to pass the
	 * authoritative value from `build-info.ts`. Kept explicit (rather than
	 * importing build-info here) so unit tests can swap it cleanly.
	 */
	currentVersion: string;
}

/** Server-facing result; serialized to the web verbatim via the route handler. */
export interface UpdateCheckResult {
	current: string;
	latest: string | null;
	updateAvailable: boolean;
	lastCheckedAt: string | null;
	releaseUrl: string;
	packageUrl: string;
	disabled: boolean;
}

function isDisabled(): boolean {
	const raw = process.env.OMP_DECK_DISABLE_UPDATE_CHECK?.trim();
	if (!raw) return false;
	return raw !== "0" && raw.toLowerCase() !== "false";
}

function getCachePath(): string {
	return path.join(getDataDir(), CACHE_FILE);
}

function readCache(): CachedCheck | undefined {
	const p = getCachePath();
	if (!existsSync(p)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(p, "utf8")) as CachedCheck;
		if (typeof parsed.checkedAt !== "string") return undefined;
		// `latest` may legitimately be null (means "tried and errored"); only
		// reject if the field is missing entirely.
		if (!("latest" in parsed)) return undefined;
		return parsed;
	} catch (err) {
		log.warn(`cache read failed at ${p}`, err);
		return undefined;
	}
}

function writeCache(cache: CachedCheck): void {
	const p = getCachePath();
	try {
		mkdirSync(path.dirname(p), { recursive: true });
		writeFileSync(p, `${JSON.stringify(cache, null, "\t")}\n`, "utf8");
	} catch (err) {
		log.warn(`cache write failed at ${p}`, err);
	}
}

function cacheIsFresh(cache: CachedCheck | undefined, now: number = Date.now()): boolean {
	if (!cache) return false;
	const checked = Date.parse(cache.checkedAt);
	if (!Number.isFinite(checked)) return false;
	return now - checked < REFRESH_INTERVAL_MS;
}

/**
 * Hit the npm registry's package metadata endpoint, parse the version off
 * the `dist-tags.latest` field. Returns `null` on any failure (network,
 * timeout, bad JSON, missing field) — caller decides what to do with that.
 * Never throws.
 */
async function fetchLatestFromRegistry(): Promise<string | null> {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(REGISTRY_URL, {
			signal: ac.signal,
			headers: {
				// Ask for the abbreviated metadata document — smaller payload,
				// same `dist-tags`.
				Accept: "application/vnd.npm.install-v1+json",
			},
		});
		if (!res.ok) {
			log.warn(`registry returned ${res.status}`);
			return null;
		}
		const body = (await res.json()) as { "dist-tags"?: { latest?: unknown } };
		const latest = body["dist-tags"]?.latest;
		if (typeof latest !== "string" || latest.length === 0) {
			log.warn(`registry response missing dist-tags.latest`);
			return null;
		}
		return latest;
	} catch (err) {
		log.warn(`registry fetch failed`, err);
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Compare two semver strings. Returns:
 *   - negative if a < b
 *   - 0       if a === b
 *   - positive if a > b
 *
 * Wraps `Bun.semver.order` which handles prereleases, build metadata, and
 * malformed input correctly. Returns 0 (treat as no update) when either
 * input is unparseable — safer than guessing.
 */
function compareVersions(a: string, b: string): number {
	try {
		return Bun.semver.order(a, b);
	} catch {
		return 0;
	}
}

/**
 * Refresh the cache by hitting the registry. Best-effort: errors update the
 * cache with `latest: null` and a fresh timestamp, so we don't hammer the
 * registry on every page load if it's down.
 */
async function refreshCache(): Promise<CachedCheck> {
	const latest = await fetchLatestFromRegistry();
	const cache: CachedCheck = {
		checkedAt: new Date().toISOString(),
		latest,
		registryUrl: REGISTRY_URL,
	};
	writeCache(cache);
	if (latest) log.info(`update check refreshed: latest=${latest}`);
	return cache;
}

/**
 * Public: read the current update-check state. Cheap (cache-only). If the
 * cache is stale, fires a background refresh that updates the cache for
 * the NEXT call — never blocks this one. Disabled paths short-circuit.
 */
export async function getUpdateCheck(opts: UpdateCheckOptions): Promise<UpdateCheckResult> {
	const base: UpdateCheckResult = {
		current: opts.currentVersion,
		latest: null,
		updateAvailable: false,
		lastCheckedAt: null,
		releaseUrl: RELEASES_URL,
		packageUrl: PACKAGE_PAGE_URL,
		disabled: isDisabled(),
	};
	if (base.disabled) return base;

	const cache = readCache();
	if (cache) {
		base.latest = cache.latest;
		base.lastCheckedAt = cache.checkedAt;
		base.updateAvailable =
			cache.latest !== null && compareVersions(cache.latest, opts.currentVersion) > 0;
	}

	// Stale or never-fetched → background refresh. We don't await the
	// promise so this call returns whatever's cached (or nothing) right now.
	// The next call sees the fresh result.
	if (!cacheIsFresh(cache)) {
		void refreshCache().catch((err) => log.warn("background refresh failed", err));
	}

	return base;
}

/**
 * Fire a refresh from server boot. The result is not used here; it just
 * primes the cache so the first /api/version call on a fresh install
 * returns a real answer instead of "never checked".
 */
export function primeUpdateCheckOnBoot(): void {
	if (isDisabled()) return;
	const cache = readCache();
	if (cacheIsFresh(cache)) return;
	// Tiny delay so boot path isn't competing for IO with whatever else is
	// starting up. We're never blocking anything regardless.
	setTimeout(() => {
		void refreshCache().catch((err) => log.warn("boot refresh failed", err));
	}, 5_000);
}

/** Test-only: wipe the cache so a test can simulate a never-checked install. */
export function resetUpdateCheckForTests(): void {
	const p = getCachePath();
	if (existsSync(p)) {
		try {
			unlinkSync(p);
		} catch {
			/* best-effort */
		}
	}
}

/** Test-only: read the cache as-is. Returns undefined if absent. */
export function peekUpdateCacheForTests(): CachedCheck | undefined {
	return readCache();
}
