/**
 * Unit tests for the pure {@link createComposerHistoryStore}. The React hook
 * is a thin localStorage + cwd layer over this store; testing the store
 * directly keeps the boundary clean and avoids needing a DOM in Bun.
 *
 * Behavior under test mirrors the omp TUI editor history:
 *  - push records sent prompts, capped at MAX_HISTORY, consecutive dupes drop
 *  - recall-then-send-unmodified is a no-op
 *  - up walks older, down walks newer, exiting past the newest restores draft
 *  - up at the oldest entry pins (shell semantics)
 *  - down on a fresh store with no walking is a no-op
 */
import { describe, expect, test } from "bun:test";

import { MAX_HISTORY, createComposerHistoryStore } from "./use-composer-history";

describe("createComposerHistoryStore", () => {
	test("push records prompts newest-last", () => {
		const h = createComposerHistoryStore();
		h.push("one");
		h.push("two");
		h.push("three");
		expect(h.snapshot()).toEqual(["one", "two", "three"]);
	});

	test("push de-dupes consecutive identical sends", () => {
		const h = createComposerHistoryStore();
		h.push("same");
		h.push("same");
		h.push("same");
		h.push("other");
		h.push("same");
		expect(h.snapshot()).toEqual(["same", "other", "same"]);
	});

	test("push of empty string is a no-op", () => {
		const h = createComposerHistoryStore(["existing"]);
		h.push("");
		expect(h.snapshot()).toEqual(["existing"]);
	});

	test("push caps total entries at MAX_HISTORY (oldest dropped)", () => {
		const h = createComposerHistoryStore();
		for (let i = 0; i < MAX_HISTORY + 10; i++) h.push(`p${i}`);
		const snap = h.snapshot();
		expect(snap.length).toBe(MAX_HISTORY);
		expect(snap[0]).toBe(`p${10}`);
		expect(snap[snap.length - 1]).toBe(`p${MAX_HISTORY + 9}`);
	});

	test("up on empty history returns null", () => {
		const h = createComposerHistoryStore();
		expect(h.up("draft")).toBeNull();
		expect(h.isWalking()).toBe(false);
	});

	test("up walks from newest to oldest, then pins at oldest", () => {
		const h = createComposerHistoryStore(["a", "b", "c"]);
		expect(h.up("")).toBe("c");
		expect(h.up("")).toBe("b");
		expect(h.up("")).toBe("a");
		// Pinned at oldest entry across further up()s.
		expect(h.up("")).toBe("a");
		expect(h.up("")).toBe("a");
		expect(h.isWalking()).toBe(true);
	});

	test("down past newest restores stashed live draft and exits walking", () => {
		const h = createComposerHistoryStore(["a", "b", "c"]);
		expect(h.up("live")).toBe("c");
		expect(h.up("live")).toBe("b");
		expect(h.down()).toBe("c");
		expect(h.down()).toBe("live");
		expect(h.isWalking()).toBe(false);
	});

	test("down with no walking in progress returns null", () => {
		const h = createComposerHistoryStore(["a", "b"]);
		expect(h.down()).toBeNull();
		expect(h.isWalking()).toBe(false);
	});

	test("recall-then-send-unmodified does not pollute history", () => {
		const h = createComposerHistoryStore(["a", "b", "c"]);
		const recalled = h.up(""); // c
		expect(recalled).toBe("c");
		// Walk back further and send unmodified: must NOT append "b" again.
		const b = h.up("");
		expect(b).toBe("b");
		h.push("b");
		expect(h.snapshot()).toEqual(["a", "b", "c"]);
		expect(h.isWalking()).toBe(false);
	});

	test("recall-then-edit-and-send appends the edited prompt", () => {
		const h = createComposerHistoryStore(["a", "b", "c"]);
		const recalled = h.up(""); // c
		expect(recalled).toBe("c");
		h.push("c with edits");
		expect(h.snapshot()).toEqual(["a", "b", "c", "c with edits"]);
	});

	test("up after push resumes from the new newest", () => {
		const h = createComposerHistoryStore(["a"]);
		h.push("b");
		expect(h.up("")).toBe("b");
		expect(h.up("")).toBe("a");
	});

	test("first up stashes draft so down restores it past newest", () => {
		const h = createComposerHistoryStore(["a", "b"]);
		expect(h.up("in-progress text")).toBe("b");
		expect(h.down()).toBe("in-progress text");
		expect(h.isWalking()).toBe(false);
	});

	test("reset clears walking state without dropping entries", () => {
		const h = createComposerHistoryStore(["a", "b", "c"]);
		h.up("");
		h.up("");
		expect(h.isWalking()).toBe(true);
		h.reset();
		expect(h.isWalking()).toBe(false);
		expect(h.snapshot()).toEqual(["a", "b", "c"]);
		// After reset, up() starts walking again from newest.
		expect(h.up("")).toBe("c");
	});

	test("initial entries longer than cap are truncated to MAX_HISTORY", () => {
		const seed: string[] = [];
		for (let i = 0; i < MAX_HISTORY + 5; i++) seed.push(`s${i}`);
		const h = createComposerHistoryStore(seed);
		const snap = h.snapshot();
		expect(snap.length).toBe(MAX_HISTORY);
		expect(snap[0]).toBe(`s${5}`);
		expect(snap[snap.length - 1]).toBe(`s${MAX_HISTORY + 4}`);
	});

	test("initial entries skip non-string and empty values", () => {
		const dirty = ["good", "", "also-good"] as unknown as ReadonlyArray<string>;
		const h = createComposerHistoryStore(dirty);
		expect(h.snapshot()).toEqual(["good", "also-good"]);
	});
});
