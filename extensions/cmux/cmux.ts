import type { ExtensionAPI, ExecResult } from "@oh-my-pi/pi-coding-agent";

export function isCmuxAvailable(): boolean {
	return !!process.env.CMUX_SOCKET_PATH;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CMUX_TIMEOUT_MS = 5000;
const SPLIT_READY_ATTEMPTS = 20;
const SPLIT_READY_DELAY_MS = 150;
const SURFACE_BOOT_DELAY_MS = 250;

export type SplitDirection = "right" | "down";

interface CallerInfo {
	workspaceRef: string;
	surfaceRef: string;
}

interface CmuxPaneInfo {
	ref: string;
	surface_ref?: string;
	surfaces?: CmuxPaneInfo[];
}

// ---------------------------------------------------------------------------
// Low-level cmux helper (fire-and-forget for simple calls like notify)
// ---------------------------------------------------------------------------
export async function cmux(
	pi: ExtensionAPI,
	...args: string[]
): Promise<ExecResult | undefined> {
	if (!isCmuxAvailable()) return undefined;
	try {
		return await pi.exec("cmux", args, { timeout: CMUX_TIMEOUT_MS });
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Surface lifecycle management
// ---------------------------------------------------------------------------

export async function getCallerInfo(
	pi: ExtensionAPI,
): Promise<{ ok: true; info: CallerInfo } | { ok: false; error: string }> {
	if (!isCmuxAvailable()) {
		return { ok: false, error: "cmux is not available" };
	}
	const result = await pi.exec(
		"cmux",
		["--json", "identify"],
		{ timeout: CMUX_TIMEOUT_MS },
	);
	if (result.code !== 0) {
		return { ok: false, error: "Failed to identify cmux caller" };
	}
	try {
		const parsed = JSON.parse(result.stdout);
		const workspaceRef = parsed.caller?.workspace_ref as string | undefined;
		const surfaceRef = parsed.caller?.surface_ref as string | undefined;
		if (!workspaceRef || !surfaceRef) {
			return {
				ok: false,
				error: "This command must be run from inside a cmux surface",
			};
		}
		return { ok: true, info: { workspaceRef, surfaceRef } };
	} catch {
		return { ok: false, error: "Invalid JSON from cmux identify" };
	}
}

export async function listPanes(
	pi: ExtensionAPI,
	workspaceRef: string,
): Promise<CmuxPaneInfo[]> {
	const result = await pi.exec(
		"cmux",
		["--json", "list-panes", "--workspace", workspaceRef],
		{ timeout: CMUX_TIMEOUT_MS },
	);
	if (result.code !== 0) return [];
	try {
		const parsed = JSON.parse(result.stdout);
		return Array.isArray(parsed.panes) ? parsed.panes : [];
	} catch {
		return [];
	}
}

function collectSurfaceRefs(panes: CmuxPaneInfo[]): string[] {
	const refs: string[] = [];
	for (const p of panes) {
		if (p.surface_ref) refs.push(p.surface_ref);
		if (p.surfaces) refs.push(...collectSurfaceRefs(p.surfaces));
	}
	return refs;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForNewSurface(
	pi: ExtensionAPI,
	workspaceRef: string,
	previousPanes: CmuxPaneInfo[],
): Promise<string | undefined> {
	const previousRefs = new Set(collectSurfaceRefs(previousPanes));
	for (let i = 0; i < SPLIT_READY_ATTEMPTS; i++) {
		await delay(SPLIT_READY_DELAY_MS);
		const current = await listPanes(pi, workspaceRef);
		const currentRefs = collectSurfaceRefs(current);
		for (const ref of currentRefs) {
			if (!previousRefs.has(ref)) return ref;
		}
	}
	return undefined;
}

export async function openCommandInNewSplit(
	pi: ExtensionAPI,
	direction: SplitDirection,
	command: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const caller = await getCallerInfo(pi);
	if (!caller.ok) return caller;

	const { workspaceRef, surfaceRef } = caller.info;

	const previousPanes = await listPanes(pi, workspaceRef);

	const splitResult = await pi.exec("cmux", [
		"new-split",
		direction,
		"--workspace",
		workspaceRef,
		"--surface",
		surfaceRef,
	]);
	if (splitResult.code !== 0) {
		return { ok: false, error: "Failed to create new split" };
	}

	const newSurfaceRef = await waitForNewSurface(pi, workspaceRef, previousPanes);
	if (!newSurfaceRef) {
		return { ok: false, error: "New surface did not appear in time" };
	}

	await delay(SURFACE_BOOT_DELAY_MS);

	const respawnResult = await pi.exec("cmux", [
		"respawn-pane",
		"--workspace",
		workspaceRef,
		"--surface",
		newSurfaceRef,
		"--command",
		command,
	]);
	if (respawnResult.code !== 0) {
		return { ok: false, error: "Failed to respawn pane with command" };
	}

	return { ok: true };
}

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use inside a single-quoted shell word.
 * Replaces every `'` with `'\''` (close quote, literal quote, reopen quote).
 */
export function shellEscape(str: string): string {
	return `'${str.replace(/'/g, "'\\''")}'`;
}

export function buildPiCommand(
	cwd: string,
	options?: { prompt?: string },
): string {
	const cd = `cd ${shellEscape(cwd)}`;
	const cwdArg = shellEscape(cwd);
	let cmd = `${cd} && exec omp --cwd ${cwdArg}`;
	if (options?.prompt) {
		cmd += ` -p ${shellEscape(options.prompt)}`;
	}
	return cmd;
}

export function buildShellCommand(
	cwd: string,
	command: string,
): string {
	return `cd ${shellEscape(cwd)} && exec sh -lc ${shellEscape(command)}`;
}
