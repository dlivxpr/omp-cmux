	import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
	import { stat } from "node:fs/promises";
	import { resolve } from "node:path";
	
	const MAX_COMPLETIONS = 10;

export function expandHome(value: string): string {
	if (value === "~" || value.startsWith("~/")) {
		const home = process.env.HOME || "/";
		return value === "~" ? home : home + value.slice(1);
	}
	return value;
}

export async function resolveDirectoryCandidate(
	value: string,
	baseDir: string,
): Promise<string | undefined> {
	const expanded = expandHome(value);
	const absolute = resolve(baseDir, expanded);
	try {
		const s = await stat(absolute);
		if (s.isDirectory()) return absolute;
	} catch {
		// not a valid directory
	}
	return undefined;
}


export function splitZoxideQuery(query: string): string[] {
	return query.trim() ? query.trim().split(/\s+/) : [];
}

export async function getZoxideMatches(
	pi: ExtensionAPI,
	prefix: string,
): Promise<string[]> {
	const keywords = splitZoxideQuery(prefix);
	if (keywords.length === 0) return [];
	try {
		const result = await pi.exec(
			"zoxide",
			["query", "-l", ...keywords],
			{ timeout: 5000 },
		);
		if (result.code !== 0) return [];
		return result.stdout
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
			.slice(0, MAX_COMPLETIONS);
	} catch {
		return [];
	}
}

export async function resolveZoxideTarget(
	pi: ExtensionAPI,
	query: string,
	baseDir: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
	// 1. Try as a direct directory path first
	const direct = await resolveDirectoryCandidate(query, baseDir);
	if (direct) return { ok: true, path: direct };

	// 2. Try zoxide query
	const keywords = splitZoxideQuery(query);
	if (keywords.length === 0) {
		return { ok: false, error: `Could not resolve path: ${query}` };
	}
	try {
		const result = await pi.exec("zoxide", ["query", ...keywords], {
			timeout: 5000,
		});
		if (result.code === 0) {
			const candidate = result.stdout.trim();
			if (!candidate) {
				return { ok: false, error: `Could not resolve path: ${query}` };
			}
			const path = await resolveDirectoryCandidate(candidate, baseDir);
			if (path) return { ok: true, path };
			return {
				ok: false,
				error: `Resolved zoxide path is not a directory: ${candidate}`,
			};
		}
	} catch {
		// zoxide failed
	}

	return { ok: false, error: `Could not resolve path: ${query}` };
}

