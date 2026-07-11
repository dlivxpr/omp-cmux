import { afterEach, describe, expect, it } from "bun:test";
import { getNumberFromEnv } from "./config";

const ENV_KEY = "PI_CMUX_TEST_NUMBER";
const originalValue = process.env[ENV_KEY];

afterEach(() => {
	if (originalValue === undefined) delete process.env[ENV_KEY];
	else process.env[ENV_KEY] = originalValue;
});

describe("getNumberFromEnv", () => {
	for (const [raw, label] of [
		[undefined, "undefined"],
		["", "empty"],
		["   ", "whitespace"],
		["-1", "negative"],
		["-Infinity", "negative infinity"],
		["Infinity", "infinity"],
		["NaN", "NaN"],
		["nope", "non-numeric"],
	] as const) {
		it(`falls back for ${label}`, () => {
			if (raw === undefined) delete process.env[ENV_KEY];
			else process.env[ENV_KEY] = raw;

			expect(getNumberFromEnv(ENV_KEY, 42)).toBe(42);
		});
	}

	for (const [raw, expected] of [
		["0", 0],
		[" 15 ", 15],
		["1.5", 1.5],
		["1e3", 1000],
	] as const) {
		it(`accepts ${JSON.stringify(raw)}`, () => {
			process.env[ENV_KEY] = raw;

			expect(getNumberFromEnv(ENV_KEY, 42)).toBe(expected);
		});
	}
});
