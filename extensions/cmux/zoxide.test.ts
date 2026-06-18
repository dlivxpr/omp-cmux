import { describe, expect, it } from "bun:test";
import { splitZoxideQuery } from "./zoxide";

describe("splitZoxideQuery", () => {
	it("splits a multi-word query into keywords", () => {
		expect(splitZoxideQuery("foo bar")).toEqual(["foo", "bar"]);
	});

	it("trims and collapses extra whitespace", () => {
		expect(splitZoxideQuery("  foo   bar  ")).toEqual(["foo", "bar"]);
	});

	it("returns an empty array for an empty query", () => {
		expect(splitZoxideQuery("")).toEqual([]);
	});
});
