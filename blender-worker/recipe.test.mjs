// The worker's own check of a build body: the same rules, fixtures and problem fragments as web/src/lib/builder/recipes.test.ts, so the two
// sides accept and refuse exactly the same recipes.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { hostileBodies } from "./fixtures/hostile-bodies.mjs";
import { checkBuildBody, jointsOf, KIT } from "./recipe.mjs";

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

  it("never throws, whatever it is given", () => {
    for (const value of [undefined, null, 0, "x", [], {}, { recipe: null, motions: null, palette: null }, { recipe: { extras: 5 }, motions: {}, palette: [] }]) {
      assert.equal(typeof checkBuildBody(value), "string");
    }
  });
});
