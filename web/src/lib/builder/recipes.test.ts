import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLIPS_FOR_ROLE, MODEL_KINDS, type ModelKind } from "@/lib/builder/kinds";
import {
  checkBuildBody,
  clipsOf,
  defaultMotions,
  defaultRecipe,
  jointsOf,
  partCount,
  triangleEstimate,
  type BuildBody,
  type ModelRecipe,
} from "@/lib/builder/recipes";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import type { Role } from "@/lib/graph/types";

// web/src/lib/builder -> the repository root is four levels up. The worker's own check reads the same folder.
const FIXTURES = fileURLToPath(new URL("../../../../blender-worker/fixtures/recipes/", import.meta.url));
const read = (name: string): BuildBody => JSON.parse(readFileSync(FIXTURES + name, "utf8")) as BuildBody;
const files = readdirSync(FIXTURES);
const validFixtures = files.filter((f) => f.endsWith(".json") && !f.startsWith("invalid-") && f !== "expected.json");
const invalidFixtures = files.filter((f) => f.startsWith("invalid-"));

// What each invalid fixture's problem must contain: the same table as the worker's recipe.test.mjs.
const EXPECTED_PROBLEM: Record<string, string> = {
  "invalid-unknown-kind.json": "recipe.kind",
  "invalid-out-of-range.json": "recipe.build.headSize",
  "invalid-missing-field.json": "recipe.build",
  "invalid-not-whole.json": "recipe.build.wheelCount",
  "invalid-unknown-extra.json": "recipe.extras",
  "invalid-three-extras.json": "recipe.extras",
  "invalid-extra-not-for-kind.json": "recipe.extras",
  "invalid-color-slot.json": "recipe.colors.head",
  "invalid-summary.json": "recipe.summary",
  "invalid-unknown-joint.json": "joint",
  "invalid-joint-path.json": "joint",
  "invalid-channel.json": "channel",
  "invalid-thirteen-tracks.json": "tracks",
  "invalid-clip.json": "motions.motions",
  "invalid-palette.json": "palette",
  "invalid-extra-key.json": "body",
};

const ROLE_OF: Record<ModelKind, Role> = { biped: "hero", vehicle: "obstacle", blob: "collectible", prop: "collectible" };
const bodyOf = (recipe: ModelRecipe, role: Role): BuildBody => ({ recipe, motions: defaultMotions(recipe, CLIPS_FOR_ROLE[role]), palette: [...SAMPLE_PALETTE] });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("the shared recipe fixtures", () => {
  it("every valid fixture passes the check", () => {
    expect(validFixtures.length).toBeGreaterThanOrEqual(8);
    for (const f of validFixtures) expect(checkBuildBody(read(f)), f).toBeNull();
  });

  it("every invalid fixture fails with the expected problem, and the table has no stragglers", () => {
    expect([...invalidFixtures].sort()).toEqual(Object.keys(EXPECTED_PROBLEM).sort());
    for (const f of invalidFixtures) {
      const problem = checkBuildBody(read(f));
      expect(problem, f).not.toBeNull();
      expect(problem, f).toContain(EXPECTED_PROBLEM[f]);
    }
  });

  it("each <kind>-default.json is the default body", () => {
    for (const kind of MODEL_KINDS) {
      expect(read(`${kind}-default.json`), kind).toEqual(bodyOf(defaultRecipe(kind), ROLE_OF[kind]));
    }
  });

  it("parts, triangles and clips equal expected.json for every valid fixture", () => {
    const expected = JSON.parse(readFileSync(FIXTURES + "expected.json", "utf8")) as Record<string, { parts: number; triangles: number; clips: string[] }>;
    expect(Object.keys(expected).sort()).toEqual([...validFixtures].sort());
    for (const f of validFixtures) {
      const b = read(f);
      expect({ parts: partCount(b.recipe), triangles: triangleEstimate(b.recipe), clips: clipsOf(b.motions) }, f).toEqual(expected[f]);
    }
  });

  it("each stress fixture stays within the caps and has 12 tracks per motion", () => {
    for (const kind of MODEL_KINDS) {
      const b = read(`${kind}-stress.json`);
      expect(partCount(b.recipe), kind).toBeLessThanOrEqual(24);
      expect(triangleEstimate(b.recipe), kind).toBeLessThanOrEqual(2000);
      expect(Object.keys(b.motions.motions).sort(), kind).toEqual(["jump", "loop", "run"]);
      for (const m of Object.values(b.motions.motions)) expect(m?.tracks.length, kind).toBe(12);
    }
    expect(read("prop-stress.json").recipe.build.shape).toBe("ring");
  });
});

