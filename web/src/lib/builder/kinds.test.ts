import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AXES,
  CHANNELS,
  CLIP_KEYS,
  CLIP_NAMES,
  CLIPS_FOR_ROLE,
  DETAILS,
  DROP_ORDER,
  EXTRAS,
  FINISH_VALUES,
  FINISHES,
  KIND_NAMES,
  KIT,
  MODEL_KINDS,
  PROP_SHAPES,
  QUALITIES,
  SCENERY_KINDS,
  SCENERY_NAMES,
  tierCaps,
  WAVES,
  WORLD_PIECES,
  WORLD_STYLES,
  type BuildField,
  type ClipKey,
  type ModelKind,
  type SceneryKind,
} from "@/lib/builder/kinds";

// web/src/lib/builder -> the repository root is four levels up.
const KIT_FILE = fileURLToPath(new URL("../../../../blender-worker/scripts/kit.json", import.meta.url));

const BIPED_JOINTS = [
  "hips", "spine", "chest", "neck", "head",
  "upperarm_l", "forearm_l", "hand_l", "upperarm_r", "forearm_r", "hand_r",
  "thigh_l", "shin_l", "foot_l", "thigh_r", "shin_r", "foot_r",
];

// Every joint name a default motion of this kind may mention (a vehicle's wheels follow a rule in code, so up to six).
function jointNames(kind: ModelKind): string[] {
  const listed = KIT.kinds[kind].joints.map(([name]) => name);
  return kind === "vehicle" ? [...listed, ...[1, 2, 3, 4, 5, 6].map((n) => `wheel_${n}`)] : listed;
}

const isNumberField = (f: BuildField): f is Extract<BuildField, { min: number }> => "min" in f;

