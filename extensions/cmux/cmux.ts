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

export interface CmuxPaneInfo {
	ref?: string;
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
// Command result handling
// ---------------------------------------------------------------------------
type CmuxCommandResult =
	| { ok: true; result: ExecResult }
	| { ok: false; error: string };

function truncateDetail(value: string, max = 200): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max)}...`;
}

function formatCmuxFailure(
	action: string,
	result?: ExecResult,
	caught?: unknown,
): string {
	let detail: string;
	if (caught instanceof Error) {
		detail = caught.message;
	} else if (caught !== undefined) {
		detail = String(caught);
	} else if ((result as { killed?: boolean } | undefined)?.killed) {
		detail = `timed out after ${CMUX_TIMEOUT_MS}ms`;
	} else if (result?.stderr.trim()) {
		detail = result.stderr.trim();
	} else if (result?.stdout.trim()) {
		detail = result.stdout.trim();
	} else if (result && result.code !== 0) {
		detail = `exit code ${result.code}`;
	} else {
		detail = "unknown error";
	}
	return `${action} failed: ${truncateDetail(detail)}`;
}

async function runCmuxCommand(
	pi: ExtensionAPI,
	args: string[],
	action: string,
): Promise<CmuxCommandResult> {
	if (!isCmuxAvailable()) {
		return {
			ok: false,
			error: formatCmuxFailure(
				action,
				undefined,
				new Error("cmux is not available"),
			),
		};
	}
	try {
		const result = await pi.exec("cmux", args, { timeout: CMUX_TIMEOUT_MS });
		if (result.code !== 0) {
			return { ok: false, error: formatCmuxFailure(action, result) };
		}
		return { ok: true, result };
	} catch (err) {
		return { ok: false, error: formatCmuxFailure(action, undefined, err) };
	}
}

// ---------------------------------------------------------------------------
// Surface lifecycle management
// ---------------------------------------------------------------------------

export async function getCallerInfo(
	pi: ExtensionAPI,
): Promise<{ ok: true; info: CallerInfo } | { ok: false; error: string }> {
	const run = await runCmuxCommand(pi, ["--json", "identify"], "Identify cmux caller");
	if (!run.ok) return { ok: false, error: run.error };
	try {
		const parsed = JSON.parse(run.result.stdout);
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
): Promise<{ ok: true; panes: CmuxPaneInfo[] } | { ok: false; error: string }> {
	const run = await runCmuxCommand(
		pi,
		["--json", "list-panes", "--workspace", workspaceRef],
		"List cmux panes",
	);
	if (!run.ok) return { ok: false, error: run.error };
	try {
		const parsed = JSON.parse(run.result.stdout);
		return { ok: true, panes: Array.isArray(parsed.panes) ? parsed.panes : [] };
	} catch {
		return { ok: false, error: "Invalid JSON from cmux list-panes" };
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

const SURFACE_REF_KEYS = [
	"surface_ref",
	"surfaceRef",
	"new_surface_ref",
	"newSurfaceRef",
	"target_surface_ref",
	"targetSurfaceRef",
];

function findSurfaceRef(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findSurfaceRef(item);
			if (found) return found;
		}
		return undefined;
	}
	for (const key of SURFACE_REF_KEYS) {
		if (key in value) {
			const candidate = (value as Record<string, unknown>)[key];
			if (typeof candidate === "string" && candidate.length > 0) {
				return candidate;
			}
		}
	}
	for (const child of Object.values(value)) {
		const found = findSurfaceRef(child);
		if (found) return found;
	}
	return undefined;
}

export function parseSurfaceRefFromJson(stdout: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	return findSurfaceRef(parsed);
}

export function findNewSurfaceRefs(
	previousPanes: CmuxPaneInfo[],
	currentPanes: CmuxPaneInfo[],
): string[] {
	const previousRefs = new Set(collectSurfaceRefs(previousPanes));
	const newRefs: string[] = [];
	for (const ref of collectSurfaceRefs(currentPanes)) {
		if (!previousRefs.has(ref)) newRefs.push(ref);
	}
	return newRefs;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForNewSurface(
	pi: ExtensionAPI,
	workspaceRef: string,
	previousPanes: CmuxPaneInfo[],
): Promise<{ ok: true; surfaceRef: string } | { ok: false; error: string }> {
	for (let i = 0; i < SPLIT_READY_ATTEMPTS; i++) {
		await delay(SPLIT_READY_DELAY_MS);
		const current = await listPanes(pi, workspaceRef);
		if (!current.ok) return { ok: false, error: current.error };
		const newRefs = findNewSurfaceRefs(previousPanes, current.panes);
		if (newRefs.length === 1) return { ok: true, surfaceRef: newRefs[0] };
		if (newRefs.length > 1) {
			return {
				ok: false,
				error:
					"Multiple new cmux surfaces appeared; refusing to choose a target",
			};
		}
	}
	return { ok: false, error: "New surface did not appear in time" };
}

export async function openCommandInNewSplit(
	pi: ExtensionAPI,
	direction: SplitDirection,
	command: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const caller = await getCallerInfo(pi);
	if (!caller.ok) return caller;

	const { workspaceRef, surfaceRef } = caller.info;

	const previousList = await listPanes(pi, workspaceRef);
	if (!previousList.ok) return { ok: false, error: previousList.error };
	const previousPanes = previousList.panes;

	const splitResult = await runCmuxCommand(
		pi,
		["--json", "new-split", direction, "--workspace", workspaceRef, "--surface", surfaceRef],
		"Create cmux split",
	);
	if (!splitResult.ok) return { ok: false, error: splitResult.error };

	let newSurfaceRef = parseSurfaceRefFromJson(splitResult.result.stdout);
	if (!newSurfaceRef) {
		const waitResult = await waitForNewSurface(pi, workspaceRef, previousPanes);
		if (!waitResult.ok) return { ok: false, error: waitResult.error };
		newSurfaceRef = waitResult.surfaceRef;
	}

	await delay(SURFACE_BOOT_DELAY_MS);

	const respawnResult = await runCmuxCommand(
		pi,
		[
			"respawn-pane",
			"--workspace",
			workspaceRef,
			"--surface",
			newSurfaceRef,
			"--command",
			command,
		],
		"Respawn cmux pane",
	);
	if (!respawnResult.ok) {
		const respawnError = respawnResult.error;
		const cleanupResult = await runCmuxCommand(
			pi,
			["close-surface", "--workspace", workspaceRef, "--surface", newSurfaceRef],
			"Cleanup cmux split",
		);
		if (!cleanupResult.ok) {
			return {
				ok: false,
				error: `${respawnError}; cleanup failed: ${cleanupResult.error}`,
			};
		}
		return { ok: false, error: respawnError };
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
