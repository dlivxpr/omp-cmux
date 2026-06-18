import { describe, it, expect } from "bun:test";
import { parseWorktreeArgs, extractCurrentTaskFromEntries } from "./worktree";

describe("parseWorktreeArgs", () => {
	it("parses branch, from ref and note", () => {
		const result = parseWorktreeArgs("-c feat --from main focus note");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.request.branch).toBe("feat");
			expect(result.request.fromRef).toBe("main");
			expect(result.request.note).toBe("focus note");
		}
	});

	it("parses note before flags", () => {
		const result = parseWorktreeArgs("note first -c feature/foo");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.request.branch).toBe("feature/foo");
			expect(result.request.note).toBe("note first");
		}
	});

	it("rejects missing branch value", () => {
		const result = parseWorktreeArgs("-c --from main");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain(
				"Usage: /cmcv -c <branch> [--from <ref>] [note]",
			);
		}
	});

	it("rejects missing from ref value", () => {
		const result = parseWorktreeArgs("-c feat --from");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain(
				"Usage: /cmcv -c <branch> [--from <ref>] [note]",
			);
		}
	});

	it("rejects unknown options", () => {
		const result = parseWorktreeArgs("-c feat --fro main");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(
				"Unknown option: --fro. Usage: /cmcv -c <branch> [--from <ref>] [note]",
			);
		}
	});
});

describe("extractCurrentTaskFromEntries", () => {
	it("extracts text from official session entry shape", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "implement the cmux fix" }],
				},
			},
		];
		expect(extractCurrentTaskFromEntries(entries)).toBe("implement the cmux fix");
	});

	it("ignores old flat entry shape", () => {
		const entries = [{ role: "user", text: "implement the old shape" }];
		expect(extractCurrentTaskFromEntries(entries)).toBeUndefined();
	});

	it("joins multiple text parts with newlines", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "user",
					content: [
						{ type: "text", text: "first part" },
						{ type: "text", text: "second part" },
					],
				},
			},
		];
		expect(extractCurrentTaskFromEntries(entries)).toBe("first part\nsecond part");
	});

	it("uses string content directly", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "user",
					content: "implement the string content task",
				},
			},
		];
		expect(extractCurrentTaskFromEntries(entries)).toBe(
			"implement the string content task",
		);
	});

	it("skips short and control messages", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "ok" }],
				},
			},
			{
				type: "message",
				message: {
					role: "user",
					content: "implement the real task here",
				},
			},
		];
		expect(extractCurrentTaskFromEntries(entries)).toBe("implement the real task here");
	});
});
