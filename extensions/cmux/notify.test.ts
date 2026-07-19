import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
	AgentEndEvent,
	AgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "@oh-my-pi/pi-coding-agent";
import { registerNotifyHandlers } from "./notify";

const MOCK_CWD = "/tmp";

function createMockContext(hasUI: boolean): ExtensionContext {
	return {
		ui: { notify: mock(() => {}) } as unknown as ExtensionContext["ui"],
		getContextUsage: () => undefined,
		compact: async () => {},
		hasUI,
		cwd: MOCK_CWD,
		sessionManager: {} as ExtensionContext["sessionManager"],
		modelRegistry: {} as ExtensionContext["modelRegistry"],
		model: undefined,
		models: {} as ExtensionContext["models"],
		isIdle: () => true,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getSystemPrompt: () => [],
		memory: undefined,
		setInterval: () => ({}) as Timer,
		setTimeout: () => ({}) as Timer,
		clearTimer: () => {},
	} as ExtensionContext;
}

type Handler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;

interface MockExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

type MockExecutor = (
	tool: string,
	args: string[],
	callNumber: number,
) => MockExecResult | Promise<MockExecResult>;

function createMockPI(execute?: MockExecutor): {
	pi: ExtensionAPI;
	handlers: Record<string, Handler>;
	execCalls: { tool: string; args: string[] }[];
} {
	const handlers: Record<string, Handler> = {};
	const execCalls: { tool: string; args: string[] }[] = [];
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers[event] = handler;
		},
		exec: (tool: string, args: string[]) => {
			execCalls.push({ tool, args });
			return Promise.resolve(
				execute
					? execute(tool, args, execCalls.length)
					: { stdout: "", stderr: "", code: 0 },
			);
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, execCalls };
}

let originalSocketPath: string | undefined;
let originalBundledCliPath: string | undefined;
let originalTmux: string | undefined;
let originalNotifyLevel: string | undefined;
let originalNotifyThreshold: string | undefined;
let originalNotifyDebounce: string | undefined;
let originalWorkspaceId: string | undefined;
let originalSurfaceId: string | undefined;
let originalTabId: string | undefined;
let originalPanelId: string | undefined;

const TARGET_ARGS = [
	"--workspace",
	"workspace-test",
	"--surface",
	"surface-test",
];

beforeEach(() => {
	originalSocketPath = process.env.CMUX_SOCKET_PATH;
	originalBundledCliPath = process.env.CMUX_BUNDLED_CLI_PATH;
	originalTmux = process.env.TMUX;
	originalNotifyLevel = process.env.OMP_CMUX_NOTIFY_LEVEL;
	originalNotifyThreshold = process.env.PI_CMUX_NOTIFY_THRESHOLD_MS;
	originalNotifyDebounce = process.env.PI_CMUX_NOTIFY_DEBOUNCE_MS;
	originalWorkspaceId = process.env.CMUX_WORKSPACE_ID;
	originalSurfaceId = process.env.CMUX_SURFACE_ID;
	originalTabId = process.env.CMUX_TAB_ID;
	originalPanelId = process.env.CMUX_PANEL_ID;
	process.env.CMUX_SOCKET_PATH = "/tmp/test-cmux.sock";
	delete process.env.CMUX_BUNDLED_CLI_PATH;
	delete process.env.TMUX;
	process.env.OMP_CMUX_NOTIFY_LEVEL = "medium";
	process.env.PI_CMUX_NOTIFY_THRESHOLD_MS = "15000";
	process.env.PI_CMUX_NOTIFY_DEBOUNCE_MS = "3000";
	process.env.CMUX_WORKSPACE_ID = "workspace-test";
	process.env.CMUX_SURFACE_ID = "surface-test";
	delete process.env.CMUX_TAB_ID;
	delete process.env.CMUX_PANEL_ID;
});

