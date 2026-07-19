import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type {
	AgentEndEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
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
import { cmuxWorkspace } from "./cmux";

export const STATUS_KEYS = [
	"omp_state",
	"omp_model",
	"omp_thinking",
	"omp_tokens",
	"omp_cost",
	"omp_tool",
] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

const GREEN = "#22C55E";
const AMBER = "#F59E0B";
const PURPLE = "#8B5CF6";
const BLUE = "#3B82F6";
const GRAY = "#6B7280";

interface StatusPresentation {
	icon: string;
	color: string;
	priority: number;
}

const STATUS_PRESENTATION: Record<StatusKey, StatusPresentation> = {
	omp_state: { icon: "checkmark.circle", color: GREEN, priority: 100 },
	omp_tool: { icon: "wrench", color: GRAY, priority: 90 },
	omp_model: { icon: "brain", color: PURPLE, priority: 60 },
	omp_thinking: { icon: "sparkles", color: AMBER, priority: 50 },
	omp_tokens: { icon: "number", color: BLUE, priority: 20 },
	omp_cost: { icon: "dollarsign.circle", color: GREEN, priority: 10 },
};

function getStatusPresentation(
	key: StatusKey,
	value: string,
): StatusPresentation {
	if (key === "omp_state" && value === "Working") {
		return { icon: "arrow.circlepath", color: AMBER, priority: 100 };
	}
	if (key === "omp_thinking" && value === "off") {
		return { icon: "sparkles", color: GRAY, priority: 50 };
	}
	return STATUS_PRESENTATION[key];
}

interface SidebarWriter {
	reset(initial: ReadonlyMap<StatusKey, string>): void;
	set(key: StatusKey, value: string): void;
	clear(key: StatusKey): void;
	invalidateAndClear(): Promise<void>;
}

function createSidebarWriter(pi: ExtensionAPI): SidebarWriter {
	let generation = 0;
	let tail: Promise<void> = Promise.resolve();

	function enqueue(expectedGeneration: number, args: string[]): void {
		const execute = async (): Promise<void> => {
			if (expectedGeneration !== generation) return;
			try {
				await cmuxWorkspace(pi, ...args);
			} catch {
				// Best-effort: sidebar failures must not break the main flow.
			}
		};
		tail = tail.then(execute, execute);
	}

	return {
		reset(initial) {
			generation += 1;
			const expectedGeneration = generation;
			for (const key of STATUS_KEYS) {
				enqueue(expectedGeneration, ["clear-status", key]);
			}
			for (const key of STATUS_KEYS) {
				const value = initial.get(key);
				if (value === undefined || value === "") continue;
				const presentation = getStatusPresentation(key, value);
				enqueue(expectedGeneration, [
					"set-status",
					key,
					value,
					"--icon",
					presentation.icon,
					"--color",
					presentation.color,
					"--priority",
					String(presentation.priority),
				]);
			}
		},
		set(key, value) {
			if (value === "") return;
			const presentation = getStatusPresentation(key, value);
			enqueue(generation, [
				"set-status",
				key,
				value,
				"--icon",
				presentation.icon,
				"--color",
				presentation.color,
				"--priority",
				String(presentation.priority),
			]);
		},
		clear(key) {
			enqueue(generation, ["clear-status", key]);
		},
		invalidateAndClear() {
			generation += 1;
			const expectedGeneration = generation;
			for (const key of STATUS_KEYS) {
				enqueue(expectedGeneration, ["clear-status", key]);
			}
			return tail;
		},
	};
}

function formatTokens(tokens: number): string {
	if (tokens >= 999_950) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}k`;
	}
	return String(tokens);
}

function formatCost(cost: number): string {
	return cost < 0.01 ? "run <$0.01" : `run $${cost.toFixed(2)}`;
}

function formatModelId(id: string): string {
	const segment = id.split("/").at(-1) ?? "";
	const normalized = segment
		.replace(/-\d{8}$/, "")
		.replace(/^claude-/, "");
	const codePoints = Array.from(normalized);
	return codePoints.length > 24
		? `${codePoints.slice(0, 23).join("")}…`
		: normalized;
}

export function registerSidebarHandlers(pi: ExtensionAPI): void {
	let runCost = 0;
	const activeTools = new Map<string, string>();
	const writer = createSidebarWriter(pi);

	function resetSessionProjection(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		runCost = 0;
		activeTools.clear();

		const initial = new Map<StatusKey, string>();
		initial.set("omp_state", ctx.isIdle() ? "Idle" : "Working");
		if (ctx.model?.id) {
			initial.set("omp_model", formatModelId(ctx.model.id));
		}
		const thinking = pi.getThinkingLevel();
		if (thinking) {
			initial.set("omp_thinking", thinking);
		}
		const tokens = ctx.getContextUsage()?.tokens;
		if (tokens !== undefined && Number.isFinite(tokens) && tokens > 0) {
			initial.set("omp_tokens", formatTokens(tokens));
		}
		writer.reset(initial);
	}

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		resetSessionProjection(ctx);
	});

	pi.on("session_switch", async (_event: SessionSwitchEvent, ctx: ExtensionContext) => {
		resetSessionProjection(ctx);
	});

	pi.on("session_branch", async (_event: SessionBranchEvent, ctx: ExtensionContext) => {
		resetSessionProjection(ctx);
	});

	pi.on("session_tree", async (_event: SessionTreeEvent, ctx: ExtensionContext) => {
		resetSessionProjection(ctx);
	});

	pi.on("before_agent_start", async (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (ctx.model?.id) {
			writer.set("omp_model", formatModelId(ctx.model.id));
		}
		const thinking = pi.getThinkingLevel();
		if (thinking) {
			writer.set("omp_thinking", thinking);
		}
	});

	pi.on("agent_start", async (_event: AgentStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		writer.set("omp_state", "Working");
	});

	pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		writer.set("omp_state", event.willContinue === true ? "Working" : "Idle");
		writer.clear("omp_tool");

		const tokens = ctx.getContextUsage()?.tokens;
		if (tokens !== undefined && Number.isFinite(tokens) && tokens > 0) {
			writer.set("omp_tokens", formatTokens(tokens));
		}
		if (runCost > 0) {
			writer.set("omp_cost", formatCost(runCost));
		}
	});

	pi.on("turn_end", async (event: TurnEndEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;

		if (event.message.role === "assistant") {
			const cost = (event.message as AssistantMessage).usage?.cost?.total;
			if (cost !== undefined && Number.isFinite(cost) && cost > 0) {
				runCost += cost;
				writer.set("omp_cost", formatCost(runCost));
			}
		}

		const tokens = ctx.getContextUsage()?.tokens;
		if (tokens !== undefined && Number.isFinite(tokens) && tokens > 0) {
			writer.set("omp_tokens", formatTokens(tokens));
		}
	});

	pi.on("tool_execution_start", async (event: ToolExecutionStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		activeTools.set(event.toolCallId, event.toolName);
		writer.set("omp_tool", event.toolName);
	});

	pi.on("tool_execution_end", async (event: ToolExecutionEndEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		activeTools.delete(event.toolCallId);
		let lastTool: string | undefined;
		for (const toolName of activeTools.values()) {
			lastTool = toolName;
		}
		if (lastTool !== undefined) {
			writer.set("omp_tool", lastTool);
		} else {
			writer.clear("omp_tool");
		}
	});

	pi.on("session_shutdown", async (_event: SessionShutdownEvent, _ctx: ExtensionContext) => {
		await writer.invalidateAndClear();
	});
}
