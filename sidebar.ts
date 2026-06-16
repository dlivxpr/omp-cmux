import type {
	ExtensionAPI,
	SessionStartEvent,
	AgentStartEvent,
	AgentEndEvent,
	BeforeAgentStartEvent,
	TurnEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionEndEvent,
	SessionShutdownEvent,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { cmux } from "./cmux";

export const STATUS_KEYS = [
	"omp_state",
	"omp_model",
	"omp_thinking",
	"omp_tokens",
	"omp_cost",
	"omp_tool",
] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

export async function setSidebarState(
	pi: ExtensionAPI,
	updates: Partial<Record<StatusKey, string>>,
): Promise<void> {
	for (const [key, value] of Object.entries(updates)) {
		if (value !== undefined && value !== "") {
			await cmux(pi, "set-status", key, value);
		}
	}
}

export async function clearSidebar(pi: ExtensionAPI): Promise<void> {
	for (const key of STATUS_KEYS) {
		await cmux(pi, "clear-status", key);
	}
}

export async function safeSetSidebarState(
	pi: ExtensionAPI,
	updates: Partial<Record<StatusKey, string>>,
): Promise<void> {
	try {
		await setSidebarState(pi, updates);
	} catch {
		// Best-effort: sidebar failures must not break the main flow
	}
}

export async function safeClearSidebar(pi: ExtensionAPI): Promise<void> {
	try {
		await clearSidebar(pi);
	} catch {
		// Best-effort
	}
}

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------
const GREEN = "#22C55E";
const AMBER = "#F59E0B";
const PURPLE = "#8B5CF6";
const BLUE = "#3B82F6";
const GRAY = "#6B7280";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}k`;
	}
	return String(n);
}

function formatCost(n: number): string {
	return `$${n.toFixed(2)}`;
}

function shortModel(id: string): string {
	return id
		.replace(/^claude-/, "")
		.replace(/-\d{8}$/, "");
}

// ---------------------------------------------------------------------------
// Sidebar event handlers
// ---------------------------------------------------------------------------
export function registerSidebarHandlers(pi: ExtensionAPI): void {
	let sessionCost = 0;

	function run(...args: string[]) {
		cmux(pi, ...args).catch(() => {});
	}

	function setStatus(key: string, value: string, icon: string, color: string) {
		run("set-status", key, value, "--icon", icon, "--color", color);
	}

	function clearStatus(key: string) {
		run("clear-status", key);
	}

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		sessionCost = 0;

		for (const key of STATUS_KEYS) {
			clearStatus(key);
		}

		setStatus("omp_state", "Idle", "checkmark.circle", GREEN);

		if (ctx.model?.id) {
			setStatus("omp_model", shortModel(ctx.model.id), "brain", PURPLE);
		}

		const thinking = pi.getThinkingLevel();
		if (thinking && thinking !== "off") {
			setStatus("omp_thinking", thinking, "sparkles", AMBER);
		} else if (thinking === "off") {
			setStatus("omp_thinking", "off", "sparkles", GRAY);
		}

		const usage = ctx.getContextUsage();
		if (usage && usage.tokens != null && usage.tokens > 0) {
			setStatus("omp_tokens", formatTokens(usage.tokens), "number", BLUE);
		}
	});

	pi.on("before_agent_start", async (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		// Earliest model refresh: fires right after user submits prompt,
		// before the agent loop begins.  This catches model changes from
		// /model or /settings before the next agent invocation.
		if (ctx.model?.id) {
			setStatus("omp_model", shortModel(ctx.model.id), "brain", PURPLE);
		}
		const thinking = pi.getThinkingLevel();
		if (thinking && thinking !== "off") {
			setStatus("omp_thinking", thinking, "sparkles", AMBER);
		} else if (thinking === "off") {
			setStatus("omp_thinking", "off", "sparkles", GRAY);
		}
	});

	pi.on("agent_start", async (_event: AgentStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		setStatus("omp_state", "Working", "arrow.circlepath", AMBER);
	});

	pi.on("agent_end", async (_event: AgentEndEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		setStatus("omp_state", "Idle", "checkmark.circle", GREEN);
		clearStatus("omp_tool");

		const usage = ctx.getContextUsage();
		if (usage && usage.tokens != null && usage.tokens > 0) {
			setStatus("omp_tokens", formatTokens(usage.tokens), "number", BLUE);
		}

		if (sessionCost > 0) {
			setStatus("omp_cost", formatCost(sessionCost), "dollarsign.circle", GREEN);
		}

	});

	pi.on("turn_end", async (event: TurnEndEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;

		const msg = event.message;
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			if (assistantMsg.usage?.cost?.total) {
				sessionCost += assistantMsg.usage.cost.total;
				setStatus("omp_cost", formatCost(sessionCost), "dollarsign.circle", GREEN);
			}
		}

		const usage = ctx.getContextUsage();
		if (usage && usage.tokens != null && usage.tokens > 0) {
			setStatus("omp_tokens", formatTokens(usage.tokens), "number", BLUE);
		}
	});

	pi.on("tool_execution_start", async (event: ToolExecutionStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		setStatus("omp_tool", event.toolName, "wrench", GRAY);
	});

	pi.on("tool_execution_end", async (_event: ToolExecutionEndEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		clearStatus("omp_tool");
	});

	pi.on("session_shutdown", async (_event: SessionShutdownEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		for (const key of STATUS_KEYS) {
			clearStatus(key);
		}
	});
}