afterEach(() => {
	if (originalSocketPath === undefined) delete process.env.CMUX_SOCKET_PATH;
	else process.env.CMUX_SOCKET_PATH = originalSocketPath;
	if (originalBundledCliPath === undefined) delete process.env.CMUX_BUNDLED_CLI_PATH;
	else process.env.CMUX_BUNDLED_CLI_PATH = originalBundledCliPath;
	if (originalTmux === undefined) delete process.env.TMUX;
	else process.env.TMUX = originalTmux;
	if (originalNotifyLevel === undefined) delete process.env.OMP_CMUX_NOTIFY_LEVEL;
	else process.env.OMP_CMUX_NOTIFY_LEVEL = originalNotifyLevel;
	if (originalNotifyThreshold === undefined) {
		delete process.env.PI_CMUX_NOTIFY_THRESHOLD_MS;
	} else process.env.PI_CMUX_NOTIFY_THRESHOLD_MS = originalNotifyThreshold;
	if (originalNotifyDebounce === undefined) {
		delete process.env.PI_CMUX_NOTIFY_DEBOUNCE_MS;
	} else process.env.PI_CMUX_NOTIFY_DEBOUNCE_MS = originalNotifyDebounce;
	if (originalWorkspaceId === undefined) delete process.env.CMUX_WORKSPACE_ID;
	else process.env.CMUX_WORKSPACE_ID = originalWorkspaceId;
	if (originalSurfaceId === undefined) delete process.env.CMUX_SURFACE_ID;
	else process.env.CMUX_SURFACE_ID = originalSurfaceId;
	if (originalTabId === undefined) delete process.env.CMUX_TAB_ID;
	else process.env.CMUX_TAB_ID = originalTabId;
	if (originalPanelId === undefined) delete process.env.CMUX_PANEL_ID;
	else process.env.CMUX_PANEL_ID = originalPanelId;
});

