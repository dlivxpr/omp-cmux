import { describe, expect, it } from "bun:test";
import {
	buildPiCommand,
	findNewSurfaceRefs,
	parseSurfaceRefFromJson,
} from "./cmux";

describe("parseSurfaceRefFromJson", () => {
	it("extracts surface_ref", () => {
		expect(parseSurfaceRefFromJson('{"surface_ref":"surface:2"}')).toBe(
			"surface:2",
		);
	});

	it("extracts surfaceRef", () => {
		expect(parseSurfaceRefFromJson('{"surfaceRef":"surface:3"}')).toBe(
			"surface:3",
		);
	});

	it("extracts nested new_surface_ref", () => {
		expect(
			parseSurfaceRefFromJson('{"created":{"new_surface_ref":"surface:4"}}'),
		).toBe("surface:4");
	});
});

describe("findNewSurfaceRefs", () => {
	it("returns a single new ref", () => {
		expect(
			findNewSurfaceRefs(
				[{ surface_ref: "surface:1" }],
				[{ surface_ref: "surface:1" }, { surface_ref: "surface:2" }],
			),
		).toEqual(["surface:2"]);
	});

	it("returns multiple new refs for caller rejection", () => {
		expect(
			findNewSurfaceRefs(
				[{ surface_ref: "surface:1" }],
				[
					{ surface_ref: "surface:1" },
					{ surface_ref: "surface:2" },
					{ surface_ref: "surface:3" },
				],
			),
		).toEqual(["surface:2", "surface:3"]);
	});

	it("detects new refs from current list-panes surface_refs shape", () => {
		expect(
			findNewSurfaceRefs(
				[{ surface_refs: ["surface:1"], selected_surface_ref: "surface:1" }],
				[
					{
						surface_refs: ["surface:1", "surface:2"],
						selected_surface_ref: "surface:2",
					},
				],
			),
		).toEqual(["surface:2"]);
	});
});

describe("buildPiCommand", () => {
	it("starts an interactive omp session without a prompt", () => {
		const command = buildPiCommand("/tmp/project");

		expect(command).not.toContain(" -p ");
		expect(command).toContain("exec omp --cwd '/tmp/project'");
	});

	it("passes the initial prompt as an interactive positional argument", () => {
		const command = buildPiCommand("/tmp/project", { prompt: "hello world" });

		expect(command).not.toContain(" -p ");
		expect(command.endsWith(" 'hello world'")).toBe(true);
	});
});
