import { describe, expect, it } from "bun:test";
import {
	buildCmuxExecCommand,
	buildPiCommand,
	cmux,
	findNewSurfaceRefs,
	getCallerInfo,
	isCmuxAvailable,
	parseSurfaceListOutput,
	parseSurfaceRefFromJson,
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

describe("parseSurfaceListOutput", () => {
	it("prefers focused, then selected, then first surface id", () => {
		expect(
			parseSurfaceListOutput(
				JSON.stringify({
					surfaces: [
						{ id: "surface:first" },
						{ id: "surface:selected", selected: true },
						{ id: "surface:focused", focused: true },
					],
				}),
			),
		).toBe("surface:focused");

		expect(
			parseSurfaceListOutput(
				JSON.stringify({
					surfaces: [{ id: "surface:first" }, { id: "surface:selected", selected: true }],
				}),
			),
		).toBe("surface:selected");

		expect(parseSurfaceListOutput(JSON.stringify([{ id: "surface:first" }]))).toBe("surface:first");
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

	it("falls back to cmux env caller values when identify lacks caller info", async () => {
		const previousWorkspace = process.env.CMUX_WORKSPACE_ID;
		const previousSurface = process.env.CMUX_SURFACE_ID;
		const previousTmux = process.env.TMUX;
		process.env.CMUX_WORKSPACE_ID = "workspace:from-env";
		process.env.CMUX_SURFACE_ID = "surface:from-env";
		delete process.env.TMUX;
		const pi = {
			exec: async () => ({ stdout: "{}", stderr: "", code: 0, killed: false }),
		};

		try {
			await expect(getCallerInfo(pi as never)).resolves.toEqual({
				ok: true,
				info: { workspaceRef: "workspace:from-env", surfaceRef: "surface:from-env" },
			});
		} finally {
			if (previousWorkspace === undefined) delete process.env.CMUX_WORKSPACE_ID;
			else process.env.CMUX_WORKSPACE_ID = previousWorkspace;
			if (previousSurface === undefined) delete process.env.CMUX_SURFACE_ID;
			else process.env.CMUX_SURFACE_ID = previousSurface;
			if (previousTmux === undefined) delete process.env.TMUX;
			else process.env.TMUX = previousTmux;
		}
	});
});

describe("parseSurfaceRefFromJson", () => {
	it("extracts surface_ref", () => {
		expect(parseSurfaceRefFromJson('{"surface_ref":"surface:2"}')).toBe(
			"surface:2",
		);
	});

	it("extracts surfaceRef", () => {
		expect(parseSurfaceRefFromJson('{"surfaceRef":"surface:3"}')).toBe(
			"surface:3",
		);
	});

	it("extracts nested new_surface_ref", () => {
		expect(
			parseSurfaceRefFromJson('{"created":{"new_surface_ref":"surface:4"}}'),
		).toBe("surface:4");
	});
});

describe("findNewSurfaceRefs", () => {
	it("returns a single new ref", () => {
		expect(
			findNewSurfaceRefs(
				[{ surface_ref: "surface:1" }],
				[{ surface_ref: "surface:1" }, { surface_ref: "surface:2" }],
			),
		).toEqual(["surface:2"]);
	});

	it("returns multiple new refs for caller rejection", () => {
		expect(
			findNewSurfaceRefs(
				[{ surface_ref: "surface:1" }],
				[
					{ surface_ref: "surface:1" },
					{ surface_ref: "surface:2" },
					{ surface_ref: "surface:3" },
				],
			),
		).toEqual(["surface:2", "surface:3"]);
	});

	it("detects new refs from current list-panes surface_refs shape", () => {
		expect(
			findNewSurfaceRefs(
				[{ surface_refs: ["surface:1"], selected_surface_ref: "surface:1" }],
				[
					{
						surface_refs: ["surface:1", "surface:2"],
						selected_surface_ref: "surface:2",
					},
				],
			),
		).toEqual(["surface:2"]);
	});
});

describe("buildPiCommand", () => {
	it("starts an interactive omp session without a prompt", () => {
		const command = buildPiCommand("/tmp/project");

		expect(command).not.toContain(" -p ");
		expect(command).toContain("exec omp --cwd '/tmp/project'");
	});

	it("passes the initial prompt as an interactive positional argument", () => {
		const command = buildPiCommand("/tmp/project", { prompt: "hello world" });

		expect(command).not.toContain(" -p ");
		expect(command.endsWith(" 'hello world'")).toBe(true);
	});
});
