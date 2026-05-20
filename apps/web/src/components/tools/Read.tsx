import type { ToolRendererProps } from "./ToolCallCard";
import { ArgRow, PathChip, Pre, extractResultText } from "./shared";
import { shortPath } from "@/lib/utils";

export function ReadTool({ args, stream }: ToolRendererProps) {
	const path = String((args.path as string | undefined) ?? "");
	const result = stream?.result ?? stream?.partialResult;
	const text = result ? extractResultText(result) : "";

	return (
		<div className="space-y-1.5">
			<ArgRow k="path" v={<PathChip title={path}>{shortPath(path, 72)}</PathChip>} />
			{text ? <Pre>{text}</Pre> : null}
		</div>
	);
}
