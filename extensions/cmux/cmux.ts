import type { ExtensionAPI, ExecResult } from "@oh-my-pi/pi-coding-agent";
import { existsSync } from "node:fs";

export type CmuxEnv = Record<string, string | undefined>;
export type ExistsFn = (path: string) => boolean;

const DEFAULT_CMUX_SOCKET_PATH = "/tmp/cmux.sock";

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function hasOwnCmuxKey(env: CmuxEnv): boolean {
	return Object.keys(env).some((key) => key.startsWith("CMUX_"));
}

function getWorkspaceRefFromEnv(env: CmuxEnv = process.env): string | undefined {
	return nonEmpty(env.CMUX_WORKSPACE_ID) ?? nonEmpty(env.CMUX_TAB_ID);
}

function getSurfaceRefFromEnv(env: CmuxEnv = process.env): string | undefined {
	return nonEmpty(env.CMUX_SURFACE_ID) ?? nonEmpty(env.CMUX_PANEL_ID);
}

function shouldRefreshTmuxEnv(env: CmuxEnv = process.env): boolean {
	return nonEmpty(env.TMUX) !== undefined;
}

export function resolveCmuxCli(
	env: CmuxEnv = process.env,
	exists: ExistsFn = existsSync,
): string {
	const bundled = nonEmpty(env.CMUX_BUNDLED_CLI_PATH);
	if (bundled && exists(bundled)) return bundled;
	return "cmux";
}

export function parseTmuxEnvironmentOutput(output: string): CmuxEnv {
	const env: CmuxEnv = {};

	for (const line of output.split(/\r?\n/)) {
		if (line.startsWith("-")) {
			const key = line.slice(1);
			if (key.startsWith("CMUX_")) env[key] = undefined;
			continue;
		}

		const equalsIndex = line.indexOf("=");
		if (equalsIndex <= 0) continue;

		const key = line.slice(0, equalsIndex);
		if (key.startsWith("CMUX_")) env[key] = line.slice(equalsIndex + 1);
	}

	return env;
}

async function readTmuxEnvironment(
	pi: ExtensionAPI,
	args: string[],
): Promise<CmuxEnv | undefined> {
	try {
		const result = await pi.exec("tmux", args, { timeout: CMUX_TIMEOUT_MS });
		if (result.code !== 0 || result.killed) return undefined;
		return parseTmuxEnvironmentOutput(result.stdout);
	} catch {
		return undefined;
	}
}

async function getTmuxCmuxEnv(
	pi: ExtensionAPI,
	env: CmuxEnv = process.env,
): Promise<CmuxEnv> {
	if (!nonEmpty(env.TMUX)) return {};

	const [globalEnv, sessionEnv] = await Promise.all([
		readTmuxEnvironment(pi, ["show-environment", "-g"]),
		readTmuxEnvironment(pi, ["show-environment"]),
	]);
	if (!globalEnv && !sessionEnv) return {};
	if (!hasOwnCmuxKey(globalEnv ?? {}) && !hasOwnCmuxKey(sessionEnv ?? {})) {
		return {};
	}

	const refreshedEnv: CmuxEnv = { ...globalEnv, ...sessionEnv };
	if (globalEnv && sessionEnv) {
		for (const key of Object.keys(env)) {
			if (key.startsWith("CMUX_") && !Object.prototype.hasOwnProperty.call(refreshedEnv, key)) {
				refreshedEnv[key] = undefined;
			}
		}
	}

	return refreshedEnv;
}

async function resolveRuntimeCmuxEnv(
	pi: ExtensionAPI,
	env: CmuxEnv = process.env,
): Promise<CmuxEnv> {
	return { ...env, ...(await getTmuxCmuxEnv(pi, env)) };
}

export interface CmuxExecCommand {
	command: string;
	argsPrefix: string[];
}

export function buildCmuxExecCommand(
	env: CmuxEnv = process.env,
	exists: ExistsFn = existsSync,
	baseEnv: CmuxEnv = process.env,
): CmuxExecCommand {
	const cli = resolveCmuxCli(env, exists);
	const overrideKeys = new Set(
		[...Object.keys(baseEnv), ...Object.keys(env)].filter((key) =>
			key.startsWith("CMUX_"),
		),
	);
	const argsPrefix: string[] = [];

	for (const key of [...overrideKeys].sort()) {
		const value = env[key];
		if (value === baseEnv[key]) continue;
		if (value === undefined) {
			argsPrefix.push("-u", key);
		} else {
			argsPrefix.push(`${key}=${value}`);
		}
	}

	if (argsPrefix.length === 0) return { command: cli, argsPrefix };
	return { command: "env", argsPrefix: [...argsPrefix, cli] };
}

export function isCmuxAvailable(
	env: CmuxEnv = process.env,
	exists: ExistsFn = existsSync,
): boolean {
	if (getWorkspaceRefFromEnv(env)) return true;
	if (nonEmpty(env.CMUX_SOCKET_PATH)) return true;
	return exists(DEFAULT_CMUX_SOCKET_PATH);
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
	selected_surface_ref?: string;
	surface_refs?: string[];
	surfaces?: CmuxPaneInfo[];
}

