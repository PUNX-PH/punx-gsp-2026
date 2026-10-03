import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TUNING_FIELDS, tuningProblem } from "@/lib/canvas/tuning";
import type { Tuning } from "@/lib/graph/types";

const FIXTURES = fileURLToPath(new URL("../../../../fixtures/settings/", import.meta.url));
const tuningOf = (file: string): Tuning => JSON.parse(readFileSync(FIXTURES + file, "utf8")).tuning;

describe("TUNING_FIELDS", () => {
  it("describes the three sliders in plain words, with the template's ranges", () => {
    expect(TUNING_FIELDS.map((f) => [f.key, f.label, f.min, f.max, f.unit])).toEqual([
      ["speed", "How fast it runs", 1, 20, "m/s"],
      ["jumpHeight", "How high it jumps", 1.5, 5, "m"],
      ["obstacleSpacing", "How far apart the obstacles are", 4, 40, "m"],
    ]);
    for (const field of TUNING_FIELDS) expect(field.step).toBeGreaterThan(0);
  });
});

describe("tuningProblem", () => {
  it("is null for a playable tuning", () => {
    expect(tuningProblem(tuningOf("valid.json"))).toBeNull();
    expect(tuningProblem(tuningOf("valid-range-max.json"))).toBeNull();
    expect(tuningProblem({ speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 })).toBeNull();
  });

  it("gives the message Play would give, with the field's plain label instead of its technical path", () => {
    const jump = tuningProblem(tuningOf("invalid-unwinnable-jump.json"));
    expect(jump).toMatch(/^How high it jumps: .*too low to jump an obstacle/);
    const spacing = tuningProblem(tuningOf("invalid-unwinnable-spacing.json"));
    expect(spacing).toMatch(/^How far apart the obstacles are: /);
    for (const message of [jump, spacing]) expect(message).not.toContain("settings.tuning");
  });

  it("names the field for a value outside its range", () => {
    expect(tuningProblem({ speed: 0, jumpHeight: 2.2, obstacleSpacing: 12 })).toMatch(/^How fast it runs: /);
    expect(tuningProblem({ speed: 6, jumpHeight: 9, obstacleSpacing: 12 })).toMatch(/^How high it jumps: /);
  });

  it("does not throw for a value that is not a number", () => {
    expect(tuningProblem({ speed: Number.NaN, jumpHeight: 2.2, obstacleSpacing: 12 })).toMatch(/^How fast it runs: /);
  });
});
