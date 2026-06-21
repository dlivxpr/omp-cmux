import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
	openCommandInNewSplit,
	buildPiCommand,
	buildShellCommand,
} from "./cmux";
import { resolveZoxideTarget, getZoxideMatches } from "./zoxide";
import { parseWorktreeArgs, openWorktreeSplit } from "./worktree";

type RegisterCommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];
type RuntimeCompletionItem = { value: string; label: string };
type AsyncArgumentCompletions = (
	prefix: string,
) => Promise<RuntimeCompletionItem[] | null>;
type RuntimeCommandOptions = Omit<
	RegisterCommandOptions,
	"getArgumentCompletions"
> & {
	getArgumentCompletions?: AsyncArgumentCompletions;
};

// omp 16.0.2 ExtensionAPI types mark getArgumentCompletions as synchronous,
// but the TUI SlashCommand runtime accepts Awaitable completions. Keep the
// async zoxide query behind this helper so the contract mismatch is localized.
function withRuntimeCompletions(
	options: RuntimeCommandOptions,
): RegisterCommandOptions {
	return options as unknown as RegisterCommandOptions;
}

function zoxideCompletions(pi: ExtensionAPI): AsyncArgumentCompletions {
	return async (prefix: string) => {
		const matches = await getZoxideMatches(pi, prefix);
		if (matches.length === 0) return null;
		return matches.map((m) => ({ value: m, label: m }));
	};
}

export function registerCommands(pi: ExtensionAPI): void {
	pi.registerCommand("cmv", {
		description: "Open new pi session in right split",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const prompt = args.trim();
			const cmd = buildPiCommand(ctx.cwd, prompt ? { prompt } : undefined);
			const result = await openCommandInNewSplit(pi, "right", cmd);
			if (!result.ok) ctx.ui.notify(result.error, "error");
		},
	});

	pi.registerCommand("cmh", {
		description: "Open new pi session in bottom split",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const prompt = args.trim();
			const cmd = buildPiCommand(ctx.cwd, prompt ? { prompt } : undefined);
			const result = await openCommandInNewSplit(pi, "down", cmd);
			if (!result.ok) ctx.ui.notify(result.error, "error");
		},
	});

	pi.registerCommand("cmo", {
		description: "Run shell command in right split",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /cmo <command...>", "warning");
				return;
			}
			const cmd = buildShellCommand(ctx.cwd, args.trim());
			const result = await openCommandInNewSplit(pi, "right", cmd);
			if (!result.ok) ctx.ui.notify(result.error, "error");
		},
	});

	pi.registerCommand("cmoh", {
		description: "Run shell command in bottom split",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /cmoh <command...>", "warning");
				return;
			}
			const cmd = buildShellCommand(ctx.cwd, args.trim());
			const result = await openCommandInNewSplit(pi, "down", cmd);
			if (!result.ok) ctx.ui.notify(result.error, "error");
		},
	});

	pi.registerCommand("cmz", withRuntimeCompletions({
		description: "Open pi session in zoxide directory (right split)",
		getArgumentCompletions: zoxideCompletions(pi),
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /cmz <query>", "warning");
				return;
			}
			const resolved = await resolveZoxideTarget(pi, args.trim(), ctx.cwd);
			if (!resolved.ok) {
				ctx.ui.notify(resolved.error, "error");
				return;
			}
			const cmd = buildPiCommand(resolved.path);
			const result = await openCommandInNewSplit(pi, "right", cmd);
			if (!result.ok) ctx.ui.notify(result.error, "error");
		},
	}));

	pi.registerCommand("cmzh", withRuntimeCompletions({
		description: "Open pi session in zoxide directory (bottom split)",
		getArgumentCompletions: zoxideCompletions(pi),
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /cmzh <query>", "warning");
				return;
			}
			const resolved = await resolveZoxideTarget(pi, args.trim(), ctx.cwd);
			if (!resolved.ok) {
				ctx.ui.notify(resolved.error, "error");
				return;
			}
			const cmd = buildPiCommand(resolved.path);
			const result = await openCommandInNewSplit(pi, "down", cmd);
			if (!result.ok) ctx.ui.notify(result.error, "error");
		},
	}));

	// Aliases
	pi.registerCommand("z", withRuntimeCompletions({
		description: "Alias for /cmz",
		getArgumentCompletions: zoxideCompletions(pi),
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /z <query>", "warning");
				return;
			}
			const resolved = await resolveZoxideTarget(pi, args.trim(), ctx.cwd);
			if (!resolved.ok) {
				ctx.ui.notify(resolved.error, "error");
				return;
			}
			const cmd = buildPiCommand(resolved.path);
			const result = await openCommandInNewSplit(pi, "right", cmd);
			if (!result.ok) ctx.ui.notify(result.error, "error");
		},
	}));

	pi.registerCommand("zh", withRuntimeCompletions({
		description: "Alias for /cmzh",
		getArgumentCompletions: zoxideCompletions(pi),
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /zh <query>", "warning");
				return;
			}
			const resolved = await resolveZoxideTarget(pi, args.trim(), ctx.cwd);
			if (!resolved.ok) {
				ctx.ui.notify(resolved.error, "error");
				return;
			}
			const cmd = buildPiCommand(resolved.path);
			const result = await openCommandInNewSplit(pi, "down", cmd);
			if (!result.ok) ctx.ui.notify(result.error, "error");
		},
	}));

	// Worktree commands
	pi.registerCommand("cmcv", {
		description: "Create a git worktree branch and open it in a right split",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parsed = parseWorktreeArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "warning");
				return;
			}
			await openWorktreeSplit(pi, ctx, "right", parsed.request);
		},
	});

	pi.registerCommand("cmch", {
		description: "Create a git worktree branch and open it in a bottom split",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parsed = parseWorktreeArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "warning");
				return;
			}
			await openWorktreeSplit(pi, ctx, "down", parsed.request);
		},
	});
}
