import type { QueuedPrompt } from "@/lib/types";
import { Markdown } from "@/lib/markdown";

/**
 * Renders a prompt the user sent while the agent was mid-turn. The SDK has
 * queued it and will run it as a fresh turn once the current one finishes,
 * so the bubble carries a "queued" badge until the SDK fires the real
 * user message_start (at which point the reducer drops it). Mirrors the
 * normal user-message shape so the chat doesn't feel like a different
 * surface — the difference is just the badge and a softer ink colour.
 */
export function QueuedMessage({ msg }: { msg: QueuedPrompt }) {
	return (
		<div className="space-y-1.5 opacity-70">
			<div className="meta">
				you
				<span className="ml-1.5 text-thinking">
					· queued{msg.behavior === "steer" ? " · steer" : ""}
				</span>
			</div>
			{msg.images && msg.images.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{msg.images.map((img, i) => (
						<img
							key={i}
							src={`data:${img.mimeType};base64,${img.data}`}
							alt={`queued ${i + 1}`}
							className="h-28 w-28 rounded border border-line object-cover"
						/>
					))}
				</div>
			) : null}
			{msg.text ? <Markdown>{msg.text}</Markdown> : null}
		</div>
	);
}