describe("the kit", () => {
  it("KIT is exactly blender-worker/scripts/kit.json", () => {
    expect(JSON.parse(readFileSync(KIT_FILE, "utf8"))).toEqual(KIT);
  });

  it("every default lies in its range, every whole default is whole, every choice default is a choice", () => {
    for (const kind of MODEL_KINDS) {
      for (const [name, field] of Object.entries(KIT.kinds[kind].build)) {
        if (isNumberField(field)) {
          expect(field.default, `${kind}.${name}`).toBeGreaterThanOrEqual(field.min);
          expect(field.default, `${kind}.${name}`).toBeLessThanOrEqual(field.max);
          if (field.whole) expect(Number.isInteger(field.default), `${kind}.${name}`).toBe(true);
        } else {
          expect(field.choices, `${kind}.${name}`).toContain(field.default);
        }
      }
    }
    expect(KIT.kinds.prop.build.shape).toEqual({ choices: [...PROP_SHAPES], default: "gem" });
  });

  it("every slot default is a whole number 0 to 4", () => {
    for (const kind of MODEL_KINDS) {
      for (const [slot, value] of Object.entries(KIT.kinds[kind].slots)) {
        expect(Number.isInteger(value) && value >= 0 && value <= 4, `${kind}.${slot}`).toBe(true);
      }
    }
  });

  it("the biped's joints are the 17 names in order and every parent comes before its child", () => {
    expect(KIT.kinds.biped.joints.map(([name]) => name)).toEqual(BIPED_JOINTS);
    for (const kind of MODEL_KINDS) {
      const seen = new Set<string>();
      for (const [name, parent] of KIT.kinds[kind].joints) {
        if (parent !== null) expect(seen.has(parent), `${kind}.${name} before its parent ${parent}`).toBe(true);
        seen.add(name);
      }
    }
  });

  it("every default motion is within range and mentions only joints of its kind", () => {
    const { motion, caps } = KIT;
    for (const kind of MODEL_KINDS) {
      const names = new Set(jointNames(kind));
      for (const clip of CLIP_KEYS) {
        const m = KIT.kinds[kind].motions[clip];
        const where = `${kind}.${clip}`;
        expect(m.seconds, where).toBeGreaterThanOrEqual(motion.seconds[0]);
        expect(m.seconds, where).toBeLessThanOrEqual(motion.seconds[1]);
        expect(m.tracks.length, where).toBeGreaterThan(0);
        expect(m.tracks.length, where).toBeLessThanOrEqual(caps.tracks);
        for (const t of m.tracks) {
          expect(names.has(t.joint), `${where}: ${t.joint}`).toBe(true);
          expect(CHANNELS).toContain(t.channel);
          expect(AXES).toContain(t.axis);
          expect(WAVES).toContain(t.wave);
          if (t.wave === "spin") expect(t.channel, `${where}: spin only on rotate`).toBe("rotate");
          const [lo, hi] = motion.amplitude[t.channel];
          expect(t.amplitude, where).toBeGreaterThanOrEqual(lo);
          expect(t.amplitude, where).toBeLessThanOrEqual(hi);
          expect(t.cycles, where).toBeGreaterThanOrEqual(motion.cycles[0]);
          expect(t.cycles, where).toBeLessThanOrEqual(motion.cycles[1]);
          expect(t.phase, where).toBeGreaterThanOrEqual(motion.phase[0]);
          expect(t.phase, where).toBeLessThanOrEqual(motion.phase[1]);
        }
      }
    }
  });

  it("every run and loop default has whole cycles, so the clip loops seamlessly", () => {
    for (const kind of MODEL_KINDS) {
      for (const clip of ["run", "loop"] as ClipKey[]) {
        for (const t of KIT.kinds[kind].motions[clip].tracks) {
          expect(Number.isInteger(t.cycles), `${kind}.${clip}: ${t.joint} cycles ${t.cycles}`).toBe(true);
        }
      }
    }
  });

  it("every allowed extra's anchor resolves for its kind", () => {
    for (const kind of MODEL_KINDS) {
      const spec = KIT.kinds[kind];
      for (const extra of spec.extras) {
        expect(EXTRAS).toContain(extra);
        const own = new Set<string>();
        for (const [name, parent] of KIT.extras[extra].joints) {
          if (parent.startsWith("@")) expect(spec.anchors[parent.slice(1)], `${kind}.${extra}: ${parent}`).toBeTruthy();
          else expect(own.has(parent), `${kind}.${extra}: ${parent} before ${name}`).toBe(true);
          own.add(name);
        }
      }
    }
    expect(KIT.kinds.biped.extras).toEqual([...EXTRAS]);
    expect(KIT.kinds.prop.extras).toEqual([]);
  });

  it("the names a person sees are the ones in the plan", () => {
    expect(KIND_NAMES).toEqual({ biped: "Two-legged character", vehicle: "Wheeled vehicle", blob: "Bouncy blob", prop: "Simple prop" });
    expect(SCENERY_NAMES).toEqual({ tree: "Tree", pine: "Pine", rock: "Rock", cactus: "Cactus", windmill: "Windmill", lamp: "Lamp" });
    expect([...SCENERY_KINDS]).toEqual(["tree", "pine", "rock", "cactus", "windmill", "lamp"]);
    expect(CLIP_NAMES).toEqual({ run: "Run", jump: "Jump", loop: "Loop" });
    expect(CLIPS_FOR_ROLE).toEqual({ hero: ["run", "jump"], obstacle: ["loop"], collectible: ["loop"] });
  });
});