describe("jointsOf, the defaults and the counts", () => {
  it("lists the base joints, then each extra's joints in recipe order", () => {
    expect(jointsOf(defaultRecipe("biped"))).toHaveLength(17);
    expect(jointsOf({ ...defaultRecipe("biped"), extras: ["tail"] }).slice(-2)).toEqual(["tail_1", "tail_2"]);
    expect(jointsOf({ ...defaultRecipe("vehicle"), build: { ...defaultRecipe("vehicle").build, wheelCount: 3 } })).toEqual(["body", "wheel_1", "wheel_2", "wheel_3"]);
    expect(jointsOf({ ...defaultRecipe("blob"), extras: ["ears"] })).toEqual(["body", "eye_l", "eye_r", "ear_l", "ear_r"]);
    expect(jointsOf(defaultRecipe("prop"))).toEqual(["root"]);
  });

  it("the default vehicle with 3 wheels has no track on wheel_4", () => {
    const recipe = { ...defaultRecipe("vehicle"), build: { ...defaultRecipe("vehicle").build, wheelCount: 3 } };
    const tracks = Object.values(defaultMotions(recipe, ["run", "loop"]).motions).flatMap((m) => m?.tracks ?? []);
    expect(tracks.some((t) => t.joint === "wheel_3")).toBe(true);
    expect(tracks.some((t) => t.joint === "wheel_4")).toBe(false);
  });

  it("defaultMotions gives only the clips asked for", () => {
    expect(Object.keys(defaultMotions(defaultRecipe("biped"), ["run", "jump"]).motions)).toEqual(["run", "jump"]);
    expect(Object.keys(defaultMotions(defaultRecipe("blob"), ["loop"]).motions)).toEqual(["loop"]);
  });

  it("clipsOf lists clips that have a track, in Run, Jump, Loop order", () => {
    const motions = defaultMotions(defaultRecipe("biped"), ["loop", "run"]);
    expect(clipsOf(motions)).toEqual(["Run", "Loop"]);
    expect(clipsOf({ version: 1, motions: { run: { seconds: 0.5, tracks: [] } } })).toEqual([]);
  });

  it("counts: biped 15 and 180, a default vehicle counts its cab and wheels, a prop counts its shape", () => {
    expect([partCount(defaultRecipe("biped")), triangleEstimate(defaultRecipe("biped"))]).toEqual([15, 180]);
    expect([partCount(defaultRecipe("vehicle")), triangleEstimate(defaultRecipe("vehicle"))]).toEqual([6, 136]);
    expect([partCount(defaultRecipe("blob")), triangleEstimate(defaultRecipe("blob"))]).toEqual([3, 104]);
    expect([partCount(defaultRecipe("prop")), triangleEstimate(defaultRecipe("prop"))]).toEqual([1, 12]);
    const noCab = { ...defaultRecipe("vehicle"), build: { ...defaultRecipe("vehicle").build, cabSize: 0 } };
    expect(partCount(noCab)).toBe(5);
  });
});

describe("hostile bodies are refused", () => {
  const base = () => clone(read("biped-default.json"));
  const refused = (name: string, body: unknown) => it(name, () => expect(checkBuildBody(body)).not.toBeNull());

  refused("an extra __proto__ key in build", JSON.parse(JSON.stringify(base()).replace('"headSize"', '"__proto__":1,"headSize"')));
  refused("a track joint named constructor", (() => { const b = base(); b.motions.motions.run!.tracks[0].joint = "constructor"; return b; })());
  refused("an amplitude of 1e308", (() => { const b = base(); b.motions.motions.run!.tracks[0].amplitude = 1e308; return b; })());
  refused("seconds as a string", JSON.parse(JSON.stringify(base()).replace('"seconds":0.6', '"seconds":"0.6"')));
  refused("a palette entry that is not hex", (() => { const b = base(); b.palette[0] = "red"; return b; })());
  refused("null", null);
  refused("an array", []);
  refused("a number", 4);
  refused("NaN as a build value", (() => { const b = base(); (b.recipe.build as Record<string, unknown>).headSize = "NaN"; return b; })());
});
