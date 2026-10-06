import { describe, expect, it } from "vitest";
import { CLIPS_FOR_ROLE, type ClipKey, KIT, type ModelKind } from "@/lib/builder/kinds";
import { checkBuildBody, DEFAULT_ENVIRONMENT, defaultMotions, defaultRecipe, estimate, type ModelRecipe } from "@/lib/builder/recipes";
import { enforceCaps, repairEnvironment, repairModelRecipe, repairMotions } from "@/lib/builder/repair";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";

const ALL: ClipKey[] = ["run", "jump", "loop"];

// A model answer: the kind's defaults with some fields replaced (anything, including the wrong types).
function answer(kind: ModelKind, patch: { build?: Record<string, unknown>; colors?: Record<string, unknown>; extras?: unknown; summary?: unknown; kind?: unknown } = {}) {
  const base = defaultRecipe(kind);
  return { version: 1, kind: patch.kind ?? kind, summary: patch.summary ?? "ok", build: { ...base.build, ...patch.build }, colors: { ...base.colors, ...patch.colors }, extras: patch.extras ?? [] };
}
function repaired(raw: unknown, kind: ModelKind | null): ModelRecipe {
  const r = repairModelRecipe(raw, { kind });
  if (!r.ok) throw new Error("repair failed");
  return r.recipe;
}
// A motion answer for a recipe: clips keyed run/jump/loop, each with seconds and tracks.
const track = (over: Record<string, unknown> = {}) => ({ joint: "hips", channel: "move", axis: "y", wave: "bounce", amplitude: 0.1, cycles: 2, phase: 0, ...over });
const motionAnswer = (clips: Record<string, unknown>) => ({ version: 1, motions: clips });
function motionsOf(recipe: ModelRecipe, raw: unknown, clips: readonly ClipKey[] = ALL) {
  const r = repairMotions(raw, { recipe, clips });
  if (!r.ok) throw new Error("repair failed");
  return r;
}

describe("repairModelRecipe", () => {
  it("clamps build fields into range, rounds whole ones, and takes defaults for the rest", () => {
    const biped = defaultRecipe("biped");
    expect(repaired(answer("biped", { build: { headSize: 9 } }), null).build.headSize).toBe(0.8);
    expect(repaired(answer("biped", { build: { headSize: -1 } }), null).build.headSize).toBe(0.3);
    expect(repaired(answer("vehicle", { build: { wheelCount: 4.6 } }), null).build.wheelCount).toBe(5);
    expect(repaired(answer("prop", { build: { shape: "torus" } }), null).build.shape).toBe("gem");
    expect(repaired(answer("prop", { build: { shape: "ring" } }), null).build.shape).toBe("ring");
    const missing = answer("biped");
    delete (missing.build as Record<string, unknown>).legLength;
    expect(repaired(missing, null).build.legLength).toBe(biped.build.legLength);
    expect(repaired(answer("biped", { build: { headSize: "big", torsoWidth: null, armLength: Number.NaN } }), null).build).toMatchObject({
      headSize: biped.build.headSize, torsoWidth: biped.build.torsoWidth, armLength: biped.build.armLength,
    });
    expect(repaired(answer("biped", { build: { wings: 3 } }), null).build).not.toHaveProperty("wings");
  });

  it("rounds and clamps color slots", () => {
    expect(repaired(answer("biped", { colors: { head: 7.2 } }), null).colors.head).toBe(4);
    expect(repaired(answer("biped", { colors: { head: -3 } }), null).colors.head).toBe(0);
    expect(repaired(answer("biped", { colors: { head: 1.6 } }), null).colors.head).toBe(2);
    expect(repaired(answer("biped", { colors: { head: "red" } }), null).colors.head).toBe(defaultRecipe("biped").colors.head);
  });

  it("with Auto an unknown kind fails; a chosen kind wins over what the answer says", () => {
    expect(repairModelRecipe(answer("biped", { kind: "dragon" }), { kind: null }).ok).toBe(false);
    expect(repairModelRecipe(answer("biped", { kind: 7 }), { kind: null }).ok).toBe(false);
    expect(repaired(answer("blob", { kind: "dragon" }), "blob").kind).toBe("blob");
  });

  it("keeps the first two allowed extras and drops the rest", () => {
    expect(repaired(answer("biped", { extras: ["wings", "tail", "tail", "hat", "ears"] }), null).extras).toEqual(["tail", "hat"]);
    expect(repaired(answer("vehicle", { extras: ["tail", "antenna"] }), null).extras).toEqual(["antenna"]);
    expect(repaired(answer("prop", { extras: ["tail"] }), null).extras).toEqual([]);
    expect(repaired(answer("biped", { extras: "tail" }), null).extras).toEqual([]);
  });

  it("cleans the summary: control characters become spaces, trimmed, at most 140 characters", () => {
    const messy = "a\nb\u0000c" + "x".repeat(200);
    const summary = repaired(answer("biped", { summary: messy }), null).summary;
    expect(Array.from(summary)).toHaveLength(140);
    expect(/[\u0000-\u001f\u007f]/.test(summary)).toBe(false);
    expect(summary.startsWith("a b c")).toBe(true);
    expect(repaired(answer("biped", { summary: 7 }), null).summary).toBe("");
    expect(repaired(answer("biped", { summary: "  hi  " }), null).summary).toBe("hi");
  });

  it("fails on anything that is not an object", () => {
    for (const raw of [null, "text", [], 4, undefined]) expect(repairModelRecipe(raw, { kind: "biped" }).ok).toBe(false);
  });

  it("every repaired recipe passes the strict check with the kit's own motions", () => {
    const cases = [answer("biped", { build: { headSize: 9 }, extras: ["tail", "hat"] }), answer("vehicle", { build: { wheelCount: 9.4, cabSize: -2 } }), answer("blob", { colors: { eyes: 99 } }), answer("prop", { build: { shape: "x", size: 5 } })];
    for (const raw of cases) {
      const recipe = repaired(raw, null);
      expect(checkBuildBody({ recipe, motions: defaultMotions(recipe, ALL), palette: [...SAMPLE_PALETTE] }), recipe.kind).toBeNull();
    }
  });
});

