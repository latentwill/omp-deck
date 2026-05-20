import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "icon";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
}

const variants: Record<Variant, string> = {
	primary: "bg-ink text-paper-2 hover:bg-ink-2 disabled:bg-line-strong disabled:text-paper-2",
	ghost: "text-ink-2 hover:bg-paper-3 disabled:text-ink-4",
	danger: "bg-danger text-paper-2 hover:bg-danger/85 disabled:opacity-50",
	outline: "border border-line text-ink hover:bg-paper-3 disabled:opacity-50",
};

const sizes: Record<Size, string> = {
	sm: "h-7 px-2 text-xs gap-1",
	md: "h-8 px-3 text-sm gap-1.5",
	icon: "h-8 w-8 p-0",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
	{ className, variant = "ghost", size = "md", ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			className={cn(
				"inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 disabled:cursor-not-allowed",
				variants[variant],
				sizes[size],
				className,
			)}
			{...rest}
		/>
	);
});
