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

interface Props {
	code: string;
	language?: string;
	className?: string;
	/** Strip a single common-leading indent before highlighting (handy for templates). */
	dedent?: boolean;
}

export function CodeBlock({ code, language, className, dedent }: Props) {
	const html = useMemo(() => {
		const text = dedent ? stripCommonIndent(code) : code;
		if (!text) return "";
		try {
			const lang = language ? normalizeLang(language) : undefined;
			if (lang && hljs.getLanguage(lang)) {
				return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
			}
			return hljs.highlightAuto(text).value;
		} catch {
			return escapeHtml(text);
		}
	}, [code, language, dedent]);

	return (
		<div className="group relative">
			<pre
				className={cn(
					"max-h-72 overflow-auto border-y border-line bg-paper-code px-4 py-3 font-mono text-2xs leading-relaxed",
					className,
				)}
			>
				<code
					className={cn("hljs", language ? `language-${normalizeLang(language)}` : undefined)}
					// hljs.highlight returns sanitized HTML keyed to its own class names.
					// eslint-disable-next-line react/no-danger
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			</pre>
			<CopyButton text={dedent ? stripCommonIndent(code) : code} />
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
