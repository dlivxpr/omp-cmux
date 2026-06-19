import {
	describe,
	expect,
	it,
	mock,
	beforeEach,
	afterEach,
} from "bun:test";
import type {
	AgentEndEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
} from "@oh-my-pi/pi-coding-agent";
import { registerSidebarHandlers, STATUS_KEYS } from "./sidebar";

const MOCK_CWD = "/tmp";

type Handler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;

function createMockContext(
	hasUI: boolean,
	options?: {
		model?: { id: string };
		tokens?: number;
	},
): ExtensionContext {
	return {
		ui: { notify: mock(() => {}) } as unknown as ExtensionContext["ui"],
		getContextUsage: () =>
			options?.tokens !== undefined
				? { tokens: options.tokens, contextWindow: 100_000, percent: 0 }
				: undefined,
		compact: async () => {},
		hasUI,
		cwd: MOCK_CWD,
		sessionManager: {} as ExtensionContext["sessionManager"],
		modelRegistry: {} as ExtensionContext["modelRegistry"],
		model: (options?.model ?? undefined) as ExtensionContext["model"],
		models: {} as ExtensionContext["models"],
		isIdle: () => true,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getSystemPrompt: () => [],
		memory: undefined,
	} as ExtensionContext;
}

function createMockPI(): {
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
		exec: async (tool: string, args: string[]) => {
			execCalls.push({ tool, args });
			return { stdout: "", stderr: "", code: 0 };
		},
		getThinkingLevel: () => "medium" as const,
	} as unknown as ExtensionAPI;
	return { pi, handlers, execCalls };
}

describe("registerSidebarHandlers", () => {
	let originalSocketPath: string | undefined;

	beforeEach(() => {
		originalSocketPath = process.env.CMUX_SOCKET_PATH;
		process.env.CMUX_SOCKET_PATH = "/tmp/test-cmux.sock";
	});

	afterEach(() => {
		process.env.CMUX_SOCKET_PATH = originalSocketPath;
	});

	it("session_start clears old status and sets defaults", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerSidebarHandlers(pi);

		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			createMockContext(true),
		);

		const clearCalls = execCalls.slice(0, STATUS_KEYS.length);
		expect(clearCalls.map((call) => call.args)).toEqual(
			STATUS_KEYS.map((key) => ["clear-status", key]),
		);

		const stateCall = execCalls.find(
			(call) =>
				call.args[0] === "set-status" &&
				call.args[1] === "omp_state" &&
				call.args[2] === "Idle",
		);
		expect(stateCall).toBeDefined();
	});

	it("session_shutdown clears sidebar regardless of hasUI", async () => {
		for (const hasUI of [true, false]) {
			const { pi, handlers, execCalls } = createMockPI();
			registerSidebarHandlers(pi);

			await handlers.session_shutdown!(
				{ type: "session_shutdown" } as SessionShutdownEvent,
				createMockContext(hasUI),
			);

			const clearCalls = execCalls.filter(
				(call) => call.args[0] === "clear-status",
			);
			expect(clearCalls.map((call) => call.args)).toEqual(
				STATUS_KEYS.map((key) => ["clear-status", key]),
			);
		}
	});

	it("session_start clears activeTools", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerSidebarHandlers(pi);

		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			createMockContext(true),
		);

		await handlers.tool_execution_start!(
			{
				type: "tool_execution_start",
				toolCallId: "tc1",
				toolName: "read",
			} as ToolExecutionStartEvent,
			createMockContext(true),
		);

		await handlers.tool_execution_start!(
			{
				type: "tool_execution_start",
				toolCallId: "tc2",
				toolName: "search",
			} as ToolExecutionStartEvent,
			createMockContext(true),
		);

		const callsBeforeRestart = execCalls.length;

		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			createMockContext(true),
		);

		await handlers.tool_execution_end!(
			{
				type: "tool_execution_end",
				toolCallId: "tc1",
			} as ToolExecutionEndEvent,
			createMockContext(true),
		);

		const setToolCallsAfterRestart = execCalls
			.slice(callsBeforeRestart)
			.filter(
				(call) =>
					call.args[0] === "set-status" && call.args[1] === "omp_tool",
			);

		expect(setToolCallsAfterRestart.length).toBe(0);
	});

	it("child agent start events are ignored (hasUI=false)", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerSidebarHandlers(pi);

		const childCtx = createMockContext(false, {
			model: { id: "claude-sonnet-4-20250514" },
			tokens: 1234,
		});

		await handlers.before_agent_start!(
			{ type: "before_agent_start" } as BeforeAgentStartEvent,
			childCtx,
		);
		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			childCtx,
		);
		await handlers.agent_end!(
			{ type: "agent_end" } as AgentEndEvent,
			childCtx,
		);
		await handlers.tool_execution_start!(
			{
				type: "tool_execution_start",
				toolCallId: "tc1",
				toolName: "read",
			} as ToolExecutionStartEvent,
			childCtx,
		);

		expect(execCalls.length).toBe(0);
	});
});
