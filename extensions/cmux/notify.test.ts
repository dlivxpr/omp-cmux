import { describe, expect, it, mock } from "bun:test";
import type {
	AgentEndEvent,
	AgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "@oh-my-pi/pi-coding-agent";
import { createNotifyTracker, registerNotifyHandlers } from "./notify";

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
			return { stdout: "", stderr: "", exitCode: 0 };
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, execCalls };
}

describe("registerNotifyHandlers child-agent filtering", () => {
	it("ignores agent_start, tool_result and agent_end when ctx.hasUI is false", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		const tracker = createNotifyTracker();
		registerNotifyHandlers(pi, tracker);

		const parentCtx = createMockContext(true);
		const childCtx = createMockContext(false);

		// Parent starts the run.
		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			parentCtx,
		);

		// Parent records a read.
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
		expect(tracker.state.readFiles.has("README.md")).toBe(true);

		// Child agent_start must NOT reset tracker state.
		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			childCtx,
		);
		expect(tracker.state.readFiles.has("README.md")).toBe(true);

		// Child tool_result must NOT pollute tracker stats.
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
		expect(tracker.state.searchCount).toBe(0);

		// Child agent_end must NOT send a notification.
		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			childCtx,
		);
		expect(execCalls.length).toBe(0);
	});

	it("processes parent-agent events normally and sends a notification", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		const tracker = createNotifyTracker();
		registerNotifyHandlers(pi, tracker);

		const parentCtx = createMockContext(true);

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

		await handlers.agent_end!(
			{
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "endTurn" }],
			} as unknown as AgentEndEvent,
			parentCtx,
		);

		// Summary notification should have been sent via cmux.
		expect(execCalls.length).toBeGreaterThanOrEqual(1);
		expect(execCalls[0].tool).toBe("cmux");
		expect(execCalls[0].args[0]).toBe("notify");
		expect(tracker.state.readFiles.has("README.md")).toBe(true);
	});

	it("clears notifications on session_shutdown", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		const tracker = createNotifyTracker();
		registerNotifyHandlers(pi, tracker);

		await handlers.session_shutdown!(
			{ type: "session_shutdown" } as SessionShutdownEvent,
			createMockContext(true),
		);

		expect(execCalls.length).toBe(1);
		expect(execCalls[0].tool).toBe("cmux");
		expect(execCalls[0].args[0]).toBe("clear-notifications");
	});

	it("clears notifications on session_start when hasUI=true", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		const tracker = createNotifyTracker();
		registerNotifyHandlers(pi, tracker);

		const parentCtx = createMockContext(true);
		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			parentCtx,
		);

		expect(execCalls.length).toBe(1);
		expect(execCalls[0].tool).toBe("cmux");
		expect(execCalls[0].args[0]).toBe("clear-notifications");
	});

	it("ignores session_start when hasUI=false (child agent)", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		const tracker = createNotifyTracker();
		registerNotifyHandlers(pi, tracker);

		const childCtx = createMockContext(false);
		await handlers.session_start!(
			{ type: "session_start" } as SessionStartEvent,
			childCtx,
		);

		expect(execCalls.length).toBe(0);
	});
});
