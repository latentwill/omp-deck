import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
	header: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
	className?: string;
	headerClassName?: string;
}

export function Collapsible({
	header,
	children,
	defaultOpen = false,
	className,
	headerClassName,
}: Props) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className={cn("border-l border-line", className)}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={cn(
					"flex w-full items-center gap-1.5 pl-2 py-0.5 text-left text-xs hover:text-ink",
					headerClassName,
				)}
			>
				<ChevronRight
					className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
				/>
				<div className="min-w-0 flex-1">{header}</div>
			</button>
			{open ? <div className="pl-2 pt-1 pb-2">{children}</div> : null}
		</div>
	);
}
