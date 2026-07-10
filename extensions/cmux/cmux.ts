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
