import type { ToolRendererProps } from "./ToolCallCard";
import { ArgRow, Pre, extractResultText } from "./shared";
import { CodeBlock } from "@/lib/code";
import { shortPath } from "@/lib/utils";

export function BashTool({ args, stream }: ToolRendererProps) {
	const command = String((args.command as string | undefined) ?? "");
	const cwd = (args.cwd as string | undefined) || undefined;
	const timeout = args.timeout as number | undefined;
	const result = stream?.result ?? stream?.partialResult;
	const text = result ? extractResultText(result) : "";

	const exitCode = (() => {
		if (!result || typeof result !== "object") return undefined;
		const r = result as Record<string, unknown>;
		if (typeof r.exitCode === "number") return r.exitCode;
		if (typeof r.code === "number") return r.code;
		return undefined;
	})();

	return (
		<div className="space-y-1.5">
			{command ? <CodeBlock code={command} language="bash" className="max-h-32" /> : null}
			{cwd ? <ArgRow k="cwd" v={shortPath(cwd, 60)} /> : null}
			{timeout ? <ArgRow k="timeout" v={`${timeout}s`} /> : null}
			{exitCode !== undefined ? <ArgRow k="exit" v={String(exitCode)} /> : null}
			{text ? <Pre>{text}</Pre> : null}
		</div>
	);
}
