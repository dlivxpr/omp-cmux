import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
	getGitRepoInfo,
	ensureCreatedBranchWorktree,
} from "./git-core";
import { openCommandInNewSplit, buildPiCommand } from "./cmux";

export interface WorktreeRequest {
	branch: string;
	fromRef?: string;
	note?: string;
}

export interface WorktreeContext {
	sourceCwd: string;
	branch: string;
	modifiedFiles: string[];
	newFiles: string[];
	currentTask?: string;
	note?: string;
}

export function parseWorktreeArgs(args: string): {
	ok: true;
	request: WorktreeRequest;
} | { ok: false; error: string } {
	const parts = args.trim().split(/\s+/);
	let branch: string | undefined;
	let fromRef: string | undefined;
	let noteParts: string[] = [];

	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p === "-c" || p === "--create") {
			branch = parts[++i];
		} else if (p === "-f" || p === "--from") {
			fromRef = parts[++i];
		} else {
			noteParts.push(p);
		}
	}

	if (!branch) {
		return {
			ok: false,
			error: "Usage: /cmcv -c <branch> [--from <ref>] [note]",
		};
	}

	return {
		ok: true,
		request: {
			branch,
			fromRef,
			note: noteParts.join(" ") || undefined,
		},
	};
}

function extractCurrentTask(ctx: ExtensionCommandContext): string | undefined {
	const sm = ctx.sessionManager;
	if (!sm) return undefined;
	try {
		const branch = sm.getBranch();
		if (!Array.isArray(branch)) return undefined;
		// Walk backwards to find the most recent user message that looks like a task
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as Record<string, unknown> | undefined;
			if (!entry) continue;
			const role =
				typeof entry.role === "string"
					? entry.role
					: (entry as { source?: string }).source;
			if (role !== "user") continue;
			const text =
				typeof entry.text === "string"
					? entry.text
					: typeof entry.content === "string"
						? entry.content
						: undefined;
			if (!text) continue;
			const trimmed = text.trim();
			// Skip very short replies and obvious control messages
			if (trimmed.length < 10) continue;
			if (/^(yes|no|ok|sure|thanks|done|cancel|stop)$/i.test(trimmed)) {
				continue;
			}
			return trimmed;
		}
	} catch {
		// sessionManager API may differ at runtime; fail gracefully
	}
	return undefined;
}

export async function buildWorktreeContext(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	note?: string,
): Promise<{ ok: true; context: WorktreeContext } | { ok: false; error: string }> {
	const repoInfo = await getGitRepoInfo(pi, ctx.cwd);
	if (!repoInfo) {
		return { ok: false, error: "Not inside a git repository" };
	}

	const modifiedFiles: string[] = [];
	const newFiles: string[] = [];
	for (const line of repoInfo.statusLines) {
		if (line.length < 3) continue;
		const status = line.slice(0, 2);
		const file = line.slice(3);
		if (status.includes("?")) {
			newFiles.push(file);
		} else {
			modifiedFiles.push(file);
		}
	}

	const currentTask = extractCurrentTask(ctx);

	return {
		ok: true,
		context: {
			sourceCwd: repoInfo.root,
			branch: repoInfo.branch,
			modifiedFiles,
			newFiles,
			currentTask,
			note,
		},
	};
}

export function buildWorktreePrompt(
	context: WorktreeContext,
	branch: string,
	note?: string,
): string {
	const parts: string[] = [
		`Continue the current task in this git worktree for branch ${branch}.`,
		"",
		"Context:",
		`- Source: ${context.sourceCwd}`,
		`- Branch: ${branch}`,
	];

	if (context.modifiedFiles.length) {
		parts.push(`- Modified files: ${context.modifiedFiles.join(", ")}`);
	}
	if (context.newFiles.length) {
		parts.push(`- New files: ${context.newFiles.join(", ")}`);
	}
	if (context.currentTask) {
		parts.push(`- Current task: ${context.currentTask}`);
	}
	if (note || context.note) {
		parts.push(`- Focus: ${note || context.note}`);
	}

	parts.push(
		"",
		"Confirm the branch and repository state, then proceed with the highest-priority next step.",
	);

	return parts.join("\n");
}

export async function openWorktreeSplit(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	direction: "right" | "down",
	request: WorktreeRequest,
): Promise<void> {
	const repoInfo = await getGitRepoInfo(pi, ctx.cwd);
	if (!repoInfo) {
		ctx.ui.notify("Not inside a git repository", "error");
		return;
	}

	const wtResult = await ensureCreatedBranchWorktree(
		pi,
		repoInfo.root,
		request.branch,
		request.fromRef,
	);
	if (!wtResult.ok) {
		ctx.ui.notify(wtResult.error, "error");
		return;
	}

	const ctxResult = await buildWorktreeContext(pi, ctx, request.note);
	if (!ctxResult.ok) {
		ctx.ui.notify(ctxResult.error, "error");
		return;
	}

	const prompt = buildWorktreePrompt(ctxResult.context, request.branch, request.note);
	const cmd = buildPiCommand(wtResult.path, { prompt });
	const result = await openCommandInNewSplit(pi, direction, cmd);
	if (!result.ok) {
		ctx.ui.notify(result.error, "error");
		return;
	}
	ctx.ui.notify(`Opened worktree for branch '${request.branch}'`, "info");
}
