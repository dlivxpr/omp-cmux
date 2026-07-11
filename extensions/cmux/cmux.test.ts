import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ExecResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import { cmux } from "./cmux";

const CMUX_TIMEOUT_MS = 5000;

interface ExecCall {
	command: string;
	args: string[];
	options: { timeout?: number } | undefined;
}

function timedCall(command: string, args: string[]): ExecCall {
	return { command, args, options: { timeout: CMUX_TIMEOUT_MS } };
}

type ExecHandler = (
	command: string,
	args: string[],
	callNumber: number,
) => ExecResult | Promise<ExecResult>;

function createMockPI(execute?: ExecHandler): {
	pi: ExtensionAPI;
	calls: ExecCall[];
} {
	const calls: ExecCall[] = [];
	const pi = {
		exec: async (
			command: string,
			args: string[],
			options?: { timeout?: number },
		): Promise<ExecResult> => {
			calls.push({ command, args, options });
			return (
				execute?.(command, args, calls.length) ?? {
					stdout: "",
					stderr: "",
					code: 0,
					killed: false,
				}
			);
		},
	} as unknown as ExtensionAPI;
	return { pi, calls };
}

const originalCmuxEnv = new Map<string, string>();
let originalTmux: string | undefined;

beforeEach(() => {
	originalTmux = process.env.TMUX;
	delete process.env.TMUX;
	for (const [key, value] of Object.entries(process.env)) {
		if (!key.startsWith("CMUX_") || value === undefined) continue;
		originalCmuxEnv.set(key, value);
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("CMUX_")) delete process.env[key];
	}
	for (const [key, value] of originalCmuxEnv) {
		process.env[key] = value;
	}
	originalCmuxEnv.clear();
	if (originalTmux === undefined) delete process.env.TMUX;
	else process.env.TMUX = originalTmux;
	mock.restore();
});

describe("cmux runtime adapter availability", () => {
	it("executes for workspace, tab, or explicit socket signals", async () => {
		spyOn(fs, "existsSync").mockReturnValue(false);

		for (const [key, value] of [
			["CMUX_WORKSPACE_ID", "workspace:1"],
			["CMUX_TAB_ID", "tab:1"],
			["CMUX_SOCKET_PATH", "127.0.0.1:1234"],
		] as const) {
			process.env[key] = value;
			const { pi, calls } = createMockPI();

			await cmux(pi, "notify", "--title", "Done");

			expect(calls).toEqual([
				timedCall("cmux", ["notify", "--title", "Done"]),
			]);
			delete process.env[key];
		}
	});

	it("executes when the default socket exists", async () => {
		spyOn(fs, "existsSync").mockImplementation(
			(path) => path === "/tmp/cmux.sock",
		);
		const { pi, calls } = createMockPI();

		await cmux(pi, "notify", "--title", "Done");

		expect(calls).toEqual([
			timedCall("cmux", ["notify", "--title", "Done"]),
		]);
	});

	it("does not execute when cmux is unavailable", async () => {
		spyOn(fs, "existsSync").mockReturnValue(false);
		const { pi, calls } = createMockPI();

		const result = await cmux(pi, "notify", "--title", "Done");

		expect(result).toBeUndefined();
		expect(calls).toEqual([]);
	});
});

describe("cmux runtime adapter CLI selection", () => {
	it("uses the bundled CLI when it exists", async () => {
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:5555";
		process.env.CMUX_BUNDLED_CLI_PATH =
			"/Applications/cmux.app/Contents/MacOS/cmux";
		spyOn(fs, "existsSync").mockImplementation(
			(path) => path === process.env.CMUX_BUNDLED_CLI_PATH,
		);
		const { pi, calls } = createMockPI();

		await cmux(pi, "notify", "--title", "Done");

		expect(calls).toEqual([
			timedCall("/Applications/cmux.app/Contents/MacOS/cmux", ["notify", "--title", "Done"]),
		]);
	});

	it("falls back to cmux when the bundled CLI is missing", async () => {
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:5555";
		process.env.CMUX_BUNDLED_CLI_PATH = "/missing/cmux";
		spyOn(fs, "existsSync").mockReturnValue(false);
		const { pi, calls } = createMockPI();

		await cmux(pi, "notify", "--title", "Done");

		expect(calls).toEqual([
			timedCall("cmux", ["notify", "--title", "Done"]),
		]);
	});
});

