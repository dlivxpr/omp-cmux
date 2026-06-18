import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export interface GitRepoInfo {
	root: string;
	branch: string;
	statusLines: string[];
}

export interface ExecGitResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	error?: string;
}

export async function execGit(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
): Promise<ExecGitResult> {
	try {
		const result = await pi.exec("git", args, {
			timeout: 10000,
			cwd,
		});
		if (result.code === 0) {
			return { ok: true, stdout: result.stdout, stderr: result.stderr };
		}
		return {
			ok: false,
			stdout: result.stdout,
			stderr: result.stderr,
			error: `git exited with code ${result.code}`,
		};
	} catch (err) {
		return {
			ok: false,
			stdout: "",
			stderr: "",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function getGitRepoInfo(
	pi: ExtensionAPI,
	cwd: string,
): Promise<GitRepoInfo | undefined> {
	const topLevel = await execGit(pi, cwd, ["rev-parse", "--show-toplevel"]);
	if (!topLevel.ok) return undefined;

	const root = topLevel.stdout.trim();
	const branchResult = await execGit(pi, root, ["branch", "--show-current"]);
	const branch = branchResult.ok ? branchResult.stdout.trim() : "unknown";

	const statusResult = await execGit(pi, root, [
		"status",
		"--short",
		"--untracked-files=all",
	]);
	const statusLines = statusResult.ok
		? statusResult.stdout.split("\n").filter((l) => l.trim()).slice(0, 20)
		: [];

	return { root, branch, statusLines };
}

export async function branchExists(
	pi: ExtensionAPI,
	repoRoot: string,
	branch: string,
): Promise<boolean> {
	const result = await execGit(pi, repoRoot, [
		"show-ref",
		"--verify",
		"--",
		`refs/heads/${branch}`,
	]);
	return result.ok;
}

export interface WorktreeEntry {
	path: string;
	branch: string;
	commit: string;
}

export function parseWorktreeList(text: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	const lines = text.split("\n");
	let current: Partial<WorktreeEntry> = {};
	for (const line of lines) {
		if (line.startsWith("worktree ")) {
			if (current.path) {
				entries.push(current as WorktreeEntry);
			}
			current = { path: line.slice("worktree ".length) };
		} else if (line.startsWith("HEAD ")) {
			current.commit = line.slice("HEAD ".length);
		} else if (line.startsWith("branch ")) {
			current.branch = line.slice("branch ".length);
		} else if (line === "" && current.path) {
			entries.push(current as WorktreeEntry);
			current = {};
		}
	}
	if (current.path) {
		entries.push(current as WorktreeEntry);
	}
	return entries;
}

function fnv1a32(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function slugifyBranchName(branch: string): string {
	const sanitized = branch
		.replace(/[^a-zA-Z0-9_\-\/]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return `${sanitized || "branch"}-${fnv1a32(branch)}`;
}

export async function resolveWorktreePath(
	pi: ExtensionAPI,
	repoRoot: string,
	branch: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
	// Check if a worktree for this branch already exists
	const listResult = await execGit(pi, repoRoot, ["worktree", "list", "--porcelain"]);
	if (listResult.ok) {
		const entries = parseWorktreeList(listResult.stdout);
		for (const e of entries) {
			const entryBranch = e.branch?.replace(/^refs\/heads\//, "");
			if (entryBranch === branch) {
				return { ok: true, path: e.path };
			}
		}
	}

	const { dirname, basename, join } = await import("node:path");
	const parent = dirname(repoRoot);
	const repoName = basename(repoRoot);
	const slug = slugifyBranchName(branch);
	const worktreeDir = join(parent, `${repoName}-worktrees`, slug);

	// If the path exists but isn't a worktree, return an error
	try {
		const { stat } = await import("node:fs/promises");
		const s = await stat(worktreeDir);
		if (s.isDirectory()) {
			return {
				ok: false,
				error: `Directory ${worktreeDir} already exists but is not a git worktree`,
			};
		}
	} catch {
		// path does not exist, safe to create
	}

	return { ok: true, path: worktreeDir };
}

export async function validateBranchName(
	pi: ExtensionAPI,
	repoRoot: string,
	branch: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const result = await execGit(pi, repoRoot, ["check-ref-format", "--branch", branch]);
	if (!result.ok) {
		return { ok: false, error: `Invalid branch name '${branch}'` };
	}
	return { ok: true };
}

export async function validateCommitRef(
	pi: ExtensionAPI,
	repoRoot: string,
	ref: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const result = await execGit(pi, repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
	if (!result.ok) {
		return { ok: false, error: `Ref '${ref}' does not resolve to a commit` };
	}
	return { ok: true };
}

export async function ensureCreatedBranchWorktree(
	pi: ExtensionAPI,
	repoRoot: string,
	branch: string,
	fromRef?: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
	const branchValidation = await validateBranchName(pi, repoRoot, branch);
	if (!branchValidation.ok) return branchValidation;

	if (fromRef) {
		const refValidation = await validateCommitRef(pi, repoRoot, fromRef);
		if (!refValidation.ok) return refValidation;
	}

	const exists = await branchExists(pi, repoRoot, branch);
	if (exists) {
		return {
			ok: false,
			error: `Branch '${branch}' already exists. Choose a different name.`,
		};
	}

	const pathResult = await resolveWorktreePath(pi, repoRoot, branch);
	if (!pathResult.ok) return pathResult;
	const worktreePath = pathResult.path;

	const args = ["worktree", "add", "-b", branch, worktreePath];
	if (fromRef) {
		args.push(fromRef);
	}
	const result = await execGit(pi, repoRoot, args);
	if (!result.ok) {
		return {
			ok: false,
			error: `Failed to create worktree: ${result.error || result.stderr}`,
		};
	}

	return { ok: true, path: worktreePath };
}
