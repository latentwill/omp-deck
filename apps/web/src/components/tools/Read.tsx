import type { ToolRendererProps } from "./ToolCallCard";
import { ArgRow, PathChip, extractResultText } from "./shared";
import { CodeBlock } from "@/lib/code";
import { detectLangFromPath } from "@/lib/code";
import { shortPath } from "@/lib/utils";

export function ReadTool({ args, stream }: ToolRendererProps) {
	const path = String((args.path as string | undefined) ?? "");
	const result = stream?.result ?? stream?.partialResult;
	const text = result ? extractResultText(result) : "";
	const language = detectLangFromPath(path);

	return (
		<div className="space-y-1.5">
			<ArgRow k="path" v={<PathChip title={path}>{shortPath(path, 72)}</PathChip>} />
			{text ? <CodeBlock code={text} language={language} /> : null}
		</div>
	);
}
