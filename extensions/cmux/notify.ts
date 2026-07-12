import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	AgentEndEvent,
	ToolResultEvent,
	SessionShutdownEvent,
	AgentStartEvent,
	SessionStartEvent,
} from "@oh-my-pi/pi-coding-agent";
import { isSilentAbort } from "@oh-my-pi/pi-coding-agent";
import { cmuxNotify } from "./cmux";
import { getNotifyLevel, shouldNotify, getNumberFromEnv } from "./config";

// ---------------------------------------------------------------------------
// Tool result guards
// ---------------------------------------------------------------------------
function isReadToolResult(e: ToolResultEvent): boolean {
	return e.toolName === "read";
}
function isEditToolResult(e: ToolResultEvent): boolean {
	return e.toolName === "edit";
}
function isWriteToolResult(e: ToolResultEvent): boolean {
	return e.toolName === "write";
}
function isSearchToolResult(e: ToolResultEvent): boolean {
	return e.toolName === "grep" || e.toolName === "glob";
}
function isBashToolResult(e: ToolResultEvent): boolean {
	return e.toolName === "bash";
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------
interface RunState {
	startedAt: number;
	readFiles: Set<string>;
	changedFiles: Set<string>;
	searchCount: number;
	bashCount: number;
	firstToolError: string | undefined;
}

interface PendingRun {
	readonly state: RunState;
}

function createRunState(): RunState {
	return {
		startedAt: Date.now(),
		readFiles: new Set(),
		changedFiles: new Set(),
		searchCount: 0,
		bashCount: 0,
		firstToolError: undefined,
	};
}


function extractTarget(toolName: string, input: Record<string, unknown>): string {
	switch (toolName) {
		case "edit":
		case "write":
			return String(input.path ?? input.file ?? input.target ?? "");
		case "read":
			return String(input.path ?? input.file ?? "");
		case "search":
			return String(input.pattern ?? input.query ?? input.path ?? "");
		case "bash":
			return String(input.command ?? "").slice(0, 60);
		default:
			return "";
	}
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.round(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}


// ---------------------------------------------------------------------------
// Summary generation (aligned with upstream)
// ---------------------------------------------------------------------------
type NotificationKind = "waiting" | "complete" | "error";
type AgentEndStatus = "success" | "error" | "aborted" | "plan_ready";

interface NotificationPayload {
	readonly kind: NotificationKind;
	readonly title: string;
	readonly subtitle: string;
	readonly body: string;
}

function generateSummary(
	state: RunState,
	durationMs: number,
	status: AgentEndStatus,
	terminalError: string | undefined,
): NotificationPayload {
	if (status === "plan_ready") {
		return {
			kind: "complete",
			title: "Plan Ready",
			subtitle: "Review the plan to apply or refine",
			body: "",
		};
	}

	if (status === "aborted") {
		return {
			kind: "error",
			title: "Aborted",
			subtitle: "Session was aborted",
			body: "",
		};
	}

	if (status === "error") {
		return {
			kind: "error",
			title: "Error",
			subtitle:
				terminalError ?? state.firstToolError ?? "Session ended with an error",
			body: "",
		};
	}

	const parts: string[] = [];
	const changed = Array.from(state.changedFiles);
	const reads = Array.from(state.readFiles);

	if (changed.length === 1) {
		parts.push(`Updated ${changed[0].split("/").pop() || changed[0]}`);
	} else if (changed.length > 1) {
		parts.push(`Updated ${changed.length} files`);
	}

	if (reads.length === 1) {
		parts.push(`Reviewed ${reads[0].split("/").pop() || reads[0]}`);
	} else if (reads.length > 1) {
		parts.push(`Reviewed ${reads.length} files`);
	}

	if (state.searchCount > 0 || state.bashCount > 0) {
		const runParts: string[] = [];
		if (state.searchCount > 0) {
			runParts.push(
				`${state.searchCount} search${state.searchCount > 1 ? "es" : ""}`,
			);
		}
		if (state.bashCount > 0) {
			runParts.push(
				`${state.bashCount} shell command${state.bashCount > 1 ? "s" : ""}`,
			);
		}
		parts.push(`Ran ${runParts.join(" and ")}`);
	}

	let subtitle = parts.length ? parts.join(", ") : "Task completed";

	const thresholdMs = getNumberFromEnv("PI_CMUX_NOTIFY_THRESHOLD_MS", 15000);
	if (durationMs >= thresholdMs) {
		subtitle += ` in ${formatDuration(durationMs)}`;
	}

	return { kind: "complete", title: "Task Complete", subtitle, body: "" };
}

function getAgentEndStatus(messages: AgentMessage[]): AgentEndStatus {
	const lastMsg = messages[messages.length - 1];
	if (lastMsg?.role === "assistant") {
		const assistant = lastMsg as AssistantMessage;
		if (assistant.stopReason === "error") return "error";
		if (
			assistant.stopReason === "aborted" &&
			isSilentAbort(assistant)
		)
			return "plan_ready";
		if (assistant.stopReason === "aborted") return "aborted";
	}
	return "success";
}

function getErrorMessage(
	messages: AgentMessage[],
): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const assistant = msg as AssistantMessage;
			if (assistant.stopReason === "error" && assistant.errorMessage) {
				return assistant.errorMessage;
			}
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Notification sender with debounce & availability tracking
// ---------------------------------------------------------------------------
interface NotificationReservation {
	readonly sessionGeneration: number;
}

interface NotificationDeliveryState {
	sessionGeneration: number;
	inFlightByKey: Map<string, NotificationReservation>;
	deliveredAtByKey: Map<string, number>;
}

function sendNotification(
	pi: ExtensionAPI,
	state: NotificationDeliveryState,
	notification: NotificationPayload,
): void {
	if (!shouldNotify(getNotifyLevel(), notification.kind)) return;

	const debounceMs = getNumberFromEnv("PI_CMUX_NOTIFY_DEBOUNCE_MS", 3000);
	const key = JSON.stringify([
		notification.title,
		notification.subtitle,
		notification.body,
	]);
	const lastDeliveredAt = state.deliveredAtByKey.get(key);
	if (state.inFlightByKey.has(key)) return;
	if (
		lastDeliveredAt !== undefined &&
		Date.now() - lastDeliveredAt < debounceMs
	) {
		return;
	}

	const reservation: NotificationReservation = {
		sessionGeneration: state.sessionGeneration,
	};
	state.inFlightByKey.set(key, reservation);

	const args = ["notify", "--title", notification.title];
	if (notification.subtitle) {
		args.push("--subtitle", notification.subtitle);
	}
	if (notification.body) args.push("--body", notification.body);

	cmuxNotify(pi, ...args)
		.then((result) => {
			if (
				result?.code === 0 &&
				state.sessionGeneration === reservation.sessionGeneration
			) {
				state.deliveredAtByKey.set(key, Date.now());
			}
		})
		.catch(() => {})
		.finally(() => {
			if (state.inFlightByKey.get(key) === reservation) {
				state.inFlightByKey.delete(key);
			}
		});
}

function safeSendNotification(
	pi: ExtensionAPI,
	state: NotificationDeliveryState,
	notification: NotificationPayload,
): void {
	try {
		sendNotification(pi, state, notification);
	} catch {
		// Best-effort: never let notification failures affect the main flow
	}
}


// Handlers
// ---------------------------------------------------------------------------

export function registerNotifyHandlers(pi: ExtensionAPI): void {
	const pendingRuns: PendingRun[] = [];
	const deliveryState: NotificationDeliveryState = {
		sessionGeneration: 0,
		inFlightByKey: new Map(),
		deliveredAtByKey: new Map(),
	};

	pi.on("agent_start", async (_event: AgentStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		pendingRuns.push({ state: createRunState() });
	});

	pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const state = pendingRuns.at(-1)?.state;
		if (!state) return;

		if (event.isError) {
			if (!state.firstToolError) {
				const text = event.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join(" ")
					.slice(0, 200);
				state.firstToolError = text || "Tool error";
			}
			return;
		}

		if (isReadToolResult(event)) {
			const target = extractTarget(event.toolName, event.input);
			if (target) state.readFiles.add(target);
		} else if (isEditToolResult(event) || isWriteToolResult(event)) {
			const target = extractTarget(event.toolName, event.input);
			if (target) state.changedFiles.add(target);
		} else if (isSearchToolResult(event)) {
			state.searchCount++;
		} else if (isBashToolResult(event)) {
			state.bashCount++;
		}
	});

	pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const pendingRun = pendingRuns.shift();
		if (!pendingRun) return;

		const status = getAgentEndStatus(event.messages);
		const terminalError =
			status === "error" ? getErrorMessage(event.messages) : undefined;
		const durationMs = Date.now() - pendingRun.state.startedAt;
		const summary = generateSummary(
			pendingRun.state,
			durationMs,
			status,
			terminalError,
		);
		safeSendNotification(pi, deliveryState, summary);

		if (status === "success") {
			const thresholdMs = getNumberFromEnv(
				"PI_CMUX_NOTIFY_THRESHOLD_MS",
				15000,
			);
			if (durationMs >= thresholdMs) {
				safeSendNotification(pi, deliveryState, {
					kind: "waiting",
					title: "Waiting",
					subtitle: "Ready for input",
					body: "",
				});
			}
		}
	});

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		pendingRuns.length = 0;
		deliveryState.sessionGeneration++;
		deliveryState.inFlightByKey.clear();
		deliveryState.deliveredAtByKey.clear();
	});

	pi.on("session_shutdown", async (_event: SessionShutdownEvent) => {
		pendingRuns.length = 0;
		deliveryState.sessionGeneration++;
		deliveryState.inFlightByKey.clear();
		deliveryState.deliveredAtByKey.clear();
	});
}
