import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type {
	AgentEndEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	ExecResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBranchEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionSwitchEvent,
	SessionTreeEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	TurnEndEvent,
} from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import { registerSidebarHandlers, STATUS_KEYS } from "./sidebar";

const MOCK_CWD = "/tmp";
const OK: ExecResult = { stdout: "", stderr: "", code: 0, killed: false };

type Handler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;
type Executor = (
	tool: string,
	args: string[],
	callNumber: number,
) => ExecResult | Promise<ExecResult>;

interface ExecCall {
	tool: string;
	args: string[];
}

async function settleQueue(): Promise<void> {
	for (let index = 0; index < 100; index += 1) await Promise.resolve();
}

function createMockContext(
	hasUI: boolean,
	options: {
		idle?: boolean;
		model?: { id: string };
		tokens?: number;
	} = {},
): ExtensionContext {
	return {
		ui: { notify: mock(() => {}) } as unknown as ExtensionContext["ui"],
		getContextUsage: () =>
			options.tokens !== undefined
				? { tokens: options.tokens, contextWindow: 100_000, percent: 0 }
				: undefined,
		compact: async () => {},
		hasUI,
		cwd: MOCK_CWD,
		sessionManager: {} as ExtensionContext["sessionManager"],
		modelRegistry: {} as ExtensionContext["modelRegistry"],
		model: options.model as ExtensionContext["model"],
		models: {} as ExtensionContext["models"],
		isIdle: () => options.idle ?? true,
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

function createMockPI(execute?: Executor): {
	pi: ExtensionAPI;
	handlers: Record<string, Handler>;
	execCalls: ExecCall[];
} {
	const handlers: Record<string, Handler> = {};
	const execCalls: ExecCall[] = [];
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers[event] = handler;
		},
		exec: async (tool: string, args: string[]): Promise<ExecResult> => {
			execCalls.push({ tool, args });
			return execute?.(tool, args, execCalls.length) ?? OK;
		},
		getThinkingLevel: () => "medium" as const,
	} as unknown as ExtensionAPI;
	return { pi, handlers, execCalls };
}

function applyStatusCalls(calls: readonly ExecCall[]): Map<string, string> {
	const state = new Map<string, string>();
	for (const { args } of calls) {
		if (args[0] === "set-status") state.set(args[1]!, args[2]!);
		if (args[0] === "clear-status") state.delete(args[1]!);
	}
	return state;
}

function setCall(key: string, value: string, icon: string, color: string, priority: number): string[] {
	return [
		"set-status",
		key,
		value,
		"--icon",
		icon,
		"--color",
		color,
		"--priority",
		String(priority),
	];
}

function turnEnd(cost: number): TurnEndEvent {
	return {
		type: "turn_end",
		message: { role: "assistant", usage: { cost: { total: cost } } },
	} as unknown as TurnEndEvent;
}

async function drainDeferred(
	resolvers: Array<(result: ExecResult) => void>,
	execCalls: ExecCall[],
	expectedCalls: number,
): Promise<void> {
	for (let index = 0; index < expectedCalls; index += 1) {
		await settleQueue();
		expect(execCalls).toHaveLength(index + 1);
		resolvers[index]!(OK);
	}
	await settleQueue();
}