describe("the scenery kit", () => {
  const sceneryJoints = (kind: SceneryKind) => KIT.scenery[kind].joints.map(([name]) => name);

  it("has an entry for each of the six pieces, and nothing else", () => {
    expect(Object.keys(KIT.scenery)).toEqual([...SCENERY_KINDS]);
  });

  it("every piece starts at a root, lists parents before children, and has slots 0 to 4, a height and counts within the scenery cap", () => {
    for (const kind of SCENERY_KINDS) {
      const entry = KIT.scenery[kind];
      expect(entry.joints[0], kind).toEqual(["root", null]);
      const seen = new Set<string>();
      for (const [name, parent] of entry.joints) {
        if (parent !== null) expect(seen.has(parent), `${kind}: ${parent} before ${name}`).toBe(true);
        seen.add(name);
      }
      for (const [slot, index] of Object.entries(entry.slots)) {
        expect(Number.isInteger(index) && index >= 0 && index <= 4, `${kind}.${slot}`).toBe(true);
      }
      expect(entry.height, kind).toBeGreaterThan(0);
      expect(entry.count.parts, kind).toBeGreaterThanOrEqual(1);
      expect(entry.count.parts, kind).toBeLessThanOrEqual(KIT.caps.parts);
      expect(entry.count.triangles, kind).toBeGreaterThanOrEqual(1);
      expect(entry.count.triangles, kind).toBeLessThanOrEqual(KIT.caps.sceneryTriangles);
    }
  });

  it("the heights, slots and joints are the ones in the plan (canopies and the cactus take slot 1, not the default meadow field's slot 3)", () => {
    expect(Object.fromEntries(SCENERY_KINDS.map((kind) => [kind, KIT.scenery[kind].height]))).toEqual({ tree: 3.5, pine: 4.5, rock: 1.2, cactus: 2.2, windmill: 6, lamp: 3.2 });
    expect(Object.fromEntries(SCENERY_KINDS.map((kind) => [kind, KIT.scenery[kind].slots]))).toEqual({
      tree: { main: 1, detail: 2 },
      pine: { main: 1, detail: 2 },
      rock: { main: 2, detail: 2 },
      cactus: { main: 1, detail: 2 },
      windmill: { main: 4, detail: 1 },
      lamp: { main: 2, detail: 4 },
    });
    expect(sceneryJoints("tree")).toEqual(["root", "canopy"]);
    expect(sceneryJoints("pine")).toEqual(["root", "canopy"]);
    expect(sceneryJoints("windmill")).toEqual(["root", "blades"]);
    for (const kind of ["rock", "cactus", "lamp"] as const) expect(sceneryJoints(kind), kind).toEqual(["root"]);
  });

  it("only the tree, the pine and the windmill move: a Loop of whole cycles on their own joints, within the kit's ranges", () => {
    for (const kind of SCENERY_KINDS) {
      const loop = KIT.scenery[kind].loop;
      if (!["tree", "pine", "windmill"].includes(kind)) {
        expect(loop, kind).toBeNull();
        continue;
      }
      expect(loop, kind).not.toBeNull();
      expect(loop!.seconds).toBeGreaterThanOrEqual(KIT.motion.seconds[0]);
      expect(loop!.seconds).toBeLessThanOrEqual(KIT.motion.seconds[1]);
      expect(loop!.tracks.length).toBeGreaterThan(0);
      expect(loop!.tracks.length).toBeLessThanOrEqual(KIT.caps.tracks);
      for (const track of loop!.tracks) {
        expect(sceneryJoints(kind), `${kind}: ${track.joint}`).toContain(track.joint);
        expect(Number.isInteger(track.cycles), `${kind} cycles`).toBe(true);
        const [low, high] = KIT.motion.amplitude[track.channel];
        expect(track.amplitude).toBeGreaterThanOrEqual(low);
        expect(track.amplitude).toBeLessThanOrEqual(high);
        if (track.wave === "spin") expect(track.channel).toBe("rotate");
      }
    }
    expect(KIT.scenery.tree.loop).toEqual({
      seconds: 2.4,
      tracks: [
        { joint: "canopy", channel: "rotate", axis: "x", wave: "swing", amplitude: 4, cycles: 1, phase: 0 },
        { joint: "canopy", channel: "rotate", axis: "z", wave: "swing", amplitude: 3, cycles: 1, phase: 0.25 },
      ],
    });
    expect(KIT.scenery.pine.loop).toEqual({ seconds: 2.8, tracks: [{ joint: "canopy", channel: "rotate", axis: "x", wave: "swing", amplitude: 3, cycles: 1, phase: 0 }] });
    expect(KIT.scenery.windmill.loop).toEqual({ seconds: 2, tracks: [{ joint: "blades", channel: "rotate", axis: "z", wave: "spin", amplitude: 1, cycles: 1, phase: 0 }] });
  });
});