describe("enforceCaps", () => {
  const biped = (extras: ModelRecipe["extras"]): ModelRecipe => ({ ...defaultRecipe("biped"), extras });

  it("leaves a recipe within the caps alone", () => {
    expect(enforceCaps(biped(["tail", "hat"]))).toEqual(biped(["tail", "hat"]));
  });

  it("drops extras from the end until the recipe fits", () => {
    // a biped is 15 parts, a tail 2, a hat 1: with 17 parts allowed the hat goes and the tail stays
    expect(enforceCaps(biped(["tail", "hat"]), { parts: 17, triangles: 2000 })?.extras).toEqual(["tail"]);
    expect(enforceCaps(biped(["tail", "hat"]), { parts: 15, triangles: 2000 })?.extras).toEqual([]);
  });

  it("gives null when it is still over with no extras left", () => {
    expect(enforceCaps(biped(["tail"]), { parts: 10, triangles: 2000 })).toBeNull();
    expect(enforceCaps(biped([]), { parts: 24, triangles: 100 })).toBeNull();
  });

  it("does not change the recipe it was given", () => {
    const given = biped(["tail", "hat"]);
    enforceCaps(given, { parts: 15, triangles: 2000 });
    expect(given.extras).toEqual(["tail", "hat"]);
  });
});