describe("registerSidebarHandlers", () => {
	let originalSocketPath: string | undefined;
	let originalTabId: string | undefined;

	beforeEach(() => {
		originalSocketPath = process.env.CMUX_SOCKET_PATH;
		originalTabId = process.env.CMUX_TAB_ID;
		process.env.CMUX_SOCKET_PATH = "/tmp/test-cmux.sock";
	});

	afterEach(() => {
		if (originalSocketPath === undefined) delete process.env.CMUX_SOCKET_PATH;
		else process.env.CMUX_SOCKET_PATH = originalSocketPath;
		if (originalTabId === undefined) delete process.env.CMUX_TAB_ID;
		else process.env.CMUX_TAB_ID = originalTabId;
		mock.restore();
	});

	it("serializes initialization clears before the full default projection", async () => {
		const resolvers: Array<(result: ExecResult) => void> = [];
		const { pi, handlers, execCalls } = createMockPI(() => {
			const deferred = Promise.withResolvers<ExecResult>();
			resolvers.push(deferred.resolve);
			return deferred.promise;
		});
		registerSidebarHandlers(pi);

		await handlers.session_start!(
			{ type: "session_start" } satisfies SessionStartEvent,
			createMockContext(true, {
				model: { id: "anthropic/claude-sonnet-4-20250514" },
				tokens: 1_000,
			}),
		);

		await drainDeferred(resolvers, execCalls, 10);
		expect(execCalls.map(({ args }) => args)).toEqual([
			...STATUS_KEYS.map((key) => ["clear-status", key]),
			setCall("omp_state", "Idle", "checkmark.circle", "#22C55E", 100),
			setCall("omp_model", "sonnet-4", "brain", "#8B5CF6", 60),
			setCall("omp_thinking", "medium", "sparkles", "#F59E0B", 50),
			setCall("omp_tokens", "1.0k", "number", "#3B82F6", 20),
		]);
	});

	it("keeps Working across continuation before the final Idle state", async () => {
		const first = Promise.withResolvers<ExecResult>();
		const { pi, handlers, execCalls } = createMockPI((_tool, _args, callNumber) =>
			callNumber === 1 ? first.promise : OK,
		);
		registerSidebarHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await settleQueue();
		await handlers.tool_execution_start!(
			{
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "read",
				args: {},
			} as unknown as ToolExecutionStartEvent,
			ctx,
		);
		await handlers.agent_end!(
			{ type: "agent_end", willContinue: true } as AgentEndEvent,
			ctx,
		);
		await settleQueue();
		expect(execCalls).toHaveLength(1);

		first.resolve(OK);
		await settleQueue();
		expect(applyStatusCalls(execCalls).get("omp_state")).toBe("Working");
		expect(applyStatusCalls(execCalls).has("omp_tool")).toBe(false);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await handlers.agent_end!({ type: "agent_end" } as AgentEndEvent, ctx);
		await settleQueue();

		expect(applyStatusCalls(execCalls).get("omp_state")).toBe("Idle");
		expect(execCalls[0]!.args).toEqual(
			setCall("omp_state", "Working", "arrow.circlepath", "#F59E0B", 100),
		);
		expect(execCalls.at(-2)!.args).toEqual(
			setCall("omp_state", "Idle", "checkmark.circle", "#22C55E", 100),
		);
		expect(execCalls.at(-1)!.args).toEqual(["clear-status", "omp_tool"]);
	});

	it("keeps agent_start after a delayed initialization projection", async () => {
		const first = Promise.withResolvers<ExecResult>();
		const { pi, handlers, execCalls } = createMockPI((_tool, _args, callNumber) =>
			callNumber === 1 ? first.promise : OK,
		);
		registerSidebarHandlers(pi);
		const ctx = createMockContext(true);

		await handlers.session_start!({ type: "session_start" } as SessionStartEvent, ctx);
		await settleQueue();
		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		first.resolve(OK);
		await settleQueue();

		const idleIndex = execCalls.findIndex(
			({ args }) => args[0] === "set-status" && args[1] === "omp_state" && args[2] === "Idle",
		);
		const workingIndex = execCalls.findIndex(
			({ args }) => args[0] === "set-status" && args[1] === "omp_state" && args[2] === "Working",
		);
		expect(idleIndex).toBeGreaterThanOrEqual(0);
		expect(idleIndex).toBeLessThan(workingIndex);
		expect(applyStatusCalls(execCalls).get("omp_state")).toBe("Working");
	});

	it("skips queued old-generation updates after a route reset", async () => {
		const blocked = Promise.withResolvers<ExecResult>();
		const { pi, handlers, execCalls } = createMockPI((_tool, _args, callNumber) =>
			callNumber === 1 ? blocked.promise : OK,
		);
		registerSidebarHandlers(pi);
		const oldCtx = createMockContext(true);

		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, oldCtx);
		await settleQueue();
		await handlers.agent_end!({ type: "agent_end" } as AgentEndEvent, oldCtx);
		await handlers.session_switch!(
			{ type: "session_switch", reason: "resume", previousSessionFile: "/old.jsonl" } satisfies SessionSwitchEvent,
			createMockContext(true, { model: { id: "openai/gpt-5.6" }, tokens: 2_000 }),
		);
		blocked.resolve(OK);
		await settleQueue();

		expect(
			execCalls.some(({ args }) => args[0] === "set-status" && args[1] === "omp_state" && args[2] === "Idle"),
		).toBe(true);
		expect(
			execCalls.filter(({ args }) => args[0] === "set-status" && args[1] === "omp_state" && args[2] === "Idle"),
		).toHaveLength(1);
		expect(applyStatusCalls(execCalls).get("omp_model")).toBe("gpt-5.6");
	});


	it("finishes sidebar cleanup before session_shutdown resolves", async () => {
		const blocked = Promise.withResolvers<ExecResult>();
		const { pi, handlers, execCalls } = createMockPI((_tool, _args, callNumber) =>
			callNumber === 1 ? blocked.promise : OK,
		);
		registerSidebarHandlers(pi);
		const ctx = createMockContext(true);
		await handlers.agent_start!({ type: "agent_start" } as AgentStartEvent, ctx);
		await settleQueue();

		let resolved = false;
		const shutdown = Promise.resolve(
			handlers.session_shutdown!(
				{ type: "session_shutdown" } as SessionShutdownEvent,
				createMockContext(false),
			),
		).then(() => {
			resolved = true;
		});
		await settleQueue();
		expect(resolved).toBe(false);

		blocked.resolve(OK);
		await shutdown;
		expect(applyStatusCalls(execCalls)).toEqual(new Map());
	});

	for (const route of [
		{
			name: "session_switch",
			event: { type: "session_switch", reason: "fork", previousSessionFile: "/old.jsonl" } satisfies SessionSwitchEvent,
		},
		{
			name: "session_branch",
			event: { type: "session_branch", previousSessionFile: "/old.jsonl" } satisfies SessionBranchEvent,
		},
		{
			name: "session_tree",
			event: { type: "session_tree", newLeafId: "new", oldLeafId: "old" } satisfies SessionTreeEvent,
		},
	] as const) {
		it(`${route.name} resets cost/tools and repaints current context`, async () => {
			const { pi, handlers, execCalls } = createMockPI();
			registerSidebarHandlers(pi);
			const oldCtx = createMockContext(true);
			await handlers.turn_end!(turnEnd(1), oldCtx);
			await handlers.tool_execution_start!(
				{ type: "tool_execution_start", toolCallId: "old", toolName: "read" } as ToolExecutionStartEvent,
				oldCtx,
			);
			await settleQueue();

			const newCtx = createMockContext(true, {
				model: { id: "provider/model-20260101" },
				tokens: 999_950,
			});
			await handlers[route.name]!(route.event, newCtx);
			await handlers.tool_execution_start!(
				{ type: "tool_execution_start", toolCallId: "new", toolName: "grep" } as ToolExecutionStartEvent,
				newCtx,
			);
			await handlers.tool_execution_end!(
				{ type: "tool_execution_end", toolCallId: "old" } as ToolExecutionEndEvent,
				newCtx,
			);
			await handlers.turn_end!(turnEnd(0.25), newCtx);
			await settleQueue();

			const state = applyStatusCalls(execCalls);
			expect(state.get("omp_model")).toBe("model");
			expect(state.get("omp_thinking")).toBe("medium");
			expect(state.get("omp_tokens")).toBe("1.0M");
			expect(state.get("omp_tool")).toBe("grep");
			expect(state.get("omp_cost")).toBe("run $0.25");
		});
	}

	it("does not route workspace status from a lone tab ID", async () => {
		const workspaceId = process.env.CMUX_WORKSPACE_ID;
		delete process.env.CMUX_SOCKET_PATH;
		delete process.env.CMUX_WORKSPACE_ID;
		process.env.CMUX_TAB_ID = "tab:only";
		spyOn(fs, "existsSync").mockReturnValue(false);
		const { pi, handlers, execCalls } = createMockPI();
		registerSidebarHandlers(pi);

		await handlers.agent_start!(
			{ type: "agent_start" } as AgentStartEvent,
			createMockContext(true),
		);
		await settleQueue();

		expect(execCalls).toEqual([]);
		delete process.env.CMUX_TAB_ID;
		if (workspaceId === undefined) delete process.env.CMUX_WORKSPACE_ID;
		else process.env.CMUX_WORKSPACE_ID = workspaceId;
	});

	it("does not write route or ordinary UI state when hasUI is false", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerSidebarHandlers(pi);
		const ctx = createMockContext(false, { model: { id: "claude-sonnet-4" }, tokens: 1234 });
		const events: Array<[string, unknown]> = [
			["session_start", { type: "session_start" } satisfies SessionStartEvent],
			["session_switch", { type: "session_switch", reason: "new", previousSessionFile: undefined } satisfies SessionSwitchEvent],
			["session_branch", { type: "session_branch", previousSessionFile: undefined } satisfies SessionBranchEvent],
			["session_tree", { type: "session_tree", newLeafId: null, oldLeafId: null } satisfies SessionTreeEvent],
			["before_agent_start", { type: "before_agent_start" } as BeforeAgentStartEvent],
			["agent_start", { type: "agent_start" } as AgentStartEvent],
			["agent_end", { type: "agent_end" } as AgentEndEvent],
		];
		for (const [name, event] of events) await handlers[name]!(event, ctx);
		await settleQueue();
		expect(execCalls).toEqual([]);
	});

	it("formats token boundaries and omits non-positive tokens", async () => {
		for (const [tokens, expected] of [
			[999, "999"],
			[1_000, "1.0k"],
			[999_949, "999.9k"],
			[999_950, "1.0M"],
			[1_000_000, "1.0M"],
			[0, undefined],
		] as const) {
			const { pi, handlers, execCalls } = createMockPI();
			registerSidebarHandlers(pi);
			await handlers.session_start!(
				{ type: "session_start" } as SessionStartEvent,
				createMockContext(true, { tokens }),
			);
			await settleQueue();
			expect(applyStatusCalls(execCalls).get("omp_tokens")).toBe(expected);
		}
	});

	it("formats cumulative run cost and ignores invalid values", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerSidebarHandlers(pi);
		const ctx = createMockContext(true);
		for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			await handlers.turn_end!(turnEnd(invalid), ctx);
		}
		await settleQueue();
		expect(applyStatusCalls(execCalls).has("omp_cost")).toBe(false);

		await handlers.turn_end!(turnEnd(0.004), ctx);
		await settleQueue();
		expect(applyStatusCalls(execCalls).get("omp_cost")).toBe("run <$0.01");
		await handlers.turn_end!(turnEnd(0.006), ctx);
		await settleQueue();
		expect(applyStatusCalls(execCalls).get("omp_cost")).toBe("run $0.01");
	});

	it("normalizes provider-qualified and long model IDs by Unicode code point", async () => {
		for (const [id, expected] of [
			["anthropic/claude-sonnet-4-20250514", "sonnet-4"],
			["provider/model-name-20260101", "model-name"],
			["provider/abcdefghijklmnopqrstuvwxy", "abcdefghijklmnopqrstuvw…"],
		] as const) {
			const { pi, handlers, execCalls } = createMockPI();
			registerSidebarHandlers(pi);
			await handlers.session_start!(
				{ type: "session_start" } as SessionStartEvent,
				createMockContext(true, { model: { id } }),
			);
			await settleQueue();
			expect(applyStatusCalls(execCalls).get("omp_model")).toBe(expected);
		}
	});

	it("keeps the last active tool until every tool completes", async () => {
		const { pi, handlers, execCalls } = createMockPI();
		registerSidebarHandlers(pi);
		const ctx = createMockContext(true);
		await handlers.tool_execution_start!(
			{ type: "tool_execution_start", toolCallId: "one", toolName: "read" } as ToolExecutionStartEvent,
			ctx,
		);
		await handlers.tool_execution_start!(
			{ type: "tool_execution_start", toolCallId: "two", toolName: "grep" } as ToolExecutionStartEvent,
			ctx,
		);
		await handlers.tool_execution_end!(
			{ type: "tool_execution_end", toolCallId: "one" } as ToolExecutionEndEvent,
			ctx,
		);
		await settleQueue();
		expect(applyStatusCalls(execCalls).get("omp_tool")).toBe("grep");
		await handlers.tool_execution_end!(
			{ type: "tool_execution_end", toolCallId: "two" } as ToolExecutionEndEvent,
			ctx,
		);
		await settleQueue();
		expect(applyStatusCalls(execCalls).has("omp_tool")).toBe(false);
	});
});
