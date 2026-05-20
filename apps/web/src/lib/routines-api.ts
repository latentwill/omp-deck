import type {
	CreateRoutineRequest,
	ListRoutineRunsResponse,
	ListRoutinesResponse,
	Routine,
	UpdateRoutineRequest,
} from "@omp-deck/protocol";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} ${path}: ${body}`);
	}
	return (await res.json()) as T;
}

export const routinesApi = {
	list(): Promise<ListRoutinesResponse> {
		return req<ListRoutinesResponse>("/routines");
	},
	create(body: CreateRoutineRequest): Promise<Routine> {
		return req<Routine>("/routines", { method: "POST", body: JSON.stringify(body) });
	},
	update(id: string, body: UpdateRoutineRequest): Promise<Routine> {
		return req<Routine>(`/routines/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		});
	},
	remove(id: string): Promise<{ ok: boolean }> {
		return req(`/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
	},
	runNow(id: string): Promise<{ ok: boolean }> {
		return req(`/routines/${encodeURIComponent(id)}/run`, { method: "POST" });
	},
	runs(id: string, limit = 10): Promise<ListRoutineRunsResponse> {
		return req<ListRoutineRunsResponse>(
			`/routines/${encodeURIComponent(id)}/runs?limit=${limit}`,
		);
	},
};
