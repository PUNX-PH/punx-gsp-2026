// The catalog entry of the Build Model step: what it takes and gives, and which settings are well formed.
import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_CHARACTERS, MAX_MOTION_CHARACTERS, NODE_SPECS } from "@/lib/graph/registry";

const spec = NODE_SPECS["build-model"];
const params = (change: Record<string, unknown> = {}) => ({ ...spec.defaultParams(), ...change });

describe("Build Model", () => {
  it("is a catalog step with its plain name and help, and is not the final step", () => {
    expect(spec).toMatchObject({
      type: "build-model",
      label: "Build Model",
      help: "Builds a moving model from your words: a hero, an obstacle or a collectible.",
      final: false,
    });
    expect(MAX_DESCRIPTION_CHARACTERS).toBe(300);
    expect(MAX_MOTION_CHARACTERS).toBe(200);
  });

  it("takes an optional palette and an optional picture, and gives a model", () => {
    expect(spec.inputs.map((p) => [p.name, p.type, p.required])).toEqual([
      ["palette", "palette", false],
      ["image", "image", false],
    ]);
    expect(spec.inputs[0]).toMatchObject({ label: "palette", help: "Colors to paint the model with. Without one, a sample palette is used." });
    expect(spec.inputs[1]).toMatchObject({ label: "picture", help: "A picture to take the look from. Optional." });
    expect(spec.outputs.map((p) => [p.name, p.label, p.type, p.help])).toEqual([["model", "3D model", "model", "The model, with its motions."]]);
  });

  it("starts as a hero of any kind with every box empty", () => {
    expect(spec.defaultParams()).toEqual({ role: "hero", kind: "auto", description: "", run: "", jump: "", loop: "" });
    expect(spec.shapeProblem(spec.defaultParams())).toBeNull();
  });

  it.each([["hero"], ["obstacle"], ["collectible"]])("accepts the role %s", (role) => {
    expect(spec.shapeProblem(params({ role }))).toBeNull();
  });

  it.each([["Hero"], ["villain"], [""], [1], [null], [undefined]])("refuses the role %s", (role) => {
    expect(spec.shapeProblem(params({ role }))).toBe("role must be hero, obstacle or collectible.");
  });

  it.each([["auto"], ["biped"], ["vehicle"], ["blob"], ["prop"]])("accepts the kind %s", (kind) => {
    expect(spec.shapeProblem(params({ kind }))).toBeNull();
  });

  it.each([["dragon"], ["Auto"], ["scenery"], [""], [3], [null], [undefined]])("refuses the kind %s", (kind) => {
    expect(spec.shapeProblem(params({ kind }))).toBe("kind must be auto, biped, vehicle, blob or prop.");
  });

  it("refuses a description that is not text, or is too long, counting characters (not bytes)", () => {
    for (const description of [5, null, undefined, ["a"]]) expect(spec.shapeProblem(params({ description }))).toBe("description must be text.");
    expect(spec.shapeProblem(params({ description: "👻".repeat(300) }))).toBeNull();
    expect(spec.shapeProblem(params({ description: "a".repeat(300) }))).toBeNull();
    expect(spec.shapeProblem(params({ description: "a".repeat(301) }))).toBe("the description is longer than 300 characters.");
    expect(spec.shapeProblem(params({ description: "👻".repeat(301) }))).toBe("the description is longer than 300 characters.");
  });

  it.each([["run", "Run"], ["jump", "Jump"], ["loop", "Loop"]])("refuses a %s box that is not text, or is too long", (key, box) => {
    for (const value of [5, null, undefined]) expect(spec.shapeProblem(params({ [key]: value }))).toBe(`${key} must be text.`);
    expect(spec.shapeProblem(params({ [key]: "a".repeat(200) }))).toBeNull();
    expect(spec.shapeProblem(params({ [key]: "a".repeat(201) }))).toBe(`the ${box} box is longer than 200 characters.`);
  });

  it("refuses a missing, an extra or a renamed setting", () => {
    const sentence = "role, kind, description, run, jump and loop are the only settings a Build Model step has.";
    const withoutRun = spec.defaultParams();
    delete withoutRun.run;
    for (const bad of [{}, withoutRun, params({ extra: 1 }), { ...withoutRun, runs: "" }]) expect(spec.shapeProblem(bad)).toBe(sentence);
  });

  it("is not ready to run with Auto and no words, but is with a chosen kind or with words", () => {
    expect(spec.incompleteProblem(params({ kind: "auto", description: "" }))).toBe("describe it first, or pick a kind.");
    expect(spec.incompleteProblem(params({ kind: "auto", description: "   \n " }))).toBe("describe it first, or pick a kind.");
    expect(spec.incompleteProblem(params({ kind: "biped" }))).toBeNull();
    expect(spec.incompleteProblem(params({ kind: "auto", description: "a red fox" }))).toBeNull();
  });
});