describe("registerNotifyHandlers child-agent filtering", () => {
	it("ignores child events without losing the parent summary", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const parentCtx = createMockContext(true);
		const childCtx = createMockContext(false);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			parentCtx,
		);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "read",
				toolCallId: "tc1",
				input: { path: "README.md" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			parentCtx,
		);
		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			childCtx,
		);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "search",
				toolCallId: "tc2",
				input: { pattern: "foo" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			childCtx,
		);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			childCtx,
		);
		expect(execCalls).toHaveLength(0);

		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			parentCtx,
		);
		expect(execCalls[0].args).toEqual([
			"notify",
			"--title",
			"Task Complete",
			"--subtitle",
			"Reviewed README.md",
			...TARGET_ARGS,
		]);
	});


	it("builds a parent summary through the lifecycle registration interface", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "read",
				toolCallId: "tc1",
				input: { path: "README.md" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			ctx,
		);
		for (const toolName of ["grep", "glob"]) {
			await handlers.tool_result!(
				{
					type: "tool_result",
					toolName,
					toolCallId: `tc-${toolName}`,
					input: {},
					content: [],
					isError: false,
				} as unknown as ToolResultEvent,
				ctx,
			);
		}
		for (const toolName of ["search", "find"]) {
			await handlers.tool_result!(
				{
					type: "tool_result",
					toolName,
					toolCallId: `tc-legacy-${toolName}`,
					input: {},
					content: [],
					isError: false,
				} as unknown as ToolResultEvent,
				ctx,
			);
		}
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls[0]).toEqual({
			tool: "cmux",
			args: [
				"notify",
				"--title",
				"Task Complete",
				"--subtitle",
				"Reviewed README.md, Ran 2 searches",
				...TARGET_ARGS,
			],
		});
	});

	it("isolates notification failures between extension instances", async () => {
		const first = createMockPI(() => ({ stdout: "", stderr: "", code: 1 }));
		const second = createMockPI();
		registerNotifyHandlers(first.pi);
		registerNotifyHandlers(second.pi);
		const ctx = createMockContext(true);

		await first.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await second.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await first.handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);
		await Promise.resolve();
		await Promise.resolve();

		await second.handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(second.execCalls).toHaveLength(1);
		expect(second.execCalls[0].args[0]).toBe("notify");
	});

	it("isolates in-flight payloads between extension instances", async () => {
		const firstSend = Promise.withResolvers<MockExecResult>();
		const first = createMockPI(() => firstSend.promise);
		const second = createMockPI();
		registerNotifyHandlers(first.pi);
		registerNotifyHandlers(second.pi);
		const ctx = createMockContext(true);
		const aborted = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted" }],
		} as unknown as AgentEndEvent;

		await first.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await second.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await first.handlers.agent_end!(aborted, ctx);
		await second.handlers.agent_end!(aborted, ctx);

		expect(first.execCalls).toHaveLength(1);
		expect(second.execCalls).toHaveLength(1);
		firstSend.resolve({ stdout: "", stderr: "", code: 0 });
	});

	it("isolates successful debounce records between extension instances", async () => {
		const first = createMockPI();
		const second = createMockPI();
		registerNotifyHandlers(first.pi);
		registerNotifyHandlers(second.pi);
		const ctx = createMockContext(true);
		const aborted = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted" }],
		} as unknown as AgentEndEvent;

		await first.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await first.handlers.agent_end!(aborted, ctx);
		await Promise.resolve();
		await Promise.resolve();
		await second.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await second.handlers.agent_end!(aborted, ctx);

		expect(first.execCalls).toHaveLength(1);
		expect(second.execCalls).toHaveLength(1);
	});

	it("ignores a failed send from an obsolete run generation", async () => {
		const firstSend = Promise.withResolvers<MockExecResult>();
		const { pi, handlers, execCalls } = createMockPI(
			(_tool, _args, callNumber) =>
				callNumber === 1
					? firstSend.promise
					: { stdout: "", stderr: "", code: 0 },
		);
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "aborted" }],
			} as unknown as AgentEndEvent,
			ctx,
		);
		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		firstSend.resolve({ stdout: "", stderr: "", code: 1 });
		await Promise.resolve();
		await Promise.resolve();

		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "Run B failed",
					},
				],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls).toHaveLength(2);
		expect(execCalls[1].args[2]).toBe("Error");
	});

	it("keeps overlapping run summaries isolated in FIFO end order", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);
		const success = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "endTurn" }],
		} as unknown as AgentEndEvent;

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "read",
				toolCallId: "read-a",
				input: { path: "a.ts" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			ctx,
		);
		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "write",
				toolCallId: "write-b",
				input: { path: "b.ts" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			ctx,
		);
		await handlers.agent_end!(success, ctx);
		await handlers.agent_end!(success, ctx);

		expect(execCalls).toHaveLength(2);
		expect(execCalls[0].args).toContain("Reviewed a.ts");
		expect(execCalls[0].args).not.toContain("Updated b.ts");
		expect(execCalls[1].args).toContain("Updated b.ts");
		expect(execCalls[1].args).not.toContain("Reviewed a.ts");
	});

	it("defers continuation notifications and merges the final summary", async () => {
		process.env.OMP_CMUX_NOTIFY_LEVEL = "all";
		process.env.PI_CMUX_NOTIFY_THRESHOLD_MS = "0";
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "read",
				toolCallId: "read-a",
				input: { path: "a.ts" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			ctx,
		);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "grep",
				toolCallId: "grep-a",
				input: {},
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			ctx,
		);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
				willContinue: true,
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls).toHaveLength(0);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "write",
				toolCallId: "write-b",
				input: { path: "b.ts" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			ctx,
		);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "bash",
				toolCallId: "bash-b",
				input: { command: "true" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			ctx,
		);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);

		const titles = execCalls.map((call) => call.args[2]);
		expect(titles).toEqual(["Task Complete", "Waiting"]);
		expect(titles.filter((title) => title === "Task Complete")).toHaveLength(1);
		const subtitleIndex = execCalls[0]!.args.indexOf("--subtitle");
		expect(execCalls[0]!.args[subtitleIndex + 1]).toContain(
			"Updated b.ts, Reviewed a.ts, Ran 1 search and 1 shell command",
		);
	});

	it("suppresses a recoverable intermediate error before final success", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "transient failure",
					},
				],
				willContinue: true,
			} as unknown as AgentEndEvent,
			ctx,
		);
		expect(execCalls).toHaveLength(0);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls).toHaveLength(1);
		expect(execCalls[0]!.args[2]).toBe("Task Complete");
	});

	it("retries the next notification after a nonzero result without a new run circuit", async () => {
		const resultCodes = [1, 0];
		const { pi, handlers, execCalls } = createMockPI(() => ({
			stdout: "",
			stderr: "",
			code: resultCodes.shift() ?? 0,
		}));
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);
		const aborted = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted" }],
		} as unknown as AgentEndEvent;

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(aborted, ctx);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await handlers.agent_end!(aborted, ctx);

		expect(execCalls).toHaveLength(2);
	});

	it("deduplicates identical notifications while delivery is in flight", async () => {
		const send = Promise.withResolvers<MockExecResult>();
		const { pi, handlers, execCalls } = createMockPI(() => send.promise);
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		const endEvent = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "endTurn" }],
		} as unknown as AgentEndEvent;
		await handlers.agent_end!(endEvent, ctx);
		await handlers.agent_end!(endEvent, ctx);

		expect(execCalls).toHaveLength(1);
		send.resolve({ stdout: "", stderr: "", code: 0 });
	});

	it("debounces complete payloads independently within a session", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);
		const aborted = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted" }],
		} as unknown as AgentEndEvent;
		const matchingErrorText = {
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					stopReason: "error",
					errorMessage: "Session was aborted",
				},
			],
		} as unknown as AgentEndEvent;

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(aborted, ctx);
		await Promise.resolve();
		await Promise.resolve();

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(matchingErrorText, ctx);
		await Promise.resolve();
		await Promise.resolve();

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(aborted, ctx);

		expect(execCalls).toHaveLength(2);
		expect(execCalls[0].args[2]).toBe("Aborted");
		expect(execCalls[1].args[2]).toBe("Error");
	});

	it("allows the same payload after the configured debounce window", async () => {
		process.env.PI_CMUX_NOTIFY_DEBOUNCE_MS = "0";
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);
		const aborted = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted" }],
		} as unknown as AgentEndEvent;

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(aborted, ctx);
		await Promise.resolve();
		await Promise.resolve();
		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(aborted, ctx);

		expect(execCalls).toHaveLength(2);
	});

	it("agent_end does not wait for a slow cmux notification", async () => {
		const send = Promise.withResolvers<MockExecResult>();
		const { pi, handlers, execCalls } = createMockPI(() => send.promise);
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.tool_result!(
			{
				type: "tool_result",
				toolName: "write",
				toolCallId: "tc1",
				input: { path: "slow-notification-test" },
				content: [],
				isError: false,
			} as unknown as ToolResultEvent,
			ctx,
		);

		let settled = false;
		const handlerPromise = Promise.resolve(
			handlers.agent_end!(
				{
					type: "agent_end",
					messages: [{ role: "assistant", stopReason: "endTurn" }],
				} as unknown as AgentEndEvent,
				ctx,
			),
		).then(() => {
			settled = true;
		});
		await Promise.resolve();

		expect(settled).toBe(true);
		expect(execCalls).toHaveLength(1);
		send.resolve({ stdout: "", stderr: "", code: 0 });
		await handlerPromise;
	});

	it("does not perform global cleanup after a failed send or shutdown", async () => {
		const { pi, handlers, execCalls } = createMockPI(() => ({
			stdout: "",
			stderr: "",
			code: 1,
		}));
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);
		await Promise.resolve();
		await handlers.session_shutdown!(
			{ type: "session_shutdown" } as SessionShutdownEvent,
			ctx,
		);

		expect(execCalls.map((call) => call.args[0])).toEqual(["notify"]);
	});

	it("does not execute cleanup when an old in-flight send settles", async () => {
		const send = Promise.withResolvers<MockExecResult>();
		const { pi, handlers, execCalls } = createMockPI(() => send.promise);
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);
		await handlers.session_shutdown!(
			{ type: "session_shutdown" } as SessionShutdownEvent,
			ctx,
		);
		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			ctx,
		);
		expect(execCalls).toHaveLength(1);

		send.resolve({ stdout: "", stderr: "", code: 0 });
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(execCalls).toHaveLength(1);
	});

	it("session_start resets debounce and pending run state without cmux cleanup", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);
		const aborted = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted" }],
		} as unknown as AgentEndEvent;

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(aborted, ctx);
		await Promise.resolve();
		await Promise.resolve();
		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			ctx,
		);
		await handlers.agent_end!(aborted, ctx);
		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(aborted, ctx);

		expect(execCalls.map((call) => call.args[0])).toEqual(["notify", "notify"]);
		expect(execCalls.flatMap((call) => call.args)).not.toContain(
			"clear-notifications",
		);
	});

	for (const reset of [
		{
			name: "session_start",
			event: { type: "session_start" } as SessionStartEvent,
		},
		{
			name: "session_shutdown",
			event: { type: "session_shutdown" } as SessionShutdownEvent,
		},
	] as const) {
		it(`${reset.name} clears deferred continuation summary state`, async () => {
			const { pi, handlers, execCalls } = createMockPI();
			registerNotifyHandlers(pi);
			const ctx = createMockContext(true);

			await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
			await handlers.tool_result!(
				{
					type: "tool_result",
					toolName: "read",
					toolCallId: "old-read",
					input: { path: "old.ts" },
					content: [],
					isError: false,
				} as unknown as ToolResultEvent,
				ctx,
			);
			await handlers.tool_result!(
				{
					type: "tool_result",
					toolName: "grep",
					toolCallId: "old-grep",
					input: {},
					content: [],
					isError: false,
				} as unknown as ToolResultEvent,
				ctx,
			);
			await handlers.agent_end!(
				{
					type: "agent_end",
					messages: [{ role: "assistant", stopReason: "endTurn" }],
					willContinue: true,
				} as unknown as AgentEndEvent,
				ctx,
			);
			expect(execCalls).toHaveLength(0);

			await handlers[reset.name]!(reset.event, ctx);
			await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
			await handlers.tool_result!(
				{
					type: "tool_result",
					toolName: "write",
					toolCallId: "new-write",
					input: { path: "new.ts" },
					content: [],
					isError: false,
				} as unknown as ToolResultEvent,
				ctx,
			);
			await handlers.tool_result!(
				{
					type: "tool_result",
					toolName: "bash",
					toolCallId: "new-bash",
					input: { command: "true" },
					content: [],
					isError: false,
				} as unknown as ToolResultEvent,
				ctx,
			);
			await handlers.agent_end!(
				{
					type: "agent_end",
					messages: [{ role: "assistant", stopReason: "endTurn" }],
				} as unknown as AgentEndEvent,
				ctx,
			);

			expect(execCalls).toHaveLength(1);
			const notification = execCalls[0]!.args.join(" ");
			expect(notification).toContain("Updated new.ts, Ran 1 shell command");
			expect(notification).not.toContain("old.ts");
			expect(notification).not.toContain("search");
		});
	}

	it("ignores session_start when hasUI=false (child agent)", async () => {
		const { pi, handlers, execCalls } = createMockPI();

		registerNotifyHandlers(pi);

		const childCtx = createMockContext(false);
		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			childCtx,
		);

		expect(execCalls.length).toBe(0);
	});
});

