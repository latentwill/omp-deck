/**
 * Standalone syntax-highlighted code block.
 *
 * The Markdown pipeline already uses `rehype-highlight` for fenced code blocks
 * in assistant text. For tool surfaces that hold known-language code outside
 * markdown (the `eval` cell, the `bash` command, snippets in `read` results
 * for code files), we render through highlight.js directly so we don't pay
 * the markdown parse cost or accidentally re-format other content.
 *
 * Theme classes (`.hljs`, `.hljs-keyword`, etc.) come from the
 * `highlight.js/styles/atom-one-light.css` import in `styles.css`.
 */

import { useMemo } from "react";
import hljs from "highlight.js/lib/common";
import { cn } from "./utils";
import { CopyButton } from "./CopyButton";

/**
 * Cap on the input size we'll pass through highlight.js. Above this the cost
 * of regex-based highlighting blocks the main thread long enough to be felt
 * — and very large blobs are almost always logs/data rather than code anyway.
 * Tune by feel; 256 KB covers the largest real-world tool outputs I've seen.
 */
const MAX_HIGHLIGHT_BYTES = 256 * 1024;

/**
 * Sniff for binary content by checking for NUL bytes in the first 1 KB.
 * Cheap, correct for text vs. compiled artifacts; mis-classifies UTF-16
 * (rare in tool outputs) but the consequence is just falling back to a
 * plain pre, which is the safe default.
 */
function looksBinary(s: string): boolean {
	const limit = Math.min(s.length, 1024);
	for (let i = 0; i < limit; i++) {
		if (s.charCodeAt(i) === 0) return true;
	}
	return false;
}

interface Props {
	code: string;
	language?: string;
	className?: string;
	/** Strip a single common-leading indent before highlighting (handy for templates). */
	dedent?: boolean;
}

export function CodeBlock({ code, language, className, dedent }: Props) {
	const text = dedent ? stripCommonIndent(code) : code;
	const oversized = text.length > MAX_HIGHLIGHT_BYTES;
	const binary = !oversized && looksBinary(text);
	const html = useMemo(() => {
		if (!text || oversized || binary) return "";
		try {
			const lang = language ? normalizeLang(language) : undefined;
			if (lang && hljs.getLanguage(lang)) {
				return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
			}
			return hljs.highlightAuto(text).value;
		} catch {
			return escapeHtml(text);
		}
	}, [text, language, oversized, binary]);

	const preClass = cn(
		"max-h-72 overflow-auto border-y border-line bg-paper-code px-4 py-3 font-mono text-2xs leading-relaxed",
		className,
	);

	if (oversized || binary) {
		const banner = binary
			? `Binary content (${text.length.toLocaleString()} bytes) — highlighting skipped`
			: `Output too large to highlight (${(text.length / 1024).toFixed(0)} KB)`;
		return (
			<div className="group relative">
				<pre className={preClass}>
					<div className="mb-1 select-none text-ink-3">{banner}</div>
					<code>{binary ? "[binary]" : text}</code>
				</pre>
				<CopyButton text={text} />
			</div>
		);
	}

	return (
		<div className="group relative">
			<pre className={preClass}>
				<code
					className={cn("hljs", language ? `language-${normalizeLang(language)}` : undefined)}
					// hljs.highlight returns sanitized HTML keyed to its own class names.
					// eslint-disable-next-line react/no-danger
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			</pre>
			<CopyButton text={text} />
		</div>
	);
}

/**
 * Render JSON-shaped text with syntax highlighting; fall back to a plain
 * monospace block when the input doesn't parse as JSON. Use for tool surfaces
 * (Bash stdout, Eval output, generic Browser/Task results) where the payload
 * is *often* JSON but not guaranteed and we don't want to mangle plain text.
 *
 * The heuristic is intentionally cheap: cheapest test first (first non-space
 * char must be `{` or `[`), then a single `JSON.parse`. The `try/catch`
 * swallows partial streams and JS-object literals that look JSON-ish but
 * aren't ({a: 1} with unquoted keys, trailing commas, etc.).
 */
export function MaybeJsonBlock({ text, className }: { text: string; className?: string }) {
	const first = text.trimStart().charAt(0);
	if (first !== "{" && first !== "[") {
		return <PlainBlock text={text} className={className} />;
	}
	try {
		const pretty = JSON.stringify(JSON.parse(text), null, 2);
		return <CodeBlock code={pretty} language="json" className={className} />;
	} catch {
		return <PlainBlock text={text} className={className} />;
	}
}

/**
 * Plain monospace block — visual match for `Pre` in `tools/shared.tsx`,
 * inlined here to keep `lib/` free of dependencies on `components/`.
 */
export function PlainBlock({ text, className }: { text: string; className?: string }) {
	return (
		<div className="group relative">
			<pre
				className={cn(
					"max-h-72 overflow-auto whitespace-pre-wrap break-words bg-paper-code border-y border-line px-4 py-3 font-mono text-2xs leading-relaxed text-ink",
					className,
				)}
			>
				{text}
			</pre>
			<CopyButton text={text} />
		</div>
	);
}

/** Detect language from a file path, returning `undefined` if unknown. */
export function detectLangFromPath(p: string | undefined): string | undefined {
	if (!p) return undefined;
	const m = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(p);
	if (!m || !m[1]) return undefined;
	const ext = m[1].toLowerCase();
	return EXT_TO_LANG[ext];
}

const EXT_TO_LANG: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	mts: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	rs: "rust",
	go: "go",
	rb: "ruby",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	hpp: "cpp",
	hxx: "cpp",
	cs: "csharp",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "ini",
	ini: "ini",
	md: "markdown",
	markdown: "markdown",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "bash",
	ps1: "powershell",
	sql: "sql",
	html: "xml",
	xml: "xml",
	svg: "xml",
	css: "css",
	scss: "scss",
	less: "less",
	lua: "lua",
	r: "r",
	dockerfile: "dockerfile",
};

function normalizeLang(lang: string): string {
	const lower = lang.toLowerCase();
	if (lower === "py") return "python";
	if (lower === "js") return "javascript";
	if (lower === "ts") return "typescript";
	if (lower === "rs") return "rust";
	if (lower === "yml") return "yaml";
	if (lower === "shell" || lower === "sh") return "bash";
	if (lower === "ps" || lower === "ps1") return "powershell";
	return lower;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function stripCommonIndent(s: string): string {
	const lines = s.split(/\r?\n/);
	let min = Infinity;
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		const m = /^(\s*)/.exec(line);
		const indent = m?.[1]?.length ?? 0;
		if (indent < min) min = indent;
	}
	if (!Number.isFinite(min) || min === 0) return s;
	return lines.map((l) => l.slice(min)).join("\n");
}
