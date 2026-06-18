import { describe, expect, it } from "bun:test";
import {
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
});