describe("the High tier", () => {
  const high = KIT.tiers.high;
  const budgetOf = (b: { triangles: number; vertices: number; parts: number; meshes: number }) => [b.triangles, b.vertices, b.parts, b.meshes];

  it("has the budgets of the spec", () => {
    expect(budgetOf(high.caps.biped)).toEqual([12000, 9500, 80, 14]);
    expect(budgetOf(high.caps.vehicle)).toEqual([6000, 4800, 50, 10]);
    expect(budgetOf(high.caps.blob)).toEqual([5000, 4000, 30, 6]);
    expect(budgetOf(high.caps.prop)).toEqual([3500, 2800, 24, 5]);
    expect(budgetOf(high.caps.scenery)).toEqual([1500, 1200, 24, 3]);
    expect(high.caps.world).toEqual({ terrain: { triangles: 8000, vertices: 4200 }, road: { triangles: 1500, vertices: 1200 }, backdrop: { triangles: 1200, vertices: 700 } });
    expect(high.caps.materials).toBe(7);
    expect(high.caps.details).toBe(4);
  });

  it("has the five finishes with the plan's metallic, roughness and emission", () => {
    expect(QUALITIES).toEqual(["standard", "high"]);
    expect(FINISHES).toEqual(["matte", "painted", "metal", "rubber", "glow"]);
    expect(FINISH_VALUES).toEqual({
      matte: { metallic: 0, roughness: 0.85, emission: 0 },
      painted: { metallic: 0, roughness: 0.35, emission: 0 },
      metal: { metallic: 0.9, roughness: 0.3, emission: 0 },
      rubber: { metallic: 0, roughness: 0.9, emission: 0 },
      glow: { metallic: 0, roughness: 0.5, emission: 1 },
    });
  });

  it("has four details, dropped in the order cables, bolts, seams, lights", () => {
    expect(DETAILS).toEqual(["seams", "bolts", "cables", "lights"]);
    expect(DROP_ORDER).toEqual(["cables", "bolts", "seams", "lights"]);
    expect([...WORLD_PIECES]).toEqual(["terrain", "road", "backdrop"]);
    expect([...WORLD_STYLES]).toEqual(["desert", "meadow"]);
  });

  it("gives every kind default finishes for exactly its color slots, each a known finish, and default details it may have", () => {
    for (const kind of MODEL_KINDS) {
      const defaults = high.defaults[kind];
      expect(Object.keys(defaults.finishes).sort(), kind).toEqual(Object.keys(KIT.kinds[kind].slots).sort());
      for (const finish of Object.values(defaults.finishes)) expect(FINISHES).toContain(finish);
      expect(new Set(defaults.details).size, kind).toBe(defaults.details.length);
      for (const detail of defaults.details) expect(high.details[detail][kind], `${kind} ${detail}`).toBeDefined();
    }
    for (const piece of SCENERY_KINDS) {
      expect(Object.keys(high.defaults.scenery[piece].finishes).sort(), piece).toEqual(Object.keys(KIT.scenery[piece].slots).sort());
      for (const finish of Object.values(high.defaults.scenery[piece].finishes)) expect(FINISHES).toContain(finish);
    }
    expect(Object.keys(high.defaults.world.finishes).sort()).toEqual(["accent", "far", "ground"]);
    expect(Object.keys(high.worlds.slots).sort()).toEqual(["accent", "far", "ground"]);
  });

  it("lets only the kinds that can carry a detail have it, and never a scenery piece or a world piece", () => {
    for (const detail of DETAILS) {
      const kinds = Object.keys(high.details[detail]);
      expect(kinds.length, detail).toBeGreaterThan(0);
      for (const kind of kinds) expect(MODEL_KINDS as readonly string[], `${detail}: ${kind}`).toContain(kind);
    }
  });

  it("keeps every base model within its caps, and its vertices within what its triangles can share", () => {
    const within = (what: string, b: { triangles: number; vertices: number; parts: number; meshes: number }, caps: { triangles: number; vertices: number; parts: number; meshes: number }) => {
      expect(b.triangles, `${what} triangles`).toBeLessThanOrEqual(caps.triangles);
      expect(b.vertices, `${what} vertices`).toBeLessThanOrEqual(caps.vertices);
      expect(b.parts, `${what} parts`).toBeLessThanOrEqual(caps.parts);
      expect(b.meshes, `${what} meshes`).toBeLessThanOrEqual(caps.meshes);
      expect(b.vertices, `${what} vertices per triangle`).toBeLessThanOrEqual(b.triangles); // shared vertices: far fewer than 3 a triangle
    };
    within("biped", high.base.biped, high.caps.biped);
    const vehicle = high.base.vehicle;
    const sixWheeler = {
      triangles: vehicle.triangles + vehicle.cab.triangles + 6 * vehicle.wheel.triangles,
      vertices: vehicle.vertices + vehicle.cab.vertices + 6 * vehicle.wheel.vertices,
      parts: vehicle.parts + vehicle.cab.parts + 6 * vehicle.wheel.parts,
      meshes: vehicle.meshes + vehicle.cab.meshes + 6 * vehicle.wheel.meshes,
    };
    within("vehicle with a cab and six wheels", sixWheeler, high.caps.vehicle);
    within("blob", high.base.blob, high.caps.blob);
    for (const [shape, base] of Object.entries(high.base.prop.shapes)) within(`prop ${shape}`, base, high.caps.prop);
    for (const [piece, base] of Object.entries(high.base.scenery)) within(`scenery ${piece}`, base, high.caps.scenery);
    for (const piece of WORLD_PIECES) {
      expect(high.base.world[piece].triangles, piece).toBeLessThanOrEqual(high.caps.world[piece].triangles);
      expect(high.base.world[piece].vertices, piece).toBeLessThanOrEqual(high.caps.world[piece].vertices);
    }
    expect(Object.keys(high.base.prop.shapes).sort()).toEqual([...PROP_SHAPES].sort());
    expect(Object.keys(high.base.scenery).sort()).toEqual([...SCENERY_KINDS].sort());
  });

  it("can be over a cap only by piling on extras and details: the base alone and the default details always fit", () => {
    const biped = high.base.biped;
    const defaults = high.defaults.biped.details.map((d) => high.details[d].biped!);
    const biggest = (Object.keys(high.extras) as (keyof typeof high.extras)[]).sort((a, b) => high.extras[b].triangles - high.extras[a].triangles).slice(0, 2);
    const triangles = biped.triangles + biggest.reduce((sum, e) => sum + high.extras[e].triangles, 0) + defaults.reduce((sum, d) => sum + d.triangles, 0);
    expect(triangles).toBeLessThanOrEqual(high.caps.biped.triangles);
    const everything = triangles - defaults.reduce((sum, d) => sum + d.triangles, 0) + DETAILS.reduce((sum, d) => sum + (high.details[d].biped?.triangles ?? 0), 0);
    expect(everything, "two big extras and all four details is the case the budget fit exists for").toBeGreaterThan(high.caps.biped.triangles);
  });

  it("tierCaps gives the High caps, and Standard's own parts and triangles with no vertex or mesh limit", () => {
    expect(tierCaps("biped", "high")).toEqual(high.caps.biped);
    expect(tierCaps("scenery", "high")).toEqual(high.caps.scenery);
    expect(tierCaps("biped", "standard")).toEqual({ triangles: 2000, vertices: Number.POSITIVE_INFINITY, parts: 24, meshes: Number.POSITIVE_INFINITY });
    expect(tierCaps("scenery", "standard")).toEqual({ triangles: 600, vertices: Number.POSITIVE_INFINITY, parts: 24, meshes: Number.POSITIVE_INFINITY });
  });
});
