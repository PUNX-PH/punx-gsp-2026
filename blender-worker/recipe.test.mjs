// The worker's own check of a build body: the same rules, fixtures and problem fragments as web/src/lib/builder/recipes.test.ts, so the two
// sides accept and refuse exactly the same recipes.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { hostileBodies } from "./fixtures/hostile-bodies.mjs";
import { checkBuildBody, estimate, jointsOf, KIT } from "./recipe.mjs";

const MODEL_KINDS = Object.keys(KIT.kinds);

const FIXTURES = new URL("./fixtures/recipes/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const files = readdirSync(FIXTURES);
const valid = files.filter((f) => f.endsWith(".json") && !f.startsWith("invalid-") && f !== "expected.json");
const invalid = files.filter((f) => f.startsWith("invalid-"));

const EXPECTED_PROBLEM = {
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

describe("checkBuildBody", () => {
  it("reads the kit beside it", () => {
    assert.equal(KIT.version, 1);
    assert.deepEqual(Object.keys(KIT.kinds), ["biped", "vehicle", "blob", "prop"]);
  });

  it("accepts every valid fixture", () => {
    assert.ok(valid.length >= 8);
    for (const f of valid) assert.equal(checkBuildBody(read(f)), null, f);
  });

  it("refuses every invalid fixture with the expected problem, and the table has no stragglers", () => {
    assert.deepEqual([...invalid].sort(), Object.keys(EXPECTED_PROBLEM).sort());
    for (const f of invalid) {
      const problem = checkBuildBody(read(f));
      assert.notEqual(problem, null, f);
      assert.ok(problem.includes(EXPECTED_PROBLEM[f]), `${f}: ${problem}`);
    }
  });

  it("refuses every hostile body", () => {
    for (const [name, body] of hostileBodies()) assert.notEqual(checkBuildBody(body), null, name);
  });

  it("lists joints like the web app: base joints, then extras; a vehicle's wheels follow its count", () => {
    const biped = read("biped-default.json").recipe;
    assert.equal(jointsOf(biped).length, 17);
    assert.deepEqual(jointsOf({ ...biped, extras: ["tail"] }).slice(-2), ["tail_1", "tail_2"]);
    const vehicle = read("vehicle-default.json").recipe;
    assert.deepEqual(jointsOf({ ...vehicle, build: { ...vehicle.build, wheelCount: 3 } }), ["body", "wheel_1", "wheel_2", "wheel_3"]);
    assert.deepEqual(jointsOf(read("prop-default.json").recipe), ["root"]);
  });

  it("accepts the six scenery pieces and lists each piece's own joints, like the web app", () => {
    assert.deepEqual(Object.keys(KIT.scenery), ["tree", "pine", "rock", "cactus", "windmill", "lamp"]);
    for (const kind of Object.keys(KIT.scenery)) assert.equal(checkBuildBody(read(`scenery-${kind}.json`)), null, kind);
    assert.deepEqual(jointsOf(read("scenery-tree.json").recipe), ["root", "canopy"]);
    assert.deepEqual(jointsOf(read("scenery-windmill.json").recipe), ["root", "blades"]);
    assert.deepEqual(jointsOf(read("scenery-lamp.json").recipe), ["root"]);
  });

  it("refuses a scenery recipe that is not a piece of the kit, has extras or a model's fields, or moves a joint it lacks", () => {
    const changed = (change) => {
      const body = structuredClone(read("scenery-tree.json"));
      change(body);
      return checkBuildBody(body);
    };
    assert.match(changed((b) => (b.recipe.build.scenery = "castle")), /recipe\.build\.scenery/);
    assert.match(changed((b) => (b.recipe.build.scenery = "__proto__")), /recipe\.build\.scenery/);
    assert.match(changed((b) => (b.recipe.extras = ["hat"])), /recipe\.extras/);
    assert.match(changed((b) => (b.recipe.build.size = 1)), /recipe\.build/);
    assert.match(changed((b) => (b.recipe.colors.head = 1)), /recipe\.colors/);
    assert.match(changed((b) => (b.motions.motions.loop.tracks[0].joint = "blades")), /joint/);
    assert.match(changed((b) => (b.recipe.colors.main = 5)), /recipe\.colors\.main/);
  });

  it("never throws, whatever it is given", () => {
    for (const value of [undefined, null, 0, "x", [], {}, { recipe: null, motions: null, palette: null }, { recipe: { extras: 5 }, motions: {}, palette: [] }]) {
      assert.equal(typeof checkBuildBody(value), "string");
    }
  });
});

// ---- the High tier: the same fixtures, the same problem fragments and the same arithmetic as the web app
const HIGH = new URL("./fixtures/recipes/high/", import.meta.url);
const readHigh = (name) => JSON.parse(readFileSync(new URL(name, HIGH), "utf8"));
const highFiles = readdirSync(HIGH);
const validHigh = highFiles.filter((f) => f.endsWith(".json") && !f.startsWith("invalid-") && !f.startsWith("expected"));
const invalidHigh = highFiles.filter((f) => f.startsWith("invalid-"));

const EXPECTED_HIGH_PROBLEM = {
  "invalid-high-no-finishes.json": "recipe.finishes",
  "invalid-high-unknown-finish.json": "recipe.finishes",
  "invalid-high-unknown-detail.json": "recipe.details",
  "invalid-high-five-details.json": "recipe.details",
  "invalid-high-over-triangles.json": "triangles",
  "invalid-standard-with-finishes.json": "recipe.finishes",
  "invalid-quality-word.json": "recipe.quality",
  "invalid-world-standard.json": "recipe.kind",
};

describe("checkBuildBody and the High tier", () => {
  it("accepts every valid High fixture", () => {
    assert.ok(validHigh.length >= 8);
    for (const f of validHigh) assert.equal(checkBuildBody(readHigh(f)), null, f);
  });

  it("refuses every invalid High fixture with the expected problem, and the table has no stragglers", () => {
    assert.deepEqual([...invalidHigh].sort(), Object.keys(EXPECTED_HIGH_PROBLEM).sort());
    for (const f of invalidHigh) {
      const problem = checkBuildBody(readHigh(f));
      assert.notEqual(problem, null, f);
      assert.ok(problem.includes(EXPECTED_HIGH_PROBLEM[f]), `${f}: ${problem}`);
    }
  });

  it("estimates each valid fixture as expected-high.json says (the same numbers the web app computes)", () => {
    const expected = readHigh("expected-high.json");
    assert.deepEqual(Object.keys(expected).sort(), [...validHigh].sort());
    for (const f of validHigh) {
      const { clips, ...counts } = expected[f];
      assert.deepEqual(estimate(readHigh(f).recipe), counts, f);
      assert.ok(Array.isArray(clips));
    }
  });

  it("keeps every stress fixture within its caps", () => {
    for (const kind of MODEL_KINDS) {
      const e = estimate(readHigh(`${kind}-high-stress.json`).recipe);
      const caps = KIT.tiers.high.caps[kind];
      assert.ok(e.parts <= caps.parts && e.triangles <= caps.triangles && e.vertices <= caps.vertices && e.meshes <= caps.meshes, kind);
    }
  });

  it("refuses what is wrong with a High recipe, in the web app's words", () => {
    const changed = (change) => {
      const body = structuredClone(readHigh("biped-high-default.json"));
      change(body);
      return checkBuildBody(body);
    };
    assert.match(changed((b) => (b.recipe.quality = "ultra")), /recipe\.quality/);
    for (const quality of ["High", "", null, 1, true]) assert.match(changed((b) => (b.recipe.quality = quality)), /recipe\.quality/, String(quality));
    assert.match(changed((b) => (b.recipe.finishes = { head: "painted" })), /recipe\.finishes/);
    assert.match(changed((b) => (b.recipe.finishes.head = "chrome")), /recipe\.finishes\.head/);
    assert.match(changed((b) => (b.recipe.finishes = JSON.parse('{"__proto__": "matte", "head": "matte"}'))), /recipe\.finishes/);
    assert.match(changed((b) => (b.recipe.details = "seams")), /recipe\.details/);
    assert.match(changed((b) => (b.recipe.details = ["seams", "seams"])), /recipe\.details/);
    assert.match(changed((b) => (b.recipe.details = ["__proto__"])), /recipe\.details/);
    assert.match(changed((b) => (b.recipe.details = ["constructor"])), /recipe\.details/);
    assert.match(changed((b) => (b.recipe.build.headSize = 2)), /recipe\.build\.headSize/);
    assert.match(changed((b) => (b.recipe.extras = ["wings"])), /recipe\.extras/);
    assert.equal(changed(() => {}), null);
  });

  it("refuses a detail a kind cannot have, and a Standard recipe with finishes or details", () => {
    const blob = structuredClone(readHigh("blob-high-default.json"));
    blob.recipe.details = ["bolts"];
    assert.match(checkBuildBody(blob), /recipe\.details/);
    const standard = structuredClone(read("biped-default.json"));
    assert.equal(checkBuildBody({ ...standard, recipe: { ...standard.recipe, quality: "standard" } }), null);
    assert.match(checkBuildBody({ ...standard, recipe: { ...standard.recipe, details: ["seams"] } }), /recipe\.details/);
    assert.match(checkBuildBody({ ...standard, recipe: { ...standard.recipe, finishes: {} } }), /recipe\.finishes/);
  });

  it("takes a High scenery piece, and a world piece only in High, and gives a world piece no motions", () => {
    const tree = structuredClone(read("scenery-tree.json"));
    const high = { ...tree.recipe, quality: "high", finishes: { ...KIT.tiers.high.defaults.scenery.tree.finishes }, details: [] };
    assert.equal(checkBuildBody({ ...tree, recipe: high }), null);
    assert.match(checkBuildBody({ ...tree, recipe: { ...high, details: ["seams"] } }), /recipe\.details/);

    const world = { version: 1, kind: "world", summary: "", build: { piece: "terrain", style: "desert" }, colors: { ...KIT.tiers.high.worlds.slots }, extras: [], quality: "high", finishes: { ...KIT.tiers.high.defaults.world.finishes }, details: [] };
    const body = { recipe: world, motions: { version: 1, motions: {} }, palette: tree.palette };
    assert.equal(checkBuildBody(body), null);
    const standardWorld = { ...world };
    delete standardWorld.quality;
    delete standardWorld.finishes;
    delete standardWorld.details;
    assert.match(checkBuildBody({ ...body, recipe: standardWorld }), /recipe\.kind/);
    assert.match(checkBuildBody({ ...body, recipe: { ...world, build: { piece: "terrain", style: "tundra" } } }), /recipe\.build\.style/);
    assert.match(checkBuildBody({ ...body, recipe: { ...world, build: { piece: "__proto__", style: "desert" } } }), /recipe\.build\.piece/);
    assert.match(checkBuildBody({ ...body, motions: tree.motions }), /motions\.motions/);
  });

  it("lists a world piece's one joint, and never throws on a hostile High body", () => {
    assert.deepEqual(jointsOf({ kind: "world", build: { piece: "road", style: "meadow" }, extras: [] }), ["root"]);
    for (const value of [{ recipe: { quality: "high" }, motions: {}, palette: [] }, { recipe: { version: 1, kind: "biped", quality: "high", summary: "", build: {}, colors: {}, extras: [] }, motions: {}, palette: [] }]) {
      assert.equal(typeof checkBuildBody(value), "string");
    }
  });
});
