import { useCallback, useEffect, useState } from "react";
import { Plus, Power, Zap } from "lucide-react";
import type { Routine } from "@omp-deck/protocol";

import { Layout } from "@/components/Layout";
import { RoutineEditor } from "@/components/routines/RoutineEditor";
import { routinesApi } from "@/lib/routines-api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Selection = Routine | "new" | undefined;

export function RoutinesView() {
	const setInspectorOpen = useStore((s) => s.setInspectorOpen);
	function select(value: Selection): void {
		setSelected(value);
		if (value !== undefined) setInspectorOpen(true);
	}

	const [routines, setRoutines] = useState<Routine[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | undefined>();
	const [selected, setSelected] = useState<Selection>();

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const res = await routinesApi.list();
			setRoutines(res.routines);
			setError(undefined);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	async function toggleEnabled(r: Routine): Promise<void> {
		try {
			const updated = await routinesApi.update(r.id, { enabled: !r.enabled });
			setRoutines((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
		} catch (e) {
			setError(String(e));
		}
	}

	async function runNow(r: Routine): Promise<void> {
		try {
			await routinesApi.runNow(r.id);
			setTimeout(() => void refresh(), 800);
		} catch (e) {
			setError(String(e));
		}
	}

	function onSaved(saved: Routine): void {
		setRoutines((prev) => {
			const idx = prev.findIndex((x) => x.id === saved.id);
			if (idx === -1) return [...prev, saved].sort((a, b) => a.name.localeCompare(b.name));
			const next = prev.slice();
			next[idx] = saved;
			return next;
		});
		select(saved);
	}

	function onDeleted(id: string): void {
		setRoutines((prev) => prev.filter((x) => x.id !== id));
		setSelected(undefined);
	}

	return (
		<Layout
			sidebar={<RoutinesSidebar routines={routines} onNew={() => select("new")} />}
			main={
				<div className="flex h-full min-h-0 flex-col">
					<div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-paper px-3">
						<div className="meta">Routines</div>
						<div className="text-xs text-ink-3">
							{routines.length} total · {routines.filter((r) => r.enabled).length} enabled
						</div>
						<button
							type="button"
							onClick={() => select("new")}
							className="btn-primary ml-auto h-7 px-2 text-xs"
						>
							<Plus className="h-3.5 w-3.5" />
							New routine
						</button>
					</div>

					{error ? (
						<div className="border-b border-line bg-danger/10 px-3 py-1 font-mono text-xs text-danger">
							{error}
						</div>
					) : null}

					{loading ? (
						<div className="flex flex-1 items-center justify-center text-sm text-ink-3">
							Loading…
						</div>
					) : routines.length === 0 ? (
						<div className="flex flex-1 items-center justify-center px-6 text-center">
							<div className="max-w-sm">
								<div className="meta mb-1.5">No routines yet</div>
								<p className="text-sm text-ink-2">
									Create one to schedule a recurring bash command, script, or omp prompt.
								</p>
								<button
									type="button"
									onClick={() => select("new")}
									className="btn-primary mt-3 h-8 px-3 text-sm"
								>
									<Plus className="h-3.5 w-3.5" />
									New routine
								</button>
							</div>
						</div>
					) : (
						<div className="flex-1 overflow-y-auto">
							<ul className="divide-y divide-line">
								{routines.map((r) => (
									<li key={r.id}>
										<button
											type="button"
											onClick={() => select(r)}
											className={cn(
												"flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper-3/60",
												(selected !== "new" && selected?.id === r.id) && "bg-paper-3",
											)}
										>
											<span
												className={cn(
													"h-2 w-2 shrink-0 rounded-full",
													r.enabled ? "bg-success" : "bg-line-strong",
												)}
												aria-label={r.enabled ? "enabled" : "disabled"}
											/>
											<div className="min-w-0 flex-1">
												<div className="flex items-baseline gap-2">
													<span className="truncate text-sm font-medium text-ink">{r.name}</span>
													<span className="font-mono text-2xs uppercase tracking-meta text-accent">
														{r.actionKind}
													</span>
												</div>
												<div className="mt-0.5 truncate font-mono text-2xs text-ink-3">
													<span className="text-ink-2">{r.cron}</span>
													{r.nextRunAt ? (
														<> · next {new Date(r.nextRunAt).toLocaleString()}</>
													) : null}
													{r.lastRunAt ? (
														<> · last {new Date(r.lastRunAt).toLocaleString()}</>
													) : null}
												</div>
											</div>
											<span
												role="button"
												onClick={(e) => {
													e.stopPropagation();
													void runNow(r);
												}}
												className="text-ink-3 hover:text-ink"
												title="Run now"
											>
												<Zap className="h-3.5 w-3.5" />
											</span>
											<span
												role="button"
												onClick={(e) => {
													e.stopPropagation();
													void toggleEnabled(r);
												}}
												className={r.enabled ? "text-success" : "text-ink-4"}
												title={r.enabled ? "Disable" : "Enable"}
											>
												<Power className="h-3.5 w-3.5" />
											</span>
										</button>
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			}
			inspector={
				selected ? (
					<RoutineEditor
						routine={selected}
						onClose={() => setSelected(undefined)}
						onSaved={onSaved}
						onDeleted={onDeleted}
					/>
				) : (
					<div className="flex h-full items-center justify-center px-4 text-center font-mono text-2xs text-ink-3">
						Click a routine to edit, or create a new one.
					</div>
				)
			}
			topBar={null}
		/>
	);
}

function RoutinesSidebar({ routines, onNew }: { routines: Routine[]; onNew: () => void }) {
	const enabled = routines.filter((r) => r.enabled).length;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="border-b border-line px-3 py-3">
				<div className="meta mb-1.5">Schedule</div>
				<div className="space-y-1 text-sm">
					<div className="flex items-center justify-between">
						<span className="text-ink-2">enabled</span>
						<span className="font-mono text-2xs text-ink-3">{enabled}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-ink-2">disabled</span>
						<span className="font-mono text-2xs text-ink-3">{routines.length - enabled}</span>
					</div>
				</div>
				<button type="button" onClick={onNew} className="btn-primary mt-3 h-8 w-full text-sm">
					<Plus className="h-3.5 w-3.5" />
					New routine
				</button>
			</div>
			<div className="px-3 py-3 text-xs text-ink-3">
				<div className="meta mb-1.5">Cron format</div>
				<div className="font-mono text-2xs leading-relaxed">
					min hour dom month dow
					<br />
					0–59 0–23 1–31 1–12 0–6
				</div>
				<div className="mt-2 font-mono text-2xs">e.g. <code>0 9 * * 1-5</code> = weekdays 9am</div>
			</div>
		</div>
	);
}