describe("repairMotions", () => {
  const biped = defaultRecipe("biped");

  it("keeps the first 12 of 20 valid tracks", () => {
    const tracks = Array.from({ length: 20 }, (_, i) => track({ phase: i / 20 }));
    expect(motionsOf(biped, motionAnswer({ run: { seconds: 0.6, tracks } }), ["run"]).motions.motions.run?.tracks).toHaveLength(12);
  });

  it("rounds run and loop cycles to whole numbers and leaves jump alone", () => {
    const m = (cycles: number) => ({ seconds: 1, tracks: [track({ cycles })] });
    const r = motionsOf(biped, motionAnswer({ run: m(2.6), jump: m(2.6), loop: m(0.4) })).motions.motions;
    expect(r.run?.tracks[0].cycles).toBe(3);
    expect(r.jump?.tracks[0].cycles).toBe(2.6);
    expect(r.loop?.tracks[0].cycles).toBe(1);
  });

  it("clamps amplitude to its channel, seconds, and phase", () => {
    const r = motionsOf(biped, motionAnswer({ run: { seconds: 99, tracks: [track({ channel: "rotate", axis: "x", wave: "swing", amplitude: 200, phase: 7 }), track({ amplitude: 3 })] } }), ["run"]).motions.motions.run!;
    expect(r.seconds).toBe(3);
    expect(r.tracks.map((t) => t.amplitude)).toEqual([90, 0.5]);
    expect(r.tracks[0].phase).toBe(1);
    expect(motionsOf(biped, motionAnswer({ run: { seconds: 0.01, tracks: [track()] } }), ["run"]).motions.motions.run?.seconds).toBe(0.3);
  });

  it("drops bad tracks silently: spin on move, unknown axis, channel or wave, odd types", () => {
    const bad = [track({ wave: "spin" }), track({ axis: "w" }), track({ channel: "location" }), track({ wave: "wobble" }), track({ amplitude: "big" }), 7, null, track({ joint: 3 })];
    const good = track({ joint: "head", channel: "rotate", axis: "y", wave: "swing", amplitude: 10 });
    const r = motionsOf(biped, motionAnswer({ loop: { seconds: 1, tracks: [...bad, good] } }), ["loop"]);
    expect(r.motions.motions.loop?.tracks).toEqual([{ ...good, cycles: 2 }]);
    expect(r.skipped).toEqual([]);
  });

  it("drops a track on a joint the model lacks and reports it once", () => {
    const blob = defaultRecipe("blob");
    const r = motionsOf(blob, motionAnswer({ loop: { seconds: 1, tracks: [track({ joint: "tail_1" }), track({ joint: "tail_1", phase: 0.5 }), track({ joint: "body" })] } }), ["loop"]);
    expect(r.skipped).toEqual([{ clip: "Loop", joint: "tail_1" }]);
    expect(r.motions.motions.loop?.tracks.map((t) => t.joint)).toEqual(["body"]);
  });

  it("a clip whose every track names a missing joint takes the default and keeps its skipped entries", () => {
    const blob = defaultRecipe("blob");
    const r = motionsOf(blob, motionAnswer({ loop: { seconds: 1, tracks: [track({ joint: "tail_1" })] } }), ["loop"]);
    expect(r.motions.motions.loop).toEqual(defaultMotions(blob, ["loop"]).motions.loop);
    expect(r.skipped).toEqual([{ clip: "Loop", joint: "tail_1" }]);
  });

  it("a hostile joint name is cleaned and cut in the skipped entry", () => {
    const r = motionsOf(defaultRecipe("blob"), motionAnswer({ loop: { seconds: 1, tracks: [track({ joint: "a\u0000b" + "z".repeat(80) })] } }), ["loop"]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].joint).toBe(("ab" + "z".repeat(80)).slice(0, 40));
  });

  it("ignores clips it was not asked for, and fills a missing asked clip with the default", () => {
    const r = motionsOf(biped, motionAnswer({ loop: { seconds: 1, tracks: [track()] } }), ["run", "jump"]);
    expect(Object.keys(r.motions.motions)).toEqual(["run", "jump"]);
    expect(r.motions.motions.run).toEqual(defaultMotions(biped, ["run"]).motions.run);
  });

  it("fails when the answer or its motions are not objects", () => {
    for (const raw of [null, "x", [], motionAnswer(null as never), { version: 1 }]) expect(repairMotions(raw, { recipe: biped, clips: ALL }).ok).toBe(false);
  });

  it("every repaired motion set passes the strict check", () => {
    const messy = motionAnswer({
      run: { seconds: 50, tracks: [track({ cycles: 2.6, amplitude: 9, joint: "thigh_l", channel: "rotate", axis: "x", wave: "swing" }), track({ joint: "nope" })] },
      jump: "nothing",
      loop: { seconds: "x", tracks: "none" },
    });
    for (const role of ["hero", "obstacle"] as const) {
      const clips = CLIPS_FOR_ROLE[role];
      const r = motionsOf(biped, messy, clips);
      expect(checkBuildBody({ recipe: biped, motions: r.motions, palette: [...SAMPLE_PALETTE] }), role).toBeNull();
    }
  });
});

