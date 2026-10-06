import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLIPS_FOR_ROLE, KIT, MODEL_KINDS, SCENERY_KINDS, type ModelKind, WORLD_PIECES, WORLD_STYLES } from "@/lib/builder/kinds";
import {
  checkBuildBody,
  clipsOf,
  defaultHighRecipe,
  defaultMotions,
  defaultRecipe,
  estimate,
  fitToBudget,
  jointsOf,
  meshesNeeded,
  partCount,
  sceneryMotions,
  sceneryRecipe,
  triangleEstimate,
  worldRecipe,
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
  "invalid-scenery-kind.json": "recipe.build.scenery",
  "invalid-scenery-extras.json": "recipe.extras",
  "invalid-scenery-joint.json": "joint",
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

describe("scenery recipes", () => {
  it.each(SCENERY_KINDS)("scenery-%s.json is the kit's recipe and motions, and passes the check", (kind) => {
    const body = read(`scenery-${kind}.json`);
    expect(body).toEqual({ recipe: sceneryRecipe(kind), motions: sceneryMotions(kind), palette: [...SAMPLE_PALETTE] });
    expect(checkBuildBody(body)).toBeNull();
  });

  it("a scenery recipe is exactly the kind, an empty summary, the piece's own slots and no extras", () => {
    for (const kind of SCENERY_KINDS) {
      expect(sceneryRecipe(kind)).toEqual({ version: 1, kind: "scenery", summary: "", build: { scenery: kind }, colors: KIT.scenery[kind].slots, extras: [] });
    }
  });

  it("the motions are the Loop of the animated pieces and nothing for the rest", () => {
    for (const kind of SCENERY_KINDS) {
      const loop = KIT.scenery[kind].loop;
      expect(sceneryMotions(kind), kind).toEqual({ version: 1, motions: loop ? { loop } : {} });
    }
    expect(clipsOf(sceneryMotions("windmill"))).toEqual(["Loop"]);
    expect(clipsOf(sceneryMotions("rock"))).toEqual([]);
  });

  it("the motions are copies: changing one never changes the kit", () => {
    const motions = sceneryMotions("tree");
    motions.motions.loop!.tracks[0].amplitude = 90;
    expect(KIT.scenery.tree.loop!.tracks[0].amplitude).toBe(4);
  });

  it("jointsOf gives each piece's own joints", () => {
    expect(jointsOf(sceneryRecipe("tree"))).toEqual(["root", "canopy"]);
    expect(jointsOf(sceneryRecipe("windmill"))).toEqual(["root", "blades"]);
    expect(jointsOf(sceneryRecipe("lamp"))).toEqual(["root"]);
  });

  it("counts come from the kit, and no piece can go over the scenery's 600 triangles", () => {
    for (const kind of SCENERY_KINDS) {
      const recipe = sceneryRecipe(kind);
      expect(partCount(recipe), kind).toBe(KIT.scenery[kind].count.parts);
      expect(triangleEstimate(recipe), kind).toBe(KIT.scenery[kind].count.triangles);
      expect(triangleEstimate(recipe), kind).toBeLessThanOrEqual(KIT.caps.sceneryTriangles);
    }
  });

  it("defaultMotions of a scenery recipe is empty (a model's clips do not apply)", () => {
    expect(defaultMotions(sceneryRecipe("tree"), ["loop"]).motions).toEqual({});
  });

  it("refuses a piece that is not in the kit, a scenery recipe with extras or a model's build fields, and a track on a joint the piece lacks", () => {
    const body = (change: (b: BuildBody) => void) => {
      const b = clone(read("scenery-tree.json"));
      change(b);
      return b;
    };
    expect(checkBuildBody(body((b) => ((b.recipe.build as Record<string, unknown>).scenery = "castle")))).toContain("recipe.build.scenery");
    expect(checkBuildBody(body((b) => (b.recipe.extras = ["hat"])))).toContain("recipe.extras");
    expect(checkBuildBody(body((b) => ((b.recipe.build as Record<string, unknown>).size = 1)))).toContain("recipe.build");
    expect(checkBuildBody(body((b) => ((b.recipe.colors as Record<string, unknown>).head = 1)))).toContain("recipe.colors");
    expect(checkBuildBody(body((b) => (b.motions.motions.loop!.tracks[0].joint = "blades")))).toContain("joint");
    expect(checkBuildBody(body((b) => ((b.recipe as unknown as Record<string, unknown>).kind = "Scenery")))).toContain("recipe.kind");
    expect(checkBuildBody(body((b) => (b.recipe.colors.main = 5)))).toContain("recipe.colors.main");
  });
});


// ---------------------------------------------------------------------------------------------------------------------------------
// The High tier: the same check on both sides, the estimate, the budget fit and the shared fixtures.

const HIGH_DIR = FIXTURES + "high/";
const readHigh = (name: string): BuildBody => JSON.parse(readFileSync(HIGH_DIR + name, "utf8")) as BuildBody;
const highFiles = readdirSync(HIGH_DIR);
const validHigh = highFiles.filter((f) => f.endsWith(".json") && !f.startsWith("invalid-") && !f.startsWith("expected"));
const invalidHigh = highFiles.filter((f) => f.startsWith("invalid-"));

// What each invalid High fixture's problem must contain: the same table as the worker's recipe.test.mjs.
const EXPECTED_HIGH_PROBLEM: Record<string, string> = {
  "invalid-high-no-finishes.json": "recipe.finishes",
  "invalid-high-unknown-finish.json": "recipe.finishes",
  "invalid-high-unknown-detail.json": "recipe.details",
  "invalid-high-five-details.json": "recipe.details",
  "invalid-high-over-budget.json": "is over the biped limit",
  "invalid-high-over-meshes.json": "17 meshes is over the biped limit of 14",
  "invalid-standard-with-finishes.json": "recipe.finishes",
  "invalid-quality-word.json": "recipe.quality",
  "invalid-world-standard.json": "recipe.kind",
};

describe("meshesNeeded: what a High build makes from the clips' tracks", () => {
  const swing = (joint: string) => ({ joint, channel: "rotate" as const, axis: "x" as const, wave: "swing" as const, amplitude: 10, cycles: 1, phase: 0 });
  const clip = (...joints: string[]) => ({ seconds: 1, tracks: joints.map(swing) });

  it("is one for a model nothing moves", () => {
    expect(meshesNeeded(defaultHighRecipe("biped"), { version: 1, motions: {} })).toBe(1);
  });

  it("is one for the root and the rest that stands still, and one more for each other joint a clip has a track for", () => {
    const recipe = defaultHighRecipe("biped");
    expect(meshesNeeded(recipe, { version: 1, motions: { run: clip("hips", "thigh_l", "thigh_r") } })).toBe(3); // the root, hips, shares the first mesh
    expect(meshesNeeded(recipe, { version: 1, motions: { run: clip("thigh_l"), jump: clip("thigh_l", "shin_l") } })).toBe(3); // a joint counts once however many clips move it
  });

  it("counts every joint of the biped's skeleton: seventeen joints are seventeen meshes when all of them move", () => {
    const recipe = defaultHighRecipe("biped");
    const everything = jointsOf(recipe);
    expect(everything).toHaveLength(17);
    expect(meshesNeeded(recipe, { version: 1, motions: { run: clip(...everything.slice(0, 12)), jump: clip(...everything.slice(12)) } })).toBe(17);
  });

  it("counts the joints an extra adds", () => {
    const recipe = { ...defaultHighRecipe("blob"), extras: ["tail" as const, "ears" as const] };
    expect(meshesNeeded(recipe, { version: 1, motions: { loop: clip("tail_1", "tail_2", "ear_l", "ear_r") } })).toBe(5);
  });
});

describe("checkBuildBody and the mesh budget", () => {
  it("refuses a High body whose clips move more joints than the kind has meshes for, naming the count and the limit", () => {
    const body = read("high/invalid-high-over-meshes.json");
    expect(checkBuildBody(body)).toBe("motions: 17 meshes is over the biped limit of 14");
  });

  it("accepts a High body that moves exactly as many joints as the limit allows", () => {
    const recipe = defaultHighRecipe("biped");
    const joints = jointsOf(recipe).slice(1, 14); // thirteen joints besides the root: fourteen meshes
    const track = (joint: string) => ({ joint, channel: "rotate" as const, axis: "x" as const, wave: "swing" as const, amplitude: 10, cycles: 1, phase: 0 });
    const body: BuildBody = { recipe, motions: { version: 1, motions: { run: { seconds: 1, tracks: joints.slice(0, 12).map(track) }, jump: { seconds: 1, tracks: joints.slice(12).map(track) } } }, palette: [...SAMPLE_PALETTE] };
    expect(meshesNeeded(recipe, body.motions)).toBe(14);
    expect(checkBuildBody(body)).toBeNull();
  });

  it("does not apply to Standard (its models are one mesh a joint with no mesh limit of their own)", () => {
    const body = read("biped-stress.json");
    expect(checkBuildBody(body)).toBeNull();
  });
});

const highBody = (recipe: ModelRecipe, role: Role): BuildBody => ({ recipe, motions: defaultMotions(recipe, CLIPS_FOR_ROLE[role]), palette: [...SAMPLE_PALETTE] });
const everyExtra = (kind: ModelKind) => KIT.kinds[kind].extras;
const cloneRecipe = (recipe: ModelRecipe): ModelRecipe => JSON.parse(JSON.stringify(recipe)) as ModelRecipe;

describe("the shared High recipe fixtures", () => {
  it("every valid High fixture passes the check", () => {
    expect(validHigh.length).toBeGreaterThanOrEqual(8);
    for (const f of validHigh) expect(checkBuildBody(readHigh(f)), f).toBeNull();
  });

  it("every invalid High fixture fails with the expected problem, and the table has no stragglers", () => {
    expect([...invalidHigh].sort()).toEqual(Object.keys(EXPECTED_HIGH_PROBLEM).sort());
    for (const f of invalidHigh) {
      const problem = checkBuildBody(readHigh(f));
      expect(problem, f).not.toBeNull();
      expect(problem, f).toContain(EXPECTED_HIGH_PROBLEM[f]);
    }
  });

  it("each <kind>-high-default.json is the default High body", () => {
    for (const kind of MODEL_KINDS) {
      expect(readHigh(`${kind}-high-default.json`), kind).toEqual(highBody(defaultHighRecipe(kind), ROLE_OF[kind]));
    }
  });

  it("estimate of each valid fixture equals expected-high.json, with its clips", () => {
    const expected = JSON.parse(readFileSync(HIGH_DIR + "expected-high.json", "utf8")) as Record<string, { parts: number; triangles: number; vertices: number; meshes: number; clips: string[] }>;
    expect(Object.keys(expected).sort()).toEqual([...validHigh].sort());
    for (const f of validHigh) {
      const b = readHigh(f);
      expect({ ...estimate(b.recipe), clips: clipsOf(b.motions) }, f).toEqual(expected[f]);
    }
  });

  it("each stress fixture is within its caps (parts, triangles, vertices, meshes) and has 12 tracks per motion", () => {
    for (const kind of MODEL_KINDS) {
      const b = readHigh(`${kind}-high-stress.json`);
      const caps = KIT.tiers.high.caps[kind];
      const e = estimate(b.recipe);
      expect(e.parts, kind).toBeLessThanOrEqual(caps.parts);
      expect(e.triangles, kind).toBeLessThanOrEqual(caps.triangles);
      expect(e.vertices, kind).toBeLessThanOrEqual(caps.vertices);
      expect(e.meshes, kind).toBeLessThanOrEqual(caps.meshes);
      expect(b.recipe.extras, kind).toHaveLength(Math.min(2, KIT.kinds[kind].extras.length));
      expect(Object.keys(b.motions.motions).sort(), kind).toEqual(["jump", "loop", "run"]);
      for (const m of Object.values(b.motions.motions)) expect(m?.tracks.length, kind).toBe(12);
    }
    expect(readHigh("prop-high-stress.json").recipe.build.shape).toBe("ring");
  });
});

describe("a High recipe", () => {
  it("is the kind's default with the quality, the default finishes and the default details", () => {
    for (const kind of MODEL_KINDS) {
      const recipe = defaultHighRecipe(kind);
      expect(recipe, kind).toEqual({
        ...defaultRecipe(kind),
        quality: "high",
        finishes: KIT.tiers.high.defaults[kind].finishes,
        details: KIT.tiers.high.defaults[kind].details,
      });
      expect(checkBuildBody(highBody(recipe, "hero")), kind).toBeNull();
    }
  });

  it("makes a new recipe every time", () => {
    const a = defaultHighRecipe("biped");
    a.finishes!.head = "glow";
    a.details!.push("cables");
    expect(defaultHighRecipe("biped").finishes!.head).toBe("painted");
    expect(defaultHighRecipe("biped").details).toEqual(["seams", "bolts", "lights"]);
  });

  it("keeps a Standard recipe exactly as it was: no quality, finishes or details keys", () => {
    for (const kind of MODEL_KINDS) {
      const recipe = defaultRecipe(kind);
      expect("quality" in recipe).toBe(false);
      expect("finishes" in recipe).toBe(false);
      expect("details" in recipe).toBe(false);
    }
  });

  it("accepts quality standard written out, and refuses a Standard recipe with finishes or details", () => {
    const standard = highBody(defaultRecipe("biped"), "hero");
    expect(checkBuildBody({ ...standard, recipe: { ...standard.recipe, quality: "standard" } })).toBeNull();
    expect(checkBuildBody({ ...standard, recipe: { ...standard.recipe, details: ["seams"] } })).toContain("recipe.details");
    expect(checkBuildBody({ ...standard, recipe: { ...standard.recipe, finishes: {} } })).toContain("recipe.finishes");
    expect(checkBuildBody({ ...standard, recipe: { ...standard.recipe, quality: "standard", details: [] } })).toContain("recipe.details");
  });

  it("refuses a quality that is not standard or high", () => {
    const body = highBody(defaultHighRecipe("biped"), "hero");
    for (const quality of ["ultra", "High", "", null, 1, true]) {
      expect(checkBuildBody({ ...body, recipe: { ...body.recipe, quality } }), String(quality)).toContain("recipe.quality");
    }
  });

  it("needs finishes for exactly the kind's slots, each a known finish", () => {
    const body = highBody(defaultHighRecipe("biped"), "hero");
    const withFinishes = (finishes: unknown) => checkBuildBody({ ...body, recipe: { ...body.recipe, finishes } });
    expect(withFinishes({ ...body.recipe.finishes })).toBeNull();
    expect(withFinishes(undefined)).toContain("recipe.finishes");
    expect(withFinishes(null)).toContain("recipe.finishes");
    expect(withFinishes({ head: "painted" })).toContain("recipe.finishes");
    expect(withFinishes({ ...body.recipe.finishes, wings: "matte" })).toContain("recipe.finishes");
    expect(withFinishes({ ...body.recipe.finishes, head: "chrome" })).toContain("recipe.finishes.head");
    expect(withFinishes({ ...body.recipe.finishes, head: 3 })).toContain("recipe.finishes.head");
    expect(withFinishes(JSON.parse('{"__proto__": "matte", "head": "matte"}'))).toContain("recipe.finishes");
  });

  it("needs details that are distinct names the kind can have, at most four", () => {
    const body = highBody(defaultHighRecipe("biped"), "hero");
    const withDetails = (details: unknown) => checkBuildBody({ ...body, recipe: { ...body.recipe, details } });
    expect(withDetails([])).toBeNull();
    expect(withDetails(undefined)).toContain("recipe.details");
    expect(withDetails("seams")).toContain("recipe.details");
    expect(withDetails(["seams", "sparkles"])).toContain("recipe.details");
    expect(withDetails(["seams", "seams"])).toContain("recipe.details");
    expect(withDetails(["seams", "bolts", "cables", "lights", "seams"])).toContain("recipe.details");
    expect(withDetails([7])).toContain("recipe.details");
    const blob = highBody(defaultHighRecipe("blob"), "collectible");
    expect(checkBuildBody({ ...blob, recipe: { ...blob.recipe, details: ["bolts"] } })).toContain("recipe.details"); // a blob has no bolts
  });

  it("refuses a recipe over the kind's caps, naming what is over", () => {
    const body = highBody({ ...defaultHighRecipe("biped"), extras: ["backpack", "antenna"], details: ["seams", "bolts", "cables", "lights"] }, "hero");
    expect(estimate(body.recipe).parts).toBeGreaterThan(KIT.tiers.high.caps.biped.parts);
    expect(checkBuildBody(body)).toMatch(/parts is over the biped limit of 80/);
  });

  it("keeps the existing refusals working in High: an out-of-range number, an extra the kind lacks, a joint it lacks", () => {
    const body = highBody(defaultHighRecipe("biped"), "hero");
    const bad = cloneRecipe(body.recipe);
    (bad.build as Record<string, unknown>).headSize = 2;
    expect(checkBuildBody({ ...body, recipe: bad })).toContain("recipe.build.headSize");
    expect(checkBuildBody({ ...body, recipe: { ...body.recipe, extras: ["wings"] } })).toContain("recipe.extras");
    const vehicle = highBody(defaultHighRecipe("vehicle"), "obstacle");
    expect(checkBuildBody({ ...vehicle, recipe: { ...vehicle.recipe, extras: ["tail"] } })).toContain("recipe.extras");
  });

  it("allows a High scenery piece, and a world piece only in High", () => {
    for (const kind of SCENERY_KINDS) {
      const recipe = sceneryRecipe(kind, "high");
      expect(recipe.quality, kind).toBe("high");
      expect(checkBuildBody({ recipe, motions: sceneryMotions(kind), palette: [...SAMPLE_PALETTE] }), kind).toBeNull();
      expect(checkBuildBody({ recipe: { ...recipe, details: ["seams"] }, motions: sceneryMotions(kind), palette: [...SAMPLE_PALETTE] }), kind).toContain("recipe.details");
    }
    for (const piece of WORLD_PIECES) {
      for (const style of WORLD_STYLES) {
        const recipe = worldRecipe(piece, style);
        const body = { recipe, motions: { version: 1 as const, motions: {} }, palette: [...SAMPLE_PALETTE] };
        expect(checkBuildBody(body), `${piece} ${style}`).toBeNull();
        expect(checkBuildBody({ ...body, recipe: { ...recipe, quality: "standard", finishes: undefined, details: undefined } }), `${piece} ${style} standard`).toContain("recipe.kind");
        expect(checkBuildBody({ ...body, recipe: { ...recipe, build: { piece, style: "tundra" } } }), `${piece} tundra`).toContain("recipe.build.style");
        expect(checkBuildBody({ ...body, recipe: { ...recipe, extras: ["hat"] } }), `${piece} extras`).toContain("recipe.extras");
        expect(checkBuildBody({ ...body, motions: sceneryMotions("tree") }), `${piece} motions`).toContain("motions.motions");
      }
    }
  });
});

describe("estimate", () => {
  it("is the Standard counts with no vertices or meshes for a Standard recipe", () => {
    expect(estimate(defaultRecipe("biped"))).toEqual({ parts: 15, triangles: 180, vertices: 0, meshes: 0 });
    expect(estimate(sceneryRecipe("tree"))).toEqual({ parts: 3, triangles: 188, vertices: 0, meshes: 0 });
  });

  it("is the High base for a High recipe with no extras and no details", () => {
    const high = KIT.tiers.high;
    expect(estimate({ ...defaultHighRecipe("biped"), details: [] })).toEqual(high.base.biped);
    expect(estimate({ ...defaultHighRecipe("blob"), details: [] })).toEqual(high.base.blob);
  });

  it("adds each extra and each detail", () => {
    const high = KIT.tiers.high;
    const plain = estimate({ ...defaultHighRecipe("biped"), details: [] });
    const withTail = estimate({ ...defaultHighRecipe("biped"), details: [], extras: ["tail"] });
    expect(withTail.triangles - plain.triangles).toBe(high.extras.tail.triangles);
    expect(withTail.meshes - plain.meshes).toBe(high.extras.tail.meshes);
    const withBolts = estimate({ ...defaultHighRecipe("biped"), details: ["bolts"] });
    expect(withBolts.vertices - plain.vertices).toBe(high.details.bolts.biped!.vertices);
    expect(withBolts.parts - plain.parts).toBe(high.details.bolts.biped!.parts);
  });

  it("prices a vehicle by its cab and its wheels", () => {
    const high = KIT.tiers.high.base.vehicle;
    const base = (build: Record<string, number | string>) => estimate({ ...defaultHighRecipe("vehicle"), details: [], build: { ...defaultHighRecipe("vehicle").build, ...build } });
    expect(base({ cabSize: 0, wheelCount: 2 }).triangles).toBe(high.triangles + 2 * high.wheel.triangles);
    expect(base({ cabSize: 0.4, wheelCount: 2 }).triangles).toBe(high.triangles + high.cab.triangles + 2 * high.wheel.triangles);
    expect(base({ cabSize: 0.4, wheelCount: 6 }).meshes).toBe(high.meshes + high.cab.meshes + 6 * high.wheel.meshes);
  });

  it("prices a prop by its shape", () => {
    for (const shape of Object.keys(KIT.tiers.high.base.prop.shapes)) {
      const recipe = { ...defaultHighRecipe("prop"), details: [], build: { shape, size: 1 } };
      expect(estimate(recipe), shape).toEqual(KIT.tiers.high.base.prop.shapes[shape as keyof typeof KIT.tiers.high.base.prop.shapes]);
    }
  });

  it("prices a scenery piece and a world piece", () => {
    expect(estimate(sceneryRecipe("windmill", "high"))).toEqual(KIT.tiers.high.base.scenery.windmill);
    const terrain = estimate(worldRecipe("terrain", "desert"));
    expect(terrain.triangles).toBe(KIT.tiers.high.base.world.terrain.triangles);
    expect(terrain.vertices).toBe(KIT.tiers.high.base.world.terrain.vertices);
  });
});

describe("fitToBudget", () => {
  const caps = KIT.tiers.high.caps;
  const within = (recipe: ModelRecipe) => {
    const e = estimate(recipe);
    const c = caps[recipe.kind as ModelKind];
    return e.triangles <= c.triangles && e.vertices <= c.vertices && e.parts <= c.parts && e.meshes <= c.meshes;
  };
  // Only the limit given binds: the others are infinite, so a test can say which one is over.
  const only = (limit: Partial<{ triangles: number; vertices: number; parts: number; meshes: number }>) => ({ triangles: Infinity, vertices: Infinity, parts: Infinity, meshes: Infinity, ...limit });
  // Two big extras and every detail: over the parts cap, and the case for the order of the drops (with a limit only that test sets).
  const heavy = (): ModelRecipe => ({ ...defaultHighRecipe("biped"), extras: ["backpack", "ears"], details: ["seams", "bolts", "cables", "lights"] });
  // Just over the real parts cap: one extra and every detail.
  const justOver = (): ModelRecipe => ({ ...defaultHighRecipe("biped"), extras: ["hat"], details: ["seams", "bolts", "cables", "lights"] });

  it("never touches a recipe that is already within its budget (and gives back a new object)", () => {
    for (const kind of MODEL_KINDS) {
      const recipe = defaultHighRecipe(kind);
      const fitted = fitToBudget(recipe);
      expect(fitted, kind).toEqual(recipe);
      expect(fitted, kind).not.toBe(recipe);
    }
    const stress = readHigh("biped-high-stress.json").recipe;
    expect(fitToBudget(stress)).toEqual(stress);
  });

  it("drops cables first, and only as much as it must, on a biped that is just over", () => {
    expect(within(justOver())).toBe(false);
    const fitted = fitToBudget(justOver())!;
    expect(fitted.details).toEqual(["seams", "bolts", "lights"]);
    expect(fitted.extras).toEqual(["hat"]);
    expect(within(fitted)).toBe(true);
  });

  it("drops bolts next when cables are not enough", () => {
    expect(within(heavy())).toBe(false);
    const fitted = fitToBudget(heavy())!;
    expect(fitted.details).toEqual(["seams", "lights"]);
    expect(fitted.extras).toEqual(["backpack", "ears"]);
    expect(within(fitted)).toBe(true);
  });

  it("drops in the order cables, bolts, seams, lights, then extras from the end, when the caps are tighter", () => {
    const base = estimate({ ...heavy(), extras: [], details: [] });
    const cost = (extras: ModelRecipe["extras"], details: NonNullable<ModelRecipe["details"]>) => estimate({ ...heavy(), extras, details }).triangles;
    const order: [number, ModelRecipe["extras"], NonNullable<ModelRecipe["details"]>][] = [
      [cost(["backpack", "ears"], ["seams", "bolts", "cables", "lights"]), ["backpack", "ears"], ["seams", "bolts", "cables", "lights"]],
      [cost(["backpack", "ears"], ["seams", "bolts", "lights"]), ["backpack", "ears"], ["seams", "bolts", "lights"]],
      [cost(["backpack", "ears"], ["seams", "lights"]), ["backpack", "ears"], ["seams", "lights"]],
      [cost(["backpack", "ears"], ["lights"]), ["backpack", "ears"], ["lights"]],
      [cost(["backpack", "ears"], []), ["backpack", "ears"], []],
      [cost(["backpack"], []), ["backpack"], []],
      [base.triangles, [], []],
    ];
    for (const [triangles, extras, details] of order) {
      const fitted = fitToBudget(heavy(), only({ triangles }))!;
      expect(fitted.extras).toEqual(extras);
      expect(fitted.details).toEqual(details);
    }
  });

  it("gives null when the recipe is still over with nothing left to drop", () => {
    expect(fitToBudget(heavy(), only({ triangles: 100 }))).toBeNull();
    expect(fitToBudget(defaultHighRecipe("biped"), only({ parts: 3 }))).toBeNull();
  });

  it("keeps whichever of the four limits is the one that is over (vertices, parts and meshes count too)", () => {
    const byVertices = fitToBudget(heavy(), only({ vertices: estimate({ ...heavy(), details: ["seams", "bolts", "lights"] }).vertices }))!;
    expect(byVertices.details).toEqual(["seams", "bolts", "lights"]);
    const byParts = fitToBudget(heavy(), only({ parts: estimate({ ...heavy(), details: ["seams", "lights"] }).parts }))!;
    expect(byParts.details).toEqual(["seams", "lights"]);
    // extras and details join existing meshes, so only the base can be over the mesh cap, and nothing can be dropped to fix it
    expect(fitToBudget(heavy(), only({ meshes: estimate(defaultHighRecipe("biped")).meshes - 1 }))).toBeNull();
    expect(fitToBudget(heavy(), only({ meshes: estimate(defaultHighRecipe("biped")).meshes }))).toEqual(heavy());
  });

  it("property: the result is within the caps, and its extras and details are a subset of the input's, in the input's order", () => {
    const kinds: ModelKind[] = ["biped", "vehicle", "blob", "prop"];
    for (const kind of kinds) {
      const allExtras = everyExtra(kind);
      for (const count of [0, 1, 2]) {
        const extras = allExtras.slice(0, count);
        for (const details of [[], ["lights"], ["seams", "bolts"], ["seams", "bolts", "cables", "lights"]] as ModelRecipe["details"][]) {
          const allowed = details!.filter((d) => KIT.tiers.high.details[d][kind] !== undefined);
          const input: ModelRecipe = { ...defaultHighRecipe(kind), extras, details: allowed };
          const fitted = fitToBudget(input);
          if (within(input)) {
            expect(fitted, `${kind} ${count} ${allowed}`).toEqual(input);
            continue;
          }
          expect(fitted, `${kind} ${count} ${allowed}`).not.toBeNull();
          expect(within(fitted!), `${kind} ${count} ${allowed}`).toBe(true);
          expect(allowed.filter((d) => fitted!.details!.includes(d)), `${kind}`).toEqual(fitted!.details);
          expect(extras.slice(0, fitted!.extras.length), `${kind}`).toEqual(fitted!.extras);
        }
      }
    }
  });

  it("does not change the recipe it was given", () => {
    const recipe = Object.freeze({ ...heavy(), extras: Object.freeze([...heavy().extras]) as ModelRecipe["extras"], details: Object.freeze([...heavy().details!]) as ModelRecipe["details"] });
    expect(() => fitToBudget(recipe as ModelRecipe)).not.toThrow();
  });

  it("passes a Standard recipe through as a copy", () => {
    const recipe = defaultRecipe("biped");
    expect(fitToBudget(recipe)).toEqual(recipe);
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
