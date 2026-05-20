import type { UserMsg } from "@/lib/types";
import { Markdown } from "@/lib/markdown";

export function UserMessage({ msg }: { msg: UserMsg }) {
	return (
		<div className="space-y-1.5">
			<div className="meta">
				you
				{msg.synthetic ? <span className="ml-1.5 text-thinking">· synthetic</span> : null}
			</div>
			{msg.images && msg.images.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{msg.images.map((img, i) => (
						<img
							key={i}
							src={`data:${img.mimeType};base64,${img.data}`}
							alt={`pasted ${i + 1}`}
							className="h-28 w-28 rounded border border-line object-cover"
						/>
					))}
				</div>
			) : null}
			{msg.text ? <Markdown>{msg.text}</Markdown> : null}
		</div>
	);
}