describe("repairEnvironment", () => {
  const meadow = { version: 1, sky: 0, field: 3, stripe: 4, scenery: ["tree", "windmill", "rock"] };
  const design = (raw: unknown) => {
    const r = repairEnvironment(raw);
    if (!r.ok) throw new Error("repair failed");
    return r.design;
  };

  it("has the meadow as its default", () => {
    expect(DEFAULT_ENVIRONMENT).toEqual(meadow);
  });

  it("keeps a good answer and adds the version", () => {
    expect(design({ sky: 1, field: 2, stripe: 0, scenery: ["pine", "lamp"] })).toEqual({ version: 1, sky: 1, field: 2, stripe: 0, scenery: ["pine", "lamp"] });
  });

  it.each([
    ["sky: 7", { sky: 7 }, "sky", 4],
    ["field: 1.6", { field: 1.6 }, "field", 2],
    ["stripe: -3", { stripe: -3 }, "stripe", 0],
    ["sky: 0.4", { sky: 0.4 }, "sky", 0],
    ["sky as text", { sky: "red" }, "sky", 0],
    ["field as null", { field: null }, "field", 3],
    ["stripe missing", {}, "stripe", 4],
    ["sky: NaN", { sky: Number.NaN }, "sky", 0],
    ["sky: Infinity", { sky: Number.POSITIVE_INFINITY }, "sky", 0],
  ] as const)("clamps and rounds each index, and a non-number takes the meadow's (%s)", (_label, patch, key, wanted) => {
    expect(design({ scenery: ["tree"], ...patch })[key]).toBe(wanted);
  });

  it.each([
    ["unknown kinds and repeats are dropped and the first three kept", ["tree", "castle", "tree", "rock", "lamp", "pine"], ["tree", "rock", "lamp"]],
    ["only unknown kinds takes the meadow's three", ["castle"], ["tree", "windmill", "rock"]],
    ["an empty list takes the meadow's three", [], ["tree", "windmill", "rock"]],
    ["no list takes the meadow's three", undefined, ["tree", "windmill", "rock"]],
    ["a list that is not a list takes the meadow's three", "tree", ["tree", "windmill", "rock"]],
    ["names that are not kinds, however hostile, are just dropped", ["__proto__", "constructor", "toString", "pine", 7, null], ["pine"]],
    ["a kind in the wrong case is not a kind", ["Tree", "TREE", "cactus"], ["cactus"]],
  ])("scenery: %s", (_label, scenery, wanted) => {
    expect(design({ sky: 0, field: 3, stripe: 4, scenery }).scenery).toEqual(wanted);
  });

  it("fails for what is not an object", () => {
    for (const raw of [null, undefined, "meadow", 4, ["tree"]]) expect(repairEnvironment(raw)).toEqual({ ok: false });
  });

  it("takes an object with nothing useful in it to the whole meadow", () => {
    expect(design({})).toEqual(meadow);
  });

  it("never changes what it was given", () => {
    const raw = Object.freeze({ sky: 9, field: 1, stripe: 1, scenery: Object.freeze(["tree", "x"]) });
    expect(() => repairEnvironment(raw)).not.toThrow();
  });
});