// ---------------------------------------------------------------------------
// Low-level cmux helper (fire-and-forget for simple calls like notify)
// ---------------------------------------------------------------------------
export async function cmux(
	pi: ExtensionAPI,
	...args: string[]
): Promise<ExecResult | undefined> {
	try {
		const env = shouldRefreshTmuxEnv()
			? await resolveRuntimeCmuxEnv(pi)
			: process.env;
		if (!isCmuxAvailable(env)) return undefined;
		const invocation = buildCmuxExecCommand(env);
		return await pi.exec(invocation.command, [...invocation.argsPrefix, ...args], {
			timeout: CMUX_TIMEOUT_MS,
		});
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
	const env = shouldRefreshTmuxEnv()
		? await resolveRuntimeCmuxEnv(pi)
		: process.env;
	if (!isCmuxAvailable(env)) {
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
		const invocation = buildCmuxExecCommand(env);
		const result = await pi.exec(
			invocation.command,
			[...invocation.argsPrefix, ...args],
			{ timeout: CMUX_TIMEOUT_MS },
		);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function surfaceListEntries(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (!isRecord(value)) return [];

	for (const key of ["surfaces", "data", "items"]) {
		const entries = value[key];
		if (Array.isArray(entries)) return entries;
	}

	return [];
}

function surfaceEntryRef(value: Record<string, unknown>): string | undefined {
	for (const key of ["id", "ref", "surface_ref", "surfaceRef"]) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate;
	}
	return undefined;
}

export function pickBestSurfaceRef(surfaceList: unknown): string | undefined {
	const surfaces = surfaceListEntries(surfaceList)
		.filter(isRecord)
		.map((surface) => ({
			ref: surfaceEntryRef(surface),
			focused: surface.focused,
			selected: surface.selected,
		}))
		.filter((surface): surface is {
			ref: string;
			focused: unknown;
			selected: unknown;
		} => surface.ref !== undefined);

	return (
		surfaces.find((surface) => surface.focused === true)?.ref ??
		surfaces.find((surface) => surface.selected === true)?.ref ??
		surfaces[0]?.ref
	);
}

export function parseSurfaceListOutput(stdout: string): string | undefined {
	try {
		return pickBestSurfaceRef(JSON.parse(stdout));
	} catch {
		return undefined;
	}
}

async function resolveSurfaceRefFromWorkspace(
	pi: ExtensionAPI,
	workspaceRef: string,
): Promise<string | undefined> {
	const run = await runCmuxCommand(
		pi,
		["rpc", "surface.list", JSON.stringify({ workspace_id: workspaceRef })],
		"Resolve cmux surface",
	);
	if (!run.ok) return undefined;
	return parseSurfaceListOutput(run.result.stdout);
}

async function getCallerInfoFromEnv(
	pi: ExtensionAPI,
	env: CmuxEnv,
): Promise<{ ok: true; info: CallerInfo } | undefined> {
	const workspaceRef = getWorkspaceRefFromEnv(env);
	if (!workspaceRef) return undefined;
	const surfaceRef =
		getSurfaceRefFromEnv(env) ??
		(await resolveSurfaceRefFromWorkspace(pi, workspaceRef));
	if (!surfaceRef) return undefined;
	return { ok: true, info: { workspaceRef, surfaceRef } };
}

export async function getCallerInfo(
	pi: ExtensionAPI,
): Promise<{ ok: true; info: CallerInfo } | { ok: false; error: string }> {
	const runtimeEnv = await resolveRuntimeCmuxEnv(pi);
	const envCaller = await getCallerInfoFromEnv(pi, runtimeEnv);
	const run = await runCmuxCommand(pi, ["--json", "identify"], "Identify cmux caller");
	if (!run.ok) return envCaller ?? { ok: false, error: run.error };
	try {
		const parsed = JSON.parse(run.result.stdout);
		const workspaceRef = parsed.caller?.workspace_ref as string | undefined;
		const surfaceRef = parsed.caller?.surface_ref as string | undefined;
		if (!workspaceRef || !surfaceRef) {
			return (
				envCaller ?? {
					ok: false,
					error: "This command must be run from inside a cmux surface",
				}
			);
		}
		return { ok: true, info: { workspaceRef, surfaceRef } };
	} catch {
		return envCaller ?? { ok: false, error: "Invalid JSON from cmux identify" };
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
		if (p.selected_surface_ref) refs.push(p.selected_surface_ref);
		if (p.surface_refs) {
			refs.push(
				...p.surface_refs.filter(
					(ref): ref is string => typeof ref === "string" && ref.length > 0,
				),
			);
		}
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
		if (!previousRefs.has(ref)) {
			newRefs.push(ref);
			previousRefs.add(ref);
		}
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
		cmd += ` ${shellEscape(options.prompt)}`;
	}
	return cmd;
}

export function buildShellCommand(
	cwd: string,
	command: string,
): string {
	return `cd ${shellEscape(cwd)} && exec sh -lc ${shellEscape(command)}`;
}
