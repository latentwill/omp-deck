import type { ToolRendererProps } from "./ToolCallCard";
import { ArgRow, PathChip, Pre, extractResultText } from "./shared";
import { shortPath } from "@/lib/utils";

export function LspTool({ args, stream }: ToolRendererProps) {
	const action = String((args.action as string | undefined) ?? "");
	const file = (args.file as string | undefined) ?? undefined;
	const symbol = (args.symbol as string | undefined) ?? undefined;
	const query = (args.query as string | undefined) ?? undefined;
	const result = stream?.result ?? stream?.partialResult;
	const text = result ? extractResultText(result) : "";

	return (
		<div className="space-y-1.5">
			<div className="flex flex-wrap items-center gap-x-2 font-mono text-2xs">
				<span className="text-accent">{action || "?"}</span>
				{symbol ? <span className="text-ink">{symbol}</span> : null}
				{query ? <span className="text-ink-3">{query}</span> : null}
			</div>
			{file ? <ArgRow k="file" v={<PathChip>{shortPath(file, 72)}</PathChip>} /> : null}
			{text ? <Pre>{text}</Pre> : null}
		</div>
	);
}
