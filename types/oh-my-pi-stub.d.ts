// Minimal type declarations for the oh-my-pi ExtensionAPI surface.
// This extension is loaded at runtime by the oh-my-pi harness; these stubs
// let us compile against the real API shape without bundling the full SDK.

declare module "@oh-my-pi/pi-coding-agent" {
	// -------------------------------------------------------------------------
	// Re-exported core types (we reference them but do not need full definitions)
	// -------------------------------------------------------------------------
	export type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
	export type { Model } from "@oh-my-pi/pi-ai";

	// -------------------------------------------------------------------------
	// Usage (mirrors pi-ai Usage interface)
	// -------------------------------------------------------------------------
	export interface Usage {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			total: number;
		};
	}

	// AgentMessage (sufficient for narrowing)
	export interface AssistantMessage {
		role: "assistant";
		usage?: Usage;
		stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
		errorMessage?: string;
	}

	export type AgentMessage =
		| AssistantMessage
		| { role: string };


	// -------------------------------------------------------------------------
	// UI & Context
	// -------------------------------------------------------------------------
	export interface ExtensionUIContext {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		setStatus(key: string, text: string | undefined): void;
	}

	export interface ContextUsage {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	}

	export interface SessionManagerLike {
		getBranch(): unknown[];
		getSessionName(): string | undefined;
	}

	export interface ExtensionContext {
		cwd: string;
		ui: ExtensionUIContext;
		model: Model | undefined;
		getContextUsage(): ContextUsage | undefined;
		hasUI: boolean;
		/** Runtime session state manager (present at runtime, optional in stub). */
		sessionManager?: SessionManagerLike;
	}

	export interface ExtensionCommandContext extends ExtensionContext {
		waitForIdle(): Promise<void>;
		newSession(options?: {
			parentSession?: string;
			setup?: (sessionManager: unknown) => Promise<void>;
		}): Promise<{ cancelled: boolean }>;
		branch(entryId: string): Promise<{ cancelled: boolean }>;
		reload(): Promise<void>;
	}

	// -------------------------------------------------------------------------
	// Events
	// -------------------------------------------------------------------------
	export interface SessionStartEvent {
		type: "session_start";
	}

	export interface AgentStartEvent {
		type: "agent_start";
	}

	export interface BeforeAgentStartEvent {
		type: "before_agent_start";
	}

	export interface AgentEndEvent {
		type: "agent_end";
		messages: AgentMessage[];
	}

	export interface TurnEndEvent {
		type: "turn_end";
		turnIndex: number;
		message: AgentMessage;
		toolResults: unknown[];
	}

	export interface ToolExecutionStartEvent {
		type: "tool_execution_start";
		toolCallId: string;
		toolName: string;
		args: unknown;
		intent?: string;
	}

	export interface ToolExecutionEndEvent {
		type: "tool_execution_end";
		toolCallId: string;
		toolName: string;
		result: unknown;
		isError: boolean;
	}

	export interface ToolCallEvent {
		type: "tool_call";
		toolCallId: string;
		toolName: string;
		input: Record<string, unknown>;
	}

	export interface ToolResultEvent {
		type: "tool_result";
		toolCallId: string;
		toolName: string;
		input: Record<string, unknown>;
		content: Array<{ type?: string; text?: string }>;
		isError: boolean;
	}

	export interface InputEvent {
		type: "input";
		text: string;
		source: "interactive" | "rpc" | "extension";
	}

	export interface SessionShutdownEvent {
		type: "session_shutdown";
	}

	// -------------------------------------------------------------------------
	// Event handler & results
	// -------------------------------------------------------------------------
	export interface ToolCallEventResult {
		block?: boolean;
		reason?: string;
	}

	export type ExtensionHandler<E, R = undefined> = (
		event: E,
		ctx: ExtensionContext,
	) => Promise<R | void> | R | void;

	// -------------------------------------------------------------------------
	// Exec
	// -------------------------------------------------------------------------
	export interface ExecOptions {
		timeout?: number;
		signal?: AbortSignal;
		cwd?: string;
	}

	export interface ExecResult {
		stdout: string;
		stderr: string;
		exitCode: number;
	}

	// -------------------------------------------------------------------------
	// Command registration
	// -------------------------------------------------------------------------
	export interface RegisteredCommand {
		description?: string;
		getArgumentCompletions?: (argumentPrefix: string) => unknown[] | null | Promise<unknown[] | null>;
		handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	}

	// -------------------------------------------------------------------------
	// ExtensionAPI
	// -------------------------------------------------------------------------
	export interface ExtensionAPI {
		setLabel(entryIdOrLabel: string, label?: string): void;
		/** Register event handlers. Event name must be a valid omp event string
		 *  (session_start, agent_start, agent_end, turn_end, tool_execution_start,
		 *  tool_execution_end, tool_call, tool_result, input, session_shutdown, etc.).
		 *  Invalid event names are silently ignored at runtime — no error is raised. */
		on<E, R>(event: string, handler: ExtensionHandler<E, R>): void;
		registerCommand(
			name: string,
			options: {
				description?: string;
				getArgumentCompletions?: RegisteredCommand["getArgumentCompletions"];
				handler: RegisteredCommand["handler"];
			},
		): void;
		registerTool(options: unknown): void;
		registerProvider(name: string, config: unknown): void;
		exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
		getThinkingLevel(): ThinkingLevel | undefined;
		sendMessage<T = unknown>(
			message: { customType: string; content: string; display?: boolean; details?: unknown; attribution?: unknown },
			options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
		): void;
		sendUserMessage(
			content: string | Array<{ type: string; text?: string; source?: unknown }>,
			options?: { deliverAs?: "steer" | "followUp" },
		): void;
		appendEntry(customType: string, data?: unknown): void;
		logger: {
			debug(message: string, ...args: unknown[]): void;
			info(message: string, ...args: unknown[]): void;
			warn(message: string, ...args: unknown[]): void;
			error(message: string, ...args: unknown[]): void;
		};
		zod: unknown;
	}

	export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
}
