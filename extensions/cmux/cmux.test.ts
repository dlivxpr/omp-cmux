import { describe, expect, it } from "bun:test";
import {
	buildCmuxExecCommand,
	cmux,
	isCmuxAvailable,
	parseTmuxEnvironmentOutput,
	resolveCmuxCli,
} from "./cmux";

describe("cmux environment detection", () => {
	it("accepts workspace, tab, socket, or fallback socket presence", () => {
		expect(isCmuxAvailable({ CMUX_WORKSPACE_ID: "workspace:1" }, () => false)).toBe(true);
		expect(isCmuxAvailable({ CMUX_TAB_ID: "tab:1" }, () => false)).toBe(true);
		expect(isCmuxAvailable({ CMUX_SOCKET_PATH: "127.0.0.1:1234" }, () => false)).toBe(true);
		expect(isCmuxAvailable({}, (path) => path === "/tmp/cmux.sock")).toBe(true);
		expect(isCmuxAvailable({}, () => false)).toBe(false);
	});

	it("uses the bundled cmux CLI when it exists", () => {
		expect(
			resolveCmuxCli(
				{ CMUX_BUNDLED_CLI_PATH: "/Applications/cmux.app/Contents/MacOS/cmux" },
				(path) => path.endsWith("/cmux"),
			),
		).toBe("/Applications/cmux.app/Contents/MacOS/cmux");
		expect(resolveCmuxCli({ CMUX_BUNDLED_CLI_PATH: "/missing/cmux" }, () => false)).toBe("cmux");
	});

	it("wraps cmux execution with env overrides when refreshed values differ", () => {
		expect(
			buildCmuxExecCommand(
				{ CMUX_SOCKET_PATH: "127.0.0.1:4321" },
				() => false,
				{ CMUX_SOCKET_PATH: "127.0.0.1:1234" },
			),
		).toEqual({
			command: "env",
			argsPrefix: ["CMUX_SOCKET_PATH=127.0.0.1:4321", "cmux"],
		});
	});
});

describe("tmux cmux environment parsing", () => {
	it("parses set and unset CMUX variables", () => {
		expect(
			parseTmuxEnvironmentOutput(
				[
					"CMUX_SOCKET_PATH=127.0.0.1:4567",
					"CMUX_WORKSPACE_ID=workspace:abc",
					"-CMUX_SURFACE_ID",
					"PATH=/usr/bin",
				].join("\n"),
			),
		).toEqual({
			CMUX_SOCKET_PATH: "127.0.0.1:4567",
			CMUX_WORKSPACE_ID: "workspace:abc",
			CMUX_SURFACE_ID: undefined,
		});
	});
});

describe("cmux command invocation", () => {
	it("uses the bundled CLI path when executing cmux", async () => {
		const previousCli = process.env.CMUX_BUNDLED_CLI_PATH;
		const previousSocket = process.env.CMUX_SOCKET_PATH;
		const previousTmux = process.env.TMUX;
		process.env.CMUX_BUNDLED_CLI_PATH = "/bin/sh";
		delete process.env.TMUX;
		process.env.CMUX_SOCKET_PATH = "127.0.0.1:5555";
		const calls: Array<{ command: string; args: string[] }> = [];
		const pi = {
			exec: async (command: string, args: string[]) => {
				calls.push({ command, args });
				return { stdout: "", stderr: "", code: 0, killed: false };
			},
		};

		try {
			await cmux(pi as never, "notify", "--title", "Done");
		} finally {
			if (previousCli === undefined) delete process.env.CMUX_BUNDLED_CLI_PATH;
			else process.env.CMUX_BUNDLED_CLI_PATH = previousCli;
			if (previousSocket === undefined) delete process.env.CMUX_SOCKET_PATH;
			else process.env.CMUX_SOCKET_PATH = previousSocket;
			if (previousTmux === undefined) delete process.env.TMUX;
			else process.env.TMUX = previousTmux;
		}

		expect(calls[0]).toEqual({
			command: "/bin/sh",
			args: ["notify", "--title", "Done"],
		});
	});
});
