import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

interface Props {
	value: string;
	onChange: (next: string) => void;
	/** Fires when the user commits the edit (blur or ctrl/cmd+enter). */
	onCommit?: (next: string) => void;
	placeholder?: string;
	className?: string;
	textareaClassName?: string;
	/** Force edit mode on mount (used when value is empty so user knows it's editable). */
	autoEdit?: boolean;
}

/**
 * Notebook-style markdown surface. Reads as rendered markdown by default; click
 * (or tab into) the body to swap to a textarea for editing. Tab away or hit
 * ⌘/Ctrl+Enter to commit, Esc to cancel and restore.
 */
export function MarkdownEdit({
	value,
	onChange,
	onCommit,
	placeholder = "Click to add notes…",
	className,
	textareaClassName,
	autoEdit,
}: Props) {
	const [editing, setEditing] = useState(Boolean(autoEdit) || !value);
	const [draft, setDraft] = useState(value);
	const taRef = useRef<HTMLTextAreaElement>(null);

	// Sync down when the canonical value changes from outside (resave, swap item).
	useEffect(() => {
		setDraft(value);
	}, [value]);

	useEffect(() => {
		if (!editing) return;
		const ta = taRef.current;
		if (!ta) return;
		ta.focus();
		ta.style.height = "auto";
		ta.style.height = `${Math.max(ta.scrollHeight, 240)}px`;
		// Move caret to end on first focus so a new note starts in flow.
		ta.setSelectionRange(ta.value.length, ta.value.length);
	}, [editing]);

	function commit(): void {
		if (draft !== value) {
			onChange(draft);
			onCommit?.(draft);
		}
		setEditing(false);
	}

	function cancel(): void {
		setDraft(value);
		setEditing(false);
	}

	if (editing) {
		return (
			<textarea
				ref={taRef}
				value={draft}
				onChange={(e) => {
					setDraft(e.target.value);
					const ta = e.currentTarget;
					ta.style.height = "auto";
					ta.style.height = `${Math.max(ta.scrollHeight, 240)}px`;
				}}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						cancel();
					}
					if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				}}
				placeholder={placeholder}
				className={cn(
					"w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-4 focus:outline-none",
					"min-h-[14rem]",
					textareaClassName,
				)}
			/>
		);
	}

	if (!value) {
		return (
			<button
				type="button"
				onClick={() => setEditing(true)}
				className={cn(
					"block w-full cursor-text text-left font-mono text-2xs text-ink-4 hover:text-ink-3",
					className,
				)}
			>
				{placeholder}
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={() => setEditing(true)}
			title="Click to edit"
			className={cn("group block w-full cursor-text text-left", className)}
		>
			<Markdown className="text-[14px]">{value}</Markdown>
			<div className="mt-1 font-mono text-2xs text-ink-4 opacity-0 transition-opacity group-hover:opacity-100">
				click to edit · ⌘+enter to save · esc to cancel
			</div>
		</button>
	);
}
