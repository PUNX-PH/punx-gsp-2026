// The catalog entry of the Build Model step: what it takes and gives, and which settings are well formed.
import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_CHARACTERS, MAX_MOTION_CHARACTERS, MAX_THEME_CHARACTERS, NODE_SPECS } from "@/lib/graph/registry";

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
    expect(spec.defaultParams()).toEqual({ role: "hero", kind: "auto", description: "", run: "", jump: "", loop: "", quality: "standard" });
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
    const sentence = "role, kind, description, run, jump, loop and quality are the only settings a Build Model step has.";
    const withoutRun = spec.defaultParams();
    delete withoutRun.run;
    for (const bad of [{}, withoutRun, params({ extra: 1 }), { ...withoutRun, runs: "" }]) expect(spec.shapeProblem(bad)).toBe(sentence);
  });

  it("has a Quality setting, Standard unless the person chose High, and a graph saved before it (with none) is still well formed", () => {
    for (const quality of ["standard", "high"]) expect(spec.shapeProblem(params({ quality }))).toBeNull();
    const old = spec.defaultParams();
    delete old.quality;
    expect(spec.shapeProblem(old)).toBeNull();
  });

  it.each([["ultra"], ["High"], ["STANDARD"], [" high"], [""], [1], [true], [null], [undefined], [["high"]]])("refuses the quality %s, with the sentence the save says", (quality) => {
    expect(spec.shapeProblem(params({ quality }))).toBe("the quality must be standard or high.");
  });

  it("checks the other settings before the quality, so a refusal of one of them is what it always was", () => {
    expect(spec.shapeProblem(params({ role: "villain", quality: "ultra" }))).toBe("role must be hero, obstacle or collectible.");
  });

  it("is not ready to run with Auto and no words, but is with a chosen kind or with words", () => {
    expect(spec.incompleteProblem(params({ kind: "auto", description: "" }))).toBe("describe it first, or pick a kind.");
    expect(spec.incompleteProblem(params({ kind: "auto", description: "   \n " }))).toBe("describe it first, or pick a kind.");
    expect(spec.incompleteProblem(params({ kind: "biped" }))).toBeNull();
    expect(spec.incompleteProblem(params({ kind: "auto", description: "a red fox" }))).toBeNull();
  });
});

describe("Build Environment", () => {
  const world = NODE_SPECS["build-environment"];
  const settings = (change: Record<string, unknown> = {}) => ({ ...world.defaultParams(), ...change });

  it("is a catalog step with its plain name and help, and is not the final step", () => {
    expect(world).toMatchObject({ type: "build-environment", label: "Build Environment", help: "Builds the world around the track from a theme.", final: false });
    expect(MAX_THEME_CHARACTERS).toBe(200);
  });

  it("takes an optional palette and gives an environment", () => {
    expect(world.inputs.map((p) => [p.name, p.label, p.type, p.required, p.help])).toEqual([
      ["palette", "palette", "palette", false, "Colors for the world. Without one, a sample palette is used."],
    ]);
    expect(world.outputs.map((p) => [p.name, p.label, p.type, p.help])).toEqual([
      ["environment", "environment", "environment", "The sky, the field, the edge stripes and the scenery."],
    ]);
  });

  it("starts with an empty theme and some scenery, which is ready to run (an empty theme builds a meadow)", () => {
    expect(world.defaultParams()).toEqual({ theme: "", density: "some", quality: "standard" });
    expect(world.shapeProblem(world.defaultParams())).toBeNull();
    expect(world.incompleteProblem(world.defaultParams())).toBeNull();
    expect(world.incompleteProblem(settings({ theme: "a windy meadow" }))).toBeNull();
  });

  it.each([["few"], ["some"], ["lots"]])("accepts the density %s", (density) => {
    expect(world.shapeProblem(settings({ density }))).toBeNull();
  });

  it.each([["many"], ["Some"], [""], [1], [null], [undefined]])("refuses the density %s", (density) => {
    expect(world.shapeProblem(settings({ density }))).toBe("density must be few, some or lots.");
  });

  it("refuses a theme that is not text, or is too long, counting characters (not bytes)", () => {
    for (const theme of [5, null, undefined, ["a"]]) expect(world.shapeProblem(settings({ theme }))).toBe("theme must be text.");
    expect(world.shapeProblem(settings({ theme: "a".repeat(200) }))).toBeNull();
    expect(world.shapeProblem(settings({ theme: "👻".repeat(200) }))).toBeNull();
    expect(world.shapeProblem(settings({ theme: "a".repeat(201) }))).toBe("the theme is longer than 200 characters.");
    expect(world.shapeProblem(settings({ theme: "👻".repeat(201) }))).toBe("the theme is longer than 200 characters.");
  });

  it("refuses a missing, an extra or a renamed setting", () => {
    const sentence = "theme, density and quality are the only settings a Build Environment step has.";
    for (const bad of [{}, { theme: "" }, { density: "some" }, settings({ extra: 1 }), { theme: "", densities: "some" }]) expect(world.shapeProblem(bad)).toBe(sentence);
  });

  it("has a Quality setting too, with the same words, and a graph saved before it is still well formed", () => {
    for (const quality of ["standard", "high"]) expect(world.shapeProblem(settings({ quality }))).toBeNull();
    expect(world.shapeProblem({ theme: "", density: "some" })).toBeNull();
    for (const quality of ["ultra", "High", "", 1, null, undefined]) expect(world.shapeProblem(settings({ quality }))).toBe("the quality must be standard or high.");
    expect(world.shapeProblem(settings({ theme: 5, quality: "ultra" }))).toBe("theme must be text.");
  });

  it("checks the keys before the values", () => {
    expect(world.shapeProblem({ theme: 5, density: "many", extra: true })).toBe("theme, density and quality are the only settings a Build Environment step has.");
    expect(world.shapeProblem({ theme: 5, density: "many" })).toBe("theme must be text.");
  });
});
