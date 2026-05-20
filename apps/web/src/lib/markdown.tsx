import { memo, type HTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "./utils";
import { CopyButton } from "./CopyButton";

interface Props {
	children: string;
	className?: string;
	streaming?: boolean;
}

export const Markdown = memo(function Markdown({ children, className, streaming }: Props) {
	return (
		<div className={cn("markdown text-sm", streaming && "cursor-blink", className)}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
				components={{ pre: CopyablePre }}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
});

/**
 * Override for the markdown `<pre>` block.
 *
 * react-markdown passes the original `<code>` element as `children`; we keep
 * it intact so `rehype-highlight`'s class tagging survives, and just add a
 * `group relative` wrapper plus the overlaid `<CopyButton>`. The wrapper has
 * no padding/border so the `.markdown pre` margin still collapses correctly
 * with surrounding paragraphs and lists.
 */
function CopyablePre({ children, ...rest }: HTMLAttributes<HTMLPreElement> & { children?: ReactNode }) {
	return (
		<div className="group relative">
			<pre {...rest}>{children}</pre>
			<CopyButton />
		</div>
	);
}
