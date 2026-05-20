import type { ToolRendererProps } from "./ToolCallCard";
import { ArgRow, PathChip, Pre, extractResultText, SectionLabel } from "./shared";
import { formatBytes, shortPath } from "@/lib/utils";

export function WriteTool({ args, stream }: ToolRendererProps) {
	const path = String((args.path as string | undefined) ?? "");
	const content = String((args.content as string | undefined) ?? "");
	const bytes = new Blob([content]).size;
	const result = stream?.result;
	const resultText = result ? extractResultText(result) : "";
	const lineCount = content.split(/\r?\n/).length;

	return (
		<div className="space-y-1.5">
			<ArgRow k="path" v={<PathChip title={path}>{shortPath(path, 72)}</PathChip>} />
			<ArgRow k="size" v={`${formatBytes(bytes)} · ${lineCount} line${lineCount === 1 ? "" : "s"}`} />
			{content ? (
				<details>
					<summary className="cursor-pointer font-mono text-2xs uppercase tracking-meta text-ink-3 hover:text-ink">
						body
					</summary>
					<div className="mt-1">
						<Pre>{content}</Pre>
					</div>
				</details>
			) : null}
			{resultText ? <div className="font-mono text-2xs text-ink-3">{resultText}</div> : null}
		</div>
	);
}
