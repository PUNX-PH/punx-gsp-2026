// Writes blender-worker/fixtures/recipes/high/ (the valid and invalid High recipe fixtures and expected-high.json) from the real functions.
// It is a vitest file only so it can import the web app's code: run it with tools/regen-high-fixtures.sh, which copies it next to the other builder
// tests, runs it, and removes the copy.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { CLIPS_FOR_ROLE, KIT, MODEL_KINDS, type ModelKind, SCENERY_KINDS, WORLD_PIECES, WORLD_STYLES } from "@/lib/builder/kinds";
import { type BuildBody, clipsOf, defaultHighRecipe, defaultMotions, defaultRecipe, estimate, fitToBudget, type ModelRecipe, sceneryMotions, sceneryRecipe, worldRecipe } from "@/lib/builder/recipes";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import type { Role } from "@/lib/graph/types";

const DIR = fileURLToPath(new URL("../../../../blender-worker/fixtures/recipes/", import.meta.url));
const OUT = DIR + "high/";
const ROLE_OF: Record<ModelKind, Role> = { biped: "hero", vehicle: "obstacle", blob: "collectible", prop: "collectible" };
const write = (name: string, value: unknown) => writeFileSync(OUT + name, JSON.stringify(value, null, 2) + "\n");
const standardStress = (kind: ModelKind) => JSON.parse(readFileSync(DIR + `${kind}-stress.json`, "utf8")) as BuildBody;

it("writes the High fixtures", () => {
  mkdirSync(OUT, { recursive: true });
  const expected: Record<string, unknown> = {};

  for (const kind of MODEL_KINDS) {
    const recipe = defaultHighRecipe(kind);
    const body: BuildBody = { recipe, motions: defaultMotions(recipe, CLIPS_FOR_ROLE[ROLE_OF[kind]]), palette: [...SAMPLE_PALETTE] };
    write(`${kind}-high-default.json`, body);
    expected[`${kind}-high-default.json`] = { ...estimate(recipe), clips: clipsOf(body.motions) };

    const std = standardStress(kind);
    const allowed = (Object.keys(KIT.tiers.high.details) as (keyof typeof KIT.tiers.high.details)[]).filter((d) => KIT.tiers.high.details[d][kind] !== undefined);
    const heavy: ModelRecipe = { ...std.recipe, quality: "high", finishes: { ...KIT.tiers.high.defaults[kind].finishes }, details: allowed };
    const fitted = fitToBudget(heavy);
    if (!fitted) throw new Error(`${kind} stress does not fit`);
    const stress: BuildBody = { recipe: fitted, motions: std.motions, palette: [...SAMPLE_PALETTE] };
    write(`${kind}-high-stress.json`, stress);
    expected[`${kind}-high-stress.json`] = { ...estimate(fitted), clips: clipsOf(std.motions) };
  }
  for (const kind of SCENERY_KINDS) {
    const recipe = sceneryRecipe(kind, "high");
    const body: BuildBody = { recipe, motions: sceneryMotions(kind), palette: [...SAMPLE_PALETTE] };
    write(`scenery-${kind}-high.json`, body);
    expected[`scenery-${kind}-high.json`] = { ...estimate(recipe), clips: clipsOf(body.motions) };
  }
  for (const piece of WORLD_PIECES) {
    for (const style of WORLD_STYLES) {
      const recipe = worldRecipe(piece, style);
      const body: BuildBody = { recipe, motions: { version: 1, motions: {} }, palette: [...SAMPLE_PALETTE] };
      write(`world-${piece}-${style}.json`, body);
      expected[`world-${piece}-${style}.json`] = { ...estimate(recipe), clips: [] };
    }
  }
  write("expected-high.json", expected);

  // ---- invalid fixtures, each from the default High biped body
  const base = (): BuildBody => JSON.parse(readFileSync(OUT + "biped-high-default.json", "utf8")) as BuildBody;
  const invalid = (name: string, change: (b: BuildBody) => void) => {
    const b = base();
    change(b);
    write(name, b);
  };
  invalid("invalid-high-no-finishes.json", (b) => delete b.recipe.finishes);
  invalid("invalid-high-unknown-finish.json", (b) => (b.recipe.finishes!.head = "chrome" as never));
  invalid("invalid-high-unknown-detail.json", (b) => (b.recipe.details = ["seams", "sparkles"] as never));
  invalid("invalid-high-five-details.json", (b) => (b.recipe.details = ["seams", "bolts", "cables", "lights", "seams"]));
  invalid("invalid-high-over-budget.json", (b) => {
    b.recipe.extras = ["backpack", "antenna"];
    b.recipe.details = ["seams", "bolts", "cables", "lights"];
  });
  invalid("invalid-high-over-meshes.json", (b) => {
    // sixteen joints other than the root, each moved by a track: seventeen meshes, over the biped's fourteen
    const joints = ["spine", "chest", "neck", "head", "upperarm_l", "forearm_l", "hand_l", "upperarm_r", "forearm_r", "hand_r", "thigh_l", "shin_l", "foot_l", "thigh_r", "shin_r", "foot_r"];
    const track = (joint: string) => ({ joint, channel: "rotate" as const, axis: "x" as const, wave: "swing" as const, amplitude: 10, cycles: 1, phase: 0 });
    b.motions = {
      version: 1,
      motions: { run: { seconds: 1, tracks: joints.slice(0, 12).map(track) }, jump: { seconds: 1, tracks: joints.slice(12).map(track) } },
    };
  });
  invalid("invalid-standard-with-finishes.json", (b) => {
    const standard = defaultRecipe("biped");
    b.recipe = { ...standard, finishes: { ...KIT.tiers.high.defaults.biped.finishes } };
  });
  invalid("invalid-quality-word.json", (b) => (b.recipe.quality = "ultra" as never));
  invalid("invalid-world-standard.json", (b) => {
    const world = worldRecipe("terrain", "desert");
    delete world.quality;
    delete world.finishes;
    delete world.details;
    b.recipe = world;
    b.motions = { version: 1, motions: {} };
  });
});