describe("registerNotifyHandlers summary notifications", () => {
	it("reports silent plan aborts as plan ready", async () => {
		const { pi, handlers, execCalls } = createMockPI();

		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "aborted",
						errorMessage: "__omp.silent_abort__",
					},
				],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls[0].tool).toBe("cmux");
		expect(execCalls[0].args).toEqual([
			"notify",
			"--title",
			"Plan Ready",
			"--subtitle",
			"Review the plan to apply or refine",
			...TARGET_ARGS,
		]);
		expect(execCalls[0].args).not.toContain("Aborted");
	});

	it("still reports real aborts as aborted", async () => {
		const { pi, handlers, execCalls } = createMockPI();

		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "aborted" }],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls[0].tool).toBe("cmux");
		expect(execCalls[0].args).toEqual([
			"notify",
			"--title",
			"Aborted",
			"--subtitle",
			"Session was aborted",
			...TARGET_ARGS,
		]);
	});

	it("preserves notification level filtering", async () => {
		process.env.OMP_CMUX_NOTIFY_LEVEL = "disabled";
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "error" }],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls).toHaveLength(0);
	});

	it("preserves the threshold-based waiting follow-up", async () => {
		process.env.PI_CMUX_NOTIFY_THRESHOLD_MS = "0";
		process.env.OMP_CMUX_NOTIFY_LEVEL = "all";
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls.map((call) => call.args[2])).toEqual([
			"Task Complete",
			"Waiting",
		]);
	});

	it("prefers terminal assistant errors and falls back to tool errors", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);
		const toolError = {
			type: "tool_result",
			toolName: "bash",
			toolCallId: "failed-tool",
			input: { command: "false" },
			content: [{ type: "text", text: "old tool failure" }],
			isError: true,
		} as unknown as ToolResultEvent;

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.tool_result!(toolError, ctx);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "terminal failure",
					},
				],
			} as unknown as AgentEndEvent,
			ctx,
		);
		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.tool_result!(toolError, ctx);
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "error" }],
			} as unknown as AgentEndEvent,
			ctx,
		);

		expect(execCalls[0].args).toContain("terminal failure");
		expect(execCalls[0].args).not.toContain("old tool failure");
		expect(execCalls[1].args).toContain("old tool failure");
	});

	it("uses explicit kinds for low and medium notification policies", async () => {
		const ctx = createMockContext(true);
		process.env.OMP_CMUX_NOTIFY_LEVEL = "low";
		const low = createMockPI();
		registerNotifyHandlers(low.pi);
		await low.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await low.handlers.agent_end!(
			{
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "aborted",
						errorMessage: "__omp.silent_abort__",
					},
				],
			} as unknown as AgentEndEvent,
			ctx,
		);
		await low.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await low.handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "error" }],
			} as unknown as AgentEndEvent,
			ctx,
		);
		await low.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await low.handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "aborted" }],
			} as unknown as AgentEndEvent,
			ctx,
		);
		expect(low.execCalls.map((call) => call.args[2])).toEqual([
			"Error",
			"Aborted",
		]);

		process.env.OMP_CMUX_NOTIFY_LEVEL = "medium";
		process.env.PI_CMUX_NOTIFY_THRESHOLD_MS = "0";
		const medium = createMockPI();
		registerNotifyHandlers(medium.pi);
		await medium.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await medium.handlers.agent_end!(
			{
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "aborted",
						errorMessage: "__omp.silent_abort__",
					},
				],
			} as unknown as AgentEndEvent,
			ctx,
		);
		expect(medium.execCalls.map((call) => call.args[2])).toEqual(["Plan Ready"]);
	});

	it("retries after a rejected send without a new agent_start", async () => {
		const { pi, handlers, execCalls } = createMockPI((_tool, _args, callNumber) =>
			callNumber === 1
				? Promise.reject(new Error("launch failed"))
				: { stdout: "", stderr: "", code: 0 },
		);
		registerNotifyHandlers(pi);
		const ctx = createMockContext(true);
		const aborted = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted" }],
		} as unknown as AgentEndEvent;

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!(aborted, ctx);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await handlers.agent_end!(aborted, ctx);

		expect(execCalls).toHaveLength(2);
	});

	it("falls back from a negative threshold and an infinite debounce", async () => {
		const ctx = createMockContext(true);
		process.env.OMP_CMUX_NOTIFY_LEVEL = "all";
		process.env.PI_CMUX_NOTIFY_THRESHOLD_MS = "-1";
		const threshold = createMockPI();
		registerNotifyHandlers(threshold.pi);
		await threshold.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await threshold.handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			ctx,
		);
		expect(threshold.execCalls.map((call) => call.args[2])).toEqual([
			"Task Complete",
		]);

		process.env.OMP_CMUX_NOTIFY_LEVEL = "medium";
		process.env.PI_CMUX_NOTIFY_DEBOUNCE_MS = "Infinity";
		const debounce = createMockPI();
		registerNotifyHandlers(debounce.pi);
		const aborted = {
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted" }],
		} as unknown as AgentEndEvent;
		await debounce.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await debounce.handlers.agent_end!(aborted, ctx);
		await Promise.resolve();
		await Promise.resolve();
		await debounce.handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await debounce.handlers.agent_end!(aborted, ctx);
		expect(debounce.execCalls).toHaveLength(1);
	});
});
