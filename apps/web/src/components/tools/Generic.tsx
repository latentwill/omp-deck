import type { ToolRendererProps } from "./ToolCallCard";
import { ResultImages, extractResultText } from "./shared";
import { CopyButton } from "@/lib/CopyButton";

export function GenericTool({ args, stream }: ToolRendererProps) {
	const result = stream?.result;
	const partial = stream?.partialResult;
	const text = result ? extractResultText(result) : partial ? extractResultText(partial) : "";
	const argsText = JSON.stringify(args, null, 2);

	return (
		<div className="space-y-1.5">
			<details>
				<summary className="cursor-pointer font-mono text-2xs uppercase tracking-meta text-ink-3 hover:text-ink">
					args
				</summary>
				<div className="group relative mt-1">
					<pre className="max-h-48 overflow-auto bg-paper-code border-y border-line px-4 py-3 font-mono text-2xs leading-relaxed text-ink">
						{argsText}
					</pre>
					<CopyButton text={argsText} />
				</div>
			</details>
			{/* Render image blocks first — they're the headline output when a tool
			    returns visuals (MCP screenshots, future inspection tools, etc.). */}
			<ResultImages result={result ?? partial} />
			{text ? (
				<details open={!result}>
					<summary className="cursor-pointer font-mono text-2xs uppercase tracking-meta text-ink-3 hover:text-ink">
						{result ? "result" : "partial"}
					</summary>
					<div className="group relative mt-1">
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-paper-code border-y border-line px-4 py-3 font-mono text-2xs leading-relaxed text-ink">
							{text}
						</pre>
						<CopyButton text={text} />
					</div>
				</details>
			) : null}
		</div>
	);
}
