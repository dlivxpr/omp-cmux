import type {
	ExtensionAPI,
	AgentEndEvent,
	ToolResultEvent,
	InputEvent,
	SessionShutdownEvent,
	AgentStartEvent,
	AgentMessage,
	AssistantMessage,
} from "@oh-my-pi/pi-coding-agent";
import { cmux } from "./cmux";
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
	return e.toolName === "search" || e.toolName === "find";
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

function hashKey(subtitle: string, body: string): string {
	// Simple hash for deduplication
	let h = 0;
	const str = subtitle + "\n" + body;
	for (let i = 0; i < str.length; i++) {
		h = ((h << 5) - h + str.charCodeAt(i)) | 0;
	}
	return String(h);
}

// ---------------------------------------------------------------------------
// Summary generation (aligned with upstream)
// ---------------------------------------------------------------------------
function generateSummary(
	state: RunState,
	durationMs: number,
	status: "success" | "error" | "aborted",
): { title: string; subtitle: string; body: string } {
	if (status === "aborted") {
		return { title: "Aborted", subtitle: "Session was aborted", body: "" };
	}

	if (status === "error") {
		return {
			title: "Error",
			subtitle: state.firstToolError || "Session ended with an error",
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

	return { title: "Task Complete", subtitle, body: "" };
}

function getAgentEndStatus(
	messages: AgentMessage[],
): "success" | "error" | "aborted" {
	const lastMsg = messages[messages.length - 1];
	if (lastMsg?.role === "assistant") {
		const assistant = lastMsg as AssistantMessage;
		if (assistant.stopReason === "error") return "error";
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
let cmuxUnavailable = false;
let lastNotificationKey = "";
let lastNotificationAt = 0;

async function sendNotification(
	pi: ExtensionAPI,
	title: string,
	subtitle: string,
	body: string,
): Promise<void> {
	if (cmuxUnavailable) return;

	const level = getNotifyLevel();
	// Determine notify type from title for level filtering
	let type: "waiting" | "complete" | "error" = "complete";
	if (title === "Waiting") type = "waiting";
	else if (title === "Error" || title === "Aborted") type = "error";

	if (!shouldNotify(level, type)) return;

	// Debounce
	const debounceMs = getNumberFromEnv("PI_CMUX_NOTIFY_DEBOUNCE_MS", 3000);
	const key = hashKey(subtitle, body);
	const now = Date.now();
	if (key === lastNotificationKey && now - lastNotificationAt < debounceMs) {
		return;
	}

	const args = ["notify", "--title", title];
	if (subtitle) args.push("--subtitle", subtitle);
	if (body) args.push("--body", body);

	const result = await cmux(pi, ...args);
	if (result && result.exitCode !== 0) {
		cmuxUnavailable = true;
		return;
	}

	lastNotificationKey = key;
	lastNotificationAt = now;
}

export async function safeSendNotification(
	pi: ExtensionAPI,
	title: string,
	subtitle: string,
	body: string,
): Promise<void> {
	try {
		await sendNotification(pi, title, subtitle, body);
	} catch {
		// Best-effort: never let notification failures affect the main flow
	}
}

// ---------------------------------------------------------------------------
// Tracker & handlers
// ---------------------------------------------------------------------------
export interface NotifyTracker {
	state: RunState;
	reset(): void;
}

export function createNotifyTracker(): NotifyTracker {
	const state = createRunState();
	return {
		state,
		reset(): void {
			state.startedAt = Date.now();
			state.readFiles.clear();
			state.changedFiles.clear();
			state.searchCount = 0;
			state.bashCount = 0;
			state.firstToolError = undefined;
		},
	};
}

export function registerNotifyHandlers(
	pi: ExtensionAPI,
	tracker: NotifyTracker,
): void {
	pi.on("agent_start", async (_event: AgentStartEvent) => {
		tracker.reset();
		cmuxUnavailable = false;
	});

	pi.on("tool_result", async (event: ToolResultEvent) => {
		if (event.isError) {
			if (!tracker.state.firstToolError) {
				const text = event.content
					.map((c) => c.text)
					.filter(Boolean)
					.join(" ")
					.slice(0, 200);
				tracker.state.firstToolError = text || "Tool error";
			}
			return;
		}

		if (isReadToolResult(event)) {
			const target = extractTarget(event.toolName, event.input);
			if (target) tracker.state.readFiles.add(target);
		} else if (isEditToolResult(event) || isWriteToolResult(event)) {
			const target = extractTarget(event.toolName, event.input);
			if (target) tracker.state.changedFiles.add(target);
		} else if (isSearchToolResult(event)) {
			tracker.state.searchCount++;
		} else if (isBashToolResult(event)) {
			tracker.state.bashCount++;
		}
	});

	pi.on("agent_end", async (event: AgentEndEvent) => {
		const status = getAgentEndStatus(event.messages);
		if (status === "error" && !tracker.state.firstToolError) {
			const msg = getErrorMessage(event.messages);
			if (msg) tracker.state.firstToolError = msg;
		}
		const durationMs = Date.now() - tracker.state.startedAt;
		const summary = generateSummary(tracker.state, durationMs, status);
		await safeSendNotification(pi, summary.title, summary.subtitle, summary.body);
	});

	pi.on("input", async (_event: InputEvent) => {
		const thresholdMs = getNumberFromEnv("PI_CMUX_NOTIFY_THRESHOLD_MS", 15000);
		const elapsed = Date.now() - tracker.state.startedAt;
		if (elapsed < thresholdMs) return;
		await safeSendNotification(pi, "Waiting", "Ready for input", "");
	});

	pi.on("session_shutdown", async (_event: SessionShutdownEvent) => {
		tracker.reset();
	});
}