describe("repairModelRecipe in the High tier", () => {
  const high = (raw: unknown, kind: ModelKind | null = "biped") => {
    const r = repairModelRecipe(raw, { kind, quality: "high" });
    if (!r.ok) throw new Error("repair failed");
    return r.recipe;
  };
  const defaults = KIT.tiers.high.defaults;
  const answerWith = (kind: ModelKind, extra: Record<string, unknown>) => ({ ...answer(kind), ...extra });

  it("makes a High recipe: the quality, a finish for each slot and the details", () => {
    const recipe = high(answerWith("biped", { finishes: { ...defaults.biped.finishes, head: "glow" }, details: ["seams", "lights"] }));
    expect(recipe.quality).toBe("high");
    expect(recipe.finishes).toEqual({ ...defaults.biped.finishes, head: "glow" });
    expect(recipe.details).toEqual(["seams", "lights"]);
    expect(checkBuildBody({ recipe, motions: defaultMotions(recipe, ["run", "jump"]), palette: [...SAMPLE_PALETTE] })).toBeNull();
  });

  it("gives an unknown finish the default of the kit for that slot, and every slot a finish", () => {
    const recipe = high(answerWith("biped", { finishes: { head: "chrome", body: "glow", arms: 7, legs: null, wings: "metal" } }));
    expect(recipe.finishes).toEqual({ ...defaults.biped.finishes, body: "glow" });
    expect(Object.keys(recipe.finishes!).sort()).toEqual(Object.keys(KIT.kinds.biped.slots).sort());
  });

  it.each([["nothing", undefined], ["a list", ["metal"]], ["text", "metal"], ["null", null]])("takes every default finish when finishes is %s", (_label, finishes) => {
    expect(high(answerWith("vehicle", { finishes }), "vehicle").finishes).toEqual(defaults.vehicle.finishes);
  });

  it("drops unknown details and ones the kind cannot have, removes duplicates and keeps the first four", () => {
    expect(high(answerWith("biped", { details: ["seams", "sparkles", "seams", "bolts", "cables", "lights", "lights"] })).details).toEqual(["seams", "bolts", "cables", "lights"]);
    expect(high(answerWith("blob", { details: ["bolts", "lights", "cables", 3, "seams"] }), "blob").details).toEqual(["lights", "seams"]);
    expect(high(answerWith("prop", { details: ["lights", "bolts"] }), "prop").details).toEqual(["bolts"]);
  });

  it("takes the default details when Claude gives none, and keeps an empty list as empty", () => {
    expect(high(answerWith("biped", { details: undefined })).details).toEqual(defaults.biped.details);
    expect(high(answerWith("biped", { details: "seams" })).details).toEqual(defaults.biped.details);
    expect(high(answerWith("biped", { details: [] })).details).toEqual([]);
  });

  it("brings a recipe over budget within it, dropping cables first", () => {
    const recipe = high(answerWith("biped", { extras: ["hat"], details: ["seams", "bolts", "cables", "lights"] }));
    expect(recipe.details).toEqual(["seams", "bolts", "lights"]);
    expect(recipe.extras).toEqual(["hat"]);
    const heavier = high(answerWith("biped", { extras: ["backpack", "ears"], details: ["seams", "bolts", "cables", "lights"] }));
    expect(heavier.details).toEqual(["seams", "lights"]);
  });

  it("is not held to Standard caps: a default High biped has more than 24 parts and 2,000 triangles", () => {
    expect(estimate(high(answer("biped"))).parts).toBeGreaterThan(KIT.caps.parts);
    expect(estimate(high(answer("biped"))).triangles).toBeGreaterThan(KIT.caps.triangles);
  });

  it("with Auto takes the kind from the answer and still makes a High recipe; an unknown kind still fails", () => {
    expect(high(answer("blob"), null).kind).toBe("blob");
    expect(repairModelRecipe({ ...answer("blob"), kind: "dragon" }, { kind: null, quality: "high" })).toEqual({ ok: false });
  });

  it("repairs the build and the colors exactly as Standard does", () => {
    const recipe = high(answer("biped", { build: { headSize: 9 }, colors: { head: 7.2 } }));
    expect(recipe.build.headSize).toBe(0.8);
    expect(recipe.colors.head).toBe(4);
  });

  it("is deterministic: the same raw answer twice gives deep-equal recipes", () => {
    const raw = answerWith("biped", { extras: ["backpack", "ears", "hat"], details: ["cables", "seams", "bolts", "lights"], finishes: { head: "metal", legs: "x" } });
    expect(high(raw)).toEqual(high(raw));
    expect(high(JSON.parse(JSON.stringify(raw)))).toEqual(high(raw));
  });

  it("leaves Standard exactly as it was: no quality, finishes or details keys, and the Standard caps", () => {
    const r = repairModelRecipe(answerWith("biped", { finishes: { head: "glow" }, details: ["seams"] }), { kind: "biped" });
    expect(r.ok && "quality" in r.recipe).toBe(false);
    expect(r.ok && "finishes" in r.recipe).toBe(false);
    expect(r.ok && "details" in r.recipe).toBe(false);
    const standard = repairModelRecipe(answerWith("biped", { extras: ["tail", "ears", "hat"] }), { kind: "biped", quality: "standard" });
    expect(standard.ok && standard.recipe.extras).toEqual(["tail", "ears"]);
  });

  it("never changes what it was given", () => {
    const raw = Object.freeze({ ...answer("biped"), details: Object.freeze(["seams", "bolts"]), finishes: Object.freeze({ head: "glow" }), extras: Object.freeze(["tail"]) });
    expect(() => repairModelRecipe(raw, { kind: "biped", quality: "high" })).not.toThrow();
  });
});
