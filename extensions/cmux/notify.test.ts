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

beforeEach(() => {
	originalSocketPath = process.env.CMUX_SOCKET_PATH;
	originalBundledCliPath = process.env.CMUX_BUNDLED_CLI_PATH;
	originalTmux = process.env.TMUX;
	originalNotifyLevel = process.env.OMP_CMUX_NOTIFY_LEVEL;
	originalNotifyThreshold = process.env.PI_CMUX_NOTIFY_THRESHOLD_MS;
	originalNotifyDebounce = process.env.PI_CMUX_NOTIFY_DEBOUNCE_MS;
	process.env.CMUX_SOCKET_PATH = "/tmp/test-cmux.sock";
	delete process.env.CMUX_BUNDLED_CLI_PATH;
	delete process.env.TMUX;
	process.env.OMP_CMUX_NOTIFY_LEVEL = "medium";
	process.env.PI_CMUX_NOTIFY_THRESHOLD_MS = "15000";
	process.env.PI_CMUX_NOTIFY_DEBOUNCE_MS = "3000";
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
				"Reviewed README.md",
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

	it("ignores a successful send from an obsolete run generation", async () => {
		const firstSend = Promise.withResolvers<MockExecResult>();
		const { pi, handlers, execCalls } = createMockPI(
			(_tool, _args, callNumber) =>
				callNumber === 1
					? firstSend.promise
					: { stdout: "", stderr: "", code: 0 },
		);
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
		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		firstSend.resolve({ stdout: "", stderr: "", code: 0 });
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await handlers.agent_end!(aborted, ctx);

		expect(execCalls).toHaveLength(2);
	});

	it("releases failed payloads and retries on the next run", async () => {
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

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(aborted, ctx);
		await Promise.resolve();
		await Promise.resolve();
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "Suppressed in the failed run",
					},
				],
			} as unknown as AgentEndEvent,
			ctx,
		);
		expect(execCalls).toHaveLength(1);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
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

	it("clears notifications even when the run failure circuit is open", async () => {
		const { pi, handlers, execCalls } = createMockPI(() => ({
			stdout: "",
			stderr: "",
			code: 1,
		}));
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
		await Promise.resolve();
		await Promise.resolve();
		await handlers.session_shutdown!(
			{ type: "session_shutdown" } as SessionShutdownEvent,
			ctx,
		);

		expect(execCalls.map((call) => call.args[0])).toEqual([
			"notify",
			"clear-notifications",
		]);
	});

	it("clears again after notifications in flight at shutdown settle", async () => {
		const send = Promise.withResolvers<MockExecResult>();
		const finalClear = Promise.withResolvers<void>();
		let clearCount = 0;
		const { pi, handlers, execCalls } = createMockPI((_tool, args) => {
			if (args[0] === "notify") return send.promise;
			clearCount++;
			if (clearCount === 3) finalClear.resolve();
			return { stdout: "", stderr: "", code: 0 };
		});
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
		await handlers.session_shutdown!(
			{ type: "session_shutdown" } as SessionShutdownEvent,
			ctx,
		);
		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			ctx,
		);

		expect(execCalls.map((call) => call.args[0])).toEqual([
			"notify",
			"clear-notifications",
			"clear-notifications",
		]);
		send.resolve({ stdout: "", stderr: "", code: 0 });
		await finalClear.promise;

		expect(execCalls.map((call) => call.args[0])).toEqual([
			"notify",
			"clear-notifications",
			"clear-notifications",
			"clear-notifications",
		]);
	});

	it("session_start clears notifications and initializes delivery state", async () => {
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
		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			ctx,
		);
		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			ctx,
		);
		await handlers.agent_end!(aborted, ctx);

		expect(execCalls.map((call) => call.args[0])).toEqual([
			"notify",
			"clear-notifications",
			"notify",
		]);
	});

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
});