describe("cmux runtime adapter tmux refresh", () => {
	it("starts global and session queries concurrently, then applies session precedence", async () => {
		process.env.TMUX = "/tmp/tmux";
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:1000";
		process.env.CMUX_SURFACE_ID = "surface:old";
		spyOn(fs, "existsSync").mockReturnValue(false);
		const globalQuery = Promise.withResolvers<ExecResult>();
		const sessionQuery = Promise.withResolvers<ExecResult>();
		const { pi, calls } = createMockPI((command, args) => {
			if (command !== "tmux") {
				return { stdout: "", stderr: "", code: 0, killed: false };
			}
			return args.includes("-g") ? globalQuery.promise : sessionQuery.promise;
		});

		const invocation = cmux(pi, "notify", "--title", "Done");

		expect(calls).toEqual([
			timedCall("tmux", ["show-environment", "-g"]),
			timedCall("tmux", ["show-environment"]),
		]);

		globalQuery.resolve({
			stdout: [
				"CMUX_SOCKET_PATH=127.0.0.1:2000",
				"CMUX_WORKSPACE_ID=workspace:global",
				"CMUX_SURFACE_ID=surface:global",
			].join("\n"),
			stderr: "",
			code: 0,
			killed: false,
		});
		sessionQuery.resolve({
			stdout: [
				"CMUX_WORKSPACE_ID=workspace:session",
				"-CMUX_SURFACE_ID",
				"PATH=/usr/bin",
			].join("\n"),
			stderr: "",
			code: 0,
			killed: false,
		});
		await invocation;

		expect(calls[2]).toEqual(timedCall("env", [
				"CMUX_SOCKET_PATH=127.0.0.1:2000",
				"-u",
				"CMUX_SURFACE_ID",
				"CMUX_WORKSPACE_ID=workspace:session",
				"cmux",
				"notify",
				"--title",
				"Done",
			]));
	});

	it("uses a successful partial query without deleting unconfirmed values", async () => {
		process.env.TMUX = "/tmp/tmux";
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:1000";
		process.env.CMUX_SURFACE_ID = "surface:old";
		spyOn(fs, "existsSync").mockReturnValue(false);

		for (const successfulQuery of ["global", "session"] as const) {
			const { pi, calls } = createMockPI((command, args) => {
				if (command !== "tmux") {
					return { stdout: "", stderr: "", code: 0, killed: false };
				}
				const isGlobal = args.includes("-g");
				const succeeds =
					successfulQuery === "global" ? isGlobal : !isGlobal;
				if (!succeeds) {
					return { stdout: "", stderr: "failed", code: 1, killed: false };
				}
				return {
					stdout:
						successfulQuery === "global"
							? "CMUX_SOCKET_PATH=127.0.0.1:2000"
							: "CMUX_WORKSPACE_ID=workspace:session",
					stderr: "",
					code: 0,
					killed: false,
				};
			});

			await cmux(pi, "notify", "--title", "Done");

			expect(calls[2]).toEqual(
				successfulQuery === "global"
					? timedCall("env", [
								"CMUX_SOCKET_PATH=127.0.0.1:2000",
								"cmux",
								"notify",
								"--title",
								"Done",
							])
					: timedCall("env", [
								"CMUX_WORKSPACE_ID=workspace:session",
								"cmux",
								"notify",
								"--title",
								"Done",
							]),
			);
		}
	});

	it("keeps the process environment when both tmux queries fail", async () => {
		process.env.TMUX = "/tmp/tmux";
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:1000";
		spyOn(fs, "existsSync").mockReturnValue(false);
		const { pi, calls } = createMockPI((command) => ({
			stdout: "",
			stderr: command === "tmux" ? "failed" : "",
			code: command === "tmux" ? 1 : 0,
			killed: false,
		}));

		await cmux(pi, "notify", "--title", "Done");

		expect(calls[2]).toEqual(timedCall("cmux", ["notify", "--title", "Done"]));
	});

	it("keeps the process environment when tmux has no CMUX values", async () => {
		process.env.TMUX = "/tmp/tmux";
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:1000";
		spyOn(fs, "existsSync").mockReturnValue(false);
		const { pi, calls } = createMockPI((command) => ({
			stdout: command === "tmux" ? "PATH=/usr/bin" : "",
			stderr: "",
			code: 0,
			killed: false,
		}));

		await cmux(pi, "notify", "--title", "Done");

		expect(calls[2]).toEqual(timedCall("cmux", ["notify", "--title", "Done"]));
	});
});

describe("cmux runtime adapter results", () => {
	it("returns successful and non-zero execution results unchanged", async () => {
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:5555";
		spyOn(fs, "existsSync").mockReturnValue(false);

		for (const result of [
			{
				stdout: "ok",
				stderr: "",
				code: 0,
				killed: false,
			},
			{
				stdout: "",
				stderr: "cmux failed",
				code: 7,
				killed: false,
			},
		]) {
			const { pi } = createMockPI(() => result);

			expect(await cmux(pi, "notify", "--title", "Done")).toBe(result);
		}
	});

	it("returns undefined when cmux execution throws", async () => {
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:5555";
		spyOn(fs, "existsSync").mockReturnValue(false);
		const { pi } = createMockPI(() => {
			throw new Error("exec failed");
		});

		expect(await cmux(pi, "notify", "--title", "Done")).toBeUndefined();
	});

	it("continues with process environment when tmux queries throw", async () => {
		process.env.TMUX = "/tmp/tmux";
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:5555";
		spyOn(fs, "existsSync").mockReturnValue(false);
		const success = {
			stdout: "ok",
			stderr: "",
			code: 0,
			killed: false,
		};
		const { pi, calls } = createMockPI((command) => {
			if (command === "tmux") throw new Error("tmux failed");
			return success;
		});

		const result = await cmux(pi, "notify", "--title", "Done");

		expect(result).toBe(success);
		expect(calls[2]).toEqual(timedCall("cmux", ["notify", "--title", "Done"]));
	});
});
