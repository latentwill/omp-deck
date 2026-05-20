/**
 * KB Cockpit backend.
 *
 * Walks the user's Karpathy-style llm-wiki at `~/kb` (or `OMP_DECK_KB_ROOT`),
 * caches an inventory of every reachable markdown file, and resolves
 * `[[wikilinks]]` against it. The deck cockpit's `/kb` view + graph view
 * consume the output of this service.
 *
 * Design highlights (per docs/proposals/kb-cockpit.md):
 * - Top-level skip set matches orphan-census.py's conventions, PLUS the
 *   user-approved `projects/` exclusion. Mixed-signal projects/ tree stays
 *   out of v1.
 * - Symlinks/junctions (e.g. `cryptocracy/`) are followed once, by tracking
 *   visited absolute paths to break cycles.
 * - Wikilink resolution is stem-first with subpath fallback; code blocks
 *   are stripped before extraction so regex-literal noise (`[[:alpha:]]`)
 *   doesn't leak into the link table.
 * - YAML frontmatter parsing uses the `yaml` package — kb files have real
 *   arrays / nested objects and a header-grep approach is insufficient.
 *
 * The service is read-only at v1; T-36 introduces PUT/POST. The watcher
 * (T-34 bottom) fires `kb_changed` on any mutation so subsequent reads see
 * fresh data after `rebuildIndex()` is called by the watcher.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import YAML from "yaml";

import type {
	KbFileResponse,
	KbTreeEntry,
	KbTreeResponse,
	KbWikilink,
} from "@omp-deck/protocol";

import { logger } from "./log.ts";

const log = logger("kb");

// Top-level (anywhere in the tree) directory names to skip. Mirrors the
// canonical set in my-org-new/scripts/orphan-census.py, plus the v1-locked
// projects/ skip per docs/proposals/kb-cockpit.md.
const SKIP_DIR_NAMES = new Set<string>([
	".git",
	".github",
	"node_modules",
	"target",
	".venv",
	"venv",
	"__pycache__",
	"dist",
	"build",
	".next",
	".nuxt",
	".idea",
	".vscode",
	"projects",
]);

// Skill-creator and related .agents/skills dirs we don't want surfaced.
const SKIP_PATH_FRAGMENTS = [".agents/skills"];

// Ambiguous stems that should never resolve by stem-match alone. Force the
// author to use a subpath. Mirrors orphan-census.py's `AMBIGUOUS_STEMS`.
const AMBIGUOUS_STEMS = new Set<string>([
	"readme",
	"index",
	"profile",
	"skill",
	"summary",
	"notes",
]);

// Wikilink: `[[target|label]]`. Target may include `dir/path` and `#anchor`.
// We deliberately exclude `]` and `|` from the target capture so labels work.
const WIKILINK_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;

// Fenced code blocks and inline backtick spans — wikilinks inside them are
// almost always documentation/regex noise (`[[:alpha:]]`), not real links.
const FENCED_CODE_RE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

interface FileRecord {
	relPath: string; // forward-slash kb-relative
	absPath: string;
	dir: string; // forward-slash relative dir, "" for root
	stem: string; // lowercase filename stem (no .md)
	size: number;
	mtime: Date;
}

export interface KbServiceOptions {
	root: string;
}

export class KbService {
	readonly root: string;
	private records: FileRecord[] = [];
	private byRelPath = new Map<string, FileRecord>();
	private byStem = new Map<string, FileRecord[]>();
	private indexReady = false;
	private indexPromise: Promise<void> | undefined;

	constructor(opts: KbServiceOptions) {
		// Always store the root as an absolute path with native separators.
		this.root = path.resolve(opts.root);
	}

	/** Lazy build on first request; subsequent calls reuse the cache. */
	async ensureIndex(): Promise<void> {
		if (this.indexReady) return;
		if (this.indexPromise) return this.indexPromise;
		this.indexPromise = this.buildIndex();
		try {
			await this.indexPromise;
		} finally {
			this.indexPromise = undefined;
		}
	}

	/** Invalidate cache + rebuild on next request. Called by the watcher. */
	invalidate(): void {
		this.indexReady = false;
	}

	/**
	 * Return a single directory listing. `subpath` is forward-slash relative
	 * to the kb root; empty / "/" means root. Returns `undefined` if the
	 * path doesn't exist or escapes the kb root.
	 */
	async getTree(subpath: string = ""): Promise<KbTreeResponse | undefined> {
		await this.ensureIndex();
		const cleanRel = normalizeRel(subpath);
		// Reject traversal into any path whose segments include an excluded
		// directory — keeps `/api/kb/tree?path=projects` 404 even though
		// `projects` exists on disk.
		if (this.pathIsExcluded(cleanRel)) return undefined;
		const absDir = this.resolveAbs(cleanRel);
		if (!absDir) return undefined;
		try {
			const st = await stat(absDir);
			if (!st.isDirectory()) return undefined;
		} catch {
			return undefined;
		}

		let entries;
		try {
			entries = await readdir(absDir, { withFileTypes: true });
		} catch (err) {
			log.warn(`readdir failed at ${absDir}`, err);
			return { path: cleanRel, dirs: [], files: [] };
		}

		const dirs: KbTreeEntry[] = [];
		const files: KbTreeEntry[] = [];
		for (const entry of entries) {
			if (this.shouldSkip(entry.name, joinRel(cleanRel, entry.name))) continue;
			const relPath = joinRel(cleanRel, entry.name);
			const abs = path.join(absDir, entry.name);

			if (entry.isDirectory() || entry.isSymbolicLink()) {
				let isDir = entry.isDirectory();
				let isSymlink = entry.isSymbolicLink();
				if (isSymlink) {
					try {
						const st = await stat(abs); // follows
						isDir = st.isDirectory();
					} catch {
						continue;
					}
				}
				if (!isDir) continue;
				const mdCount = this.recursiveMdCount(relPath);
				const item: KbTreeEntry = {
					name: entry.name,
					path: relPath,
					kind: "dir",
					mdCount,
				};
				if (isSymlink) item.symlink = true;
				dirs.push(item);
				continue;
			}

			if (!entry.isFile()) continue;
			if (!entry.name.toLowerCase().endsWith(".md")) continue;
			let st;
			try {
				st = await stat(abs);
			} catch {
				continue;
			}
			files.push({
				name: entry.name,
				path: relPath,
				kind: "file",
				size: st.size,
				mtime: st.mtime.toISOString(),
			});
		}

		// Stable ordering: dirs by name asc; files by name asc. Future: surface
		// hubs first within a dir — out of v1.
		dirs.sort((a, b) => a.name.localeCompare(b.name));
		files.sort((a, b) => a.name.localeCompare(b.name));
		return { path: cleanRel, dirs, files };
	}

	/**
	 * Read a single file's parsed body. `subpath` is forward-slash
	 * relative; must end in `.md` (caller usually clicked a tree entry).
	 * Returns undefined when the path is missing, isn't a file, or escapes
	 * the kb root.
	 */
	async getFile(subpath: string): Promise<KbFileResponse | undefined> {
		await this.ensureIndex();
		const cleanRel = normalizeRel(subpath);
		if (!cleanRel) return undefined;
		if (this.pathIsExcluded(cleanRel)) return undefined;
		const abs = this.resolveAbs(cleanRel);
		if (!abs) return undefined;

		let raw: string;
		let st;
		try {
			st = await stat(abs);
			if (!st.isFile()) return undefined;
			raw = await readFile(abs, "utf8");
		} catch {
			return undefined;
		}

		const { frontmatter, frontmatterError, body } = parseFrontmatter(raw);
		const sourceDir = path.posix.dirname(cleanRel);
		const outgoingLinks = this.extractWikilinks(body, sourceDir === "." ? "" : sourceDir);

		const resp: KbFileResponse = {
			path: cleanRel,
			absolutePath: abs,
			frontmatter,
			body,
			outgoingLinks,
			size: st.size,
			mtime: st.mtime.toISOString(),
		};
		if (frontmatterError) resp.frontmatterError = frontmatterError;
		return resp;
	}

	// ─── internals ───────────────────────────────────────────────────────

	private async buildIndex(): Promise<void> {
		const t0 = performance.now();
		this.records = [];
		this.byRelPath.clear();
		this.byStem.clear();

		if (!existsSync(this.root)) {
			log.warn(`kb root does not exist: ${this.root}`);
			this.indexReady = true;
			return;
		}

		const visited = new Set<string>();
		await this.walk(this.root, "", visited);

		for (const r of this.records) {
			this.byRelPath.set(r.relPath, r);
			const list = this.byStem.get(r.stem);
			if (list) list.push(r);
			else this.byStem.set(r.stem, [r]);
		}

		const ms = (performance.now() - t0).toFixed(1);
		log.info(`indexed ${this.records.length} md files under ${this.root} in ${ms}ms`);
		this.indexReady = true;
	}

	private async walk(absDir: string, relDir: string, visited: Set<string>): Promise<void> {
		let real;
		try {
			real = await realpath(absDir);
		} catch {
			return;
		}
		if (visited.has(real)) return;
		visited.add(real);

		let entries;
		try {
			entries = await readdir(absDir, { withFileTypes: true });
		} catch (err) {
			log.warn(`readdir failed: ${absDir}`, err);
			return;
		}

		for (const entry of entries) {
			const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
			if (this.shouldSkip(entry.name, rel)) continue;
			const abs = path.join(absDir, entry.name);

			if (entry.isDirectory() || entry.isSymbolicLink()) {
				try {
					const st = await stat(abs);
					if (st.isDirectory()) {
						await this.walk(abs, rel, visited);
					}
				} catch {
					// stat failure on symlink target; skip silently
				}
				continue;
			}

			if (!entry.isFile()) continue;
			if (!entry.name.toLowerCase().endsWith(".md")) continue;

			try {
				const st = await stat(abs);
				const stem = entry.name.slice(0, -3).toLowerCase();
				this.records.push({
					relPath: rel,
					absPath: abs,
					dir: relDir,
					stem,
					size: st.size,
					mtime: st.mtime,
				});
			} catch {
				// best-effort
			}
		}
	}

	private shouldSkip(name: string, rel: string): boolean {
		if (SKIP_DIR_NAMES.has(name)) return true;
		for (const frag of SKIP_PATH_FRAGMENTS) {
			if (rel.includes(frag)) return true;
		}
		return false;
	}

	private pathIsExcluded(rel: string): boolean {
		if (!rel) return false;
		for (const seg of rel.split("/")) {
			if (SKIP_DIR_NAMES.has(seg)) return true;
		}
		for (const frag of SKIP_PATH_FRAGMENTS) {
			if (rel.includes(frag)) return true;
		}
		return false;
	}

	private resolveAbs(rel: string): string | undefined {
		// Reject any rel that escapes the root via `..` or absolute paths.
		if (rel.includes("..") || path.isAbsolute(rel)) return undefined;
		const abs = rel ? path.join(this.root, rel) : this.root;
		const resolved = path.resolve(abs);
		const rootResolved = path.resolve(this.root);
		if (!resolved.startsWith(rootResolved)) return undefined;
		return resolved;
	}

	private recursiveMdCount(relDir: string): number {
		// Cheap O(n) scan against the cached index. n ~ 600 for this kb.
		if (!relDir) return this.records.length;
		const prefix = `${relDir}/`;
		let n = 0;
		for (const r of this.records) {
			if (r.relPath.startsWith(prefix)) n++;
		}
		return n;
	}

	private extractWikilinks(body: string, sourceDir: string): KbWikilink[] {
		const stripped = body.replace(FENCED_CODE_RE, "").replace(INLINE_CODE_RE, "");
		const out: KbWikilink[] = [];
		for (const m of stripped.matchAll(WIKILINK_RE)) {
			const rawTarget = m[1].trim();
			const label = (m[2] ?? rawTarget).trim();
			let target = rawTarget;
			let anchor: string | null = null;
			const hashAt = target.indexOf("#");
			if (hashAt >= 0) {
				anchor = target.slice(hashAt + 1) || null;
				target = target.slice(0, hashAt);
			}
			target = target.trim();
			const raw = m[2] !== undefined ? `${target}${anchor ? `#${anchor}` : ""}|${label}` : `${target}${anchor ? `#${anchor}` : ""}`;
			const link: KbWikilink = {
				raw,
				target,
				label,
				anchor,
				resolved: null,
			};
			if (!target) {
				link.unresolvedReason = "no-match";
				out.push(link);
				continue;
			}
			const resolution = this.resolveTarget(target, sourceDir);
			if (resolution.resolved) {
				link.resolved = resolution.resolved;
			} else {
				link.unresolvedReason = resolution.reason;
			}
			out.push(link);
		}
		return out;
	}

	private resolveTarget(
		target: string,
		sourceDir: string,
	): { resolved: string | null; reason?: KbWikilink["unresolvedReason"] } {
		const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
		// Subpath form: contains a slash → resolve as relative to kb root.
		if (normalized.includes("/")) {
			const withExt = normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
			const rec = this.byRelPath.get(withExt);
			if (rec) return { resolved: rec.relPath };
			return { resolved: null, reason: "no-match" };
		}

		// Stem-only form.
		const stem = normalized.toLowerCase().endsWith(".md")
			? normalized.slice(0, -3).toLowerCase()
			: normalized.toLowerCase();
		if (AMBIGUOUS_STEMS.has(stem)) {
			return { resolved: null, reason: "ambiguous-stem" };
		}
		const candidates = this.byStem.get(stem);
		if (!candidates || candidates.length === 0) {
			return { resolved: null, reason: "no-match" };
		}
		if (candidates.length === 1) return { resolved: candidates[0].relPath };

		// Tiebreaker: prefer same-directory, then nearest-ancestor, then
		// alphabetical relPath.
		const sameDir = candidates.find((c) => c.dir === sourceDir);
		if (sameDir) return { resolved: sameDir.relPath };
		const sorted = [...candidates].sort((a, b) => a.relPath.localeCompare(b.relPath));
		return { resolved: sorted[0].relPath };
	}
}

