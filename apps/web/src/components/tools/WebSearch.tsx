import type { ToolRendererProps } from "./ToolCallCard";
import { extractResultText } from "./shared";
import { Markdown } from "@/lib/markdown";

export function WebSearchTool({ args, stream }: ToolRendererProps) {
	const query = String((args.query as string | undefined) ?? "");
	const provider = (args.provider as string | undefined) ?? "auto";
	const result = stream?.result;
	const text = result ? extractResultText(result) : "";

	return (
		<div className="space-y-2">
			<div className="font-mono text-2xs">
				<span className="text-accent">{provider}</span>
				<span className="text-ink-3"> · </span>
				<span className="text-ink">{query}</span>
			</div>
			{text ? <Markdown className="text-[13px] text-ink-2">{text}</Markdown> : null}
		</div>
	);
}
