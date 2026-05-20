import type { IrcMsg } from "@/lib/types";
import { Markdown } from "@/lib/markdown";

export function IrcLine({ msg }: { msg: IrcMsg }) {
	return (
		<div className="border-l-2 border-line-strong pl-2 py-1">
			<div className="font-mono text-2xs uppercase tracking-meta text-ink-3">
				irc{msg.from ? ` · ${msg.from}` : ""}
				{msg.customType ? ` · ${msg.customType}` : ""}
			</div>
			<Markdown className="mt-1 text-[13px]">{msg.content}</Markdown>
		</div>
	);
}