// ─── helpers ───────────────────────────────────────────────────────────────

function normalizeRel(p: string): string {
	if (!p) return "";
	// Strip leading/trailing slashes, collapse repeated slashes, force forward.
	return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function joinRel(parent: string, child: string): string {
	if (!parent) return child;
	return `${parent}/${child}`;
}

/**
 * Frontmatter parser: extracts the leading `---\n…\n---\n` block (if any),
 * runs it through `yaml`, and returns `{ frontmatter, frontmatterError,
 * body }`. Body is the file content with the block stripped (one trailing
 * newline consumed). When YAML parsing fails we return the raw block as a
 * string under `frontmatter._raw` with an error message, so the editor can
 * surface the problem instead of silently dropping the metadata.
 */
function parseFrontmatter(text: string): {
	frontmatter: Record<string, unknown>;
	frontmatterError?: string;
	body: string;
} {
	if (!text.startsWith("---")) return { frontmatter: {}, body: text };
	const end = text.indexOf("\n---", 3);
	if (end < 0) return { frontmatter: {}, body: text };
	const rawBlock = text.slice(4, end);
	let cursor = end + 4;
	if (text[cursor] === "\r") cursor += 1;
	if (text[cursor] === "\n") cursor += 1;
	const body = text.slice(cursor);

	let frontmatter: Record<string, unknown> = {};
	let frontmatterError: string | undefined;
	try {
		const parsed = YAML.parse(rawBlock);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			frontmatter = parsed as Record<string, unknown>;
		} else if (parsed !== null) {
			frontmatter = { _raw: rawBlock };
			frontmatterError = "frontmatter was not a YAML mapping";
		}
	} catch (err) {
		frontmatter = { _raw: rawBlock };
		frontmatterError = (err as Error).message;
	}
	return frontmatterError ? { frontmatter, frontmatterError, body } : { frontmatter, body };
}

export function resolveKbRoot(): string {
	const fromEnv = process.env.OMP_DECK_KB_ROOT;
	if (fromEnv && fromEnv.trim().length > 0) return path.resolve(fromEnv.trim());
	return path.join(os.homedir(), "kb");
}
