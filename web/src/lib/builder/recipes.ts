// A recipe is the data a model is built from: what kind of thing, how big, which colors (palette slots), which extras, and how it moves.
// Claude's answers are turned into this shape and repaired (repair.ts); the worker checks the same shape again before Blender starts
// (blender-worker/recipe.mjs has the identical rules). Nothing in a recipe is ever used as code, a path or a Blender property name: every
// name is looked up in the kit.
import {
  AXES,
  CHANNELS,
  CLIP_KEYS,
  CLIP_NAMES,
  KIT,
  MODEL_KINDS,
  WAVES,
  type Axis,
  type Channel,
  type ClipKey,
  type ClipName,
  type Extra,
  type ModelKind,
  type Wave,
} from "@/lib/builder/kinds";

export interface Track {
  joint: string;
  channel: Channel;
  axis: Axis;
  wave: Wave;
  amplitude: number;
  cycles: number;
  phase: number;
}
export interface Motion {
  seconds: number;
  tracks: Track[];
}
export interface ModelRecipe {
  version: 1;
  // "scenery" is declared for the environment's pieces; the check accepts only the four model kinds until the scenery kit exists.
  kind: ModelKind | "scenery";
  summary: string;
  build: Record<string, number | string>;
  colors: Record<string, number>;
  extras: Extra[];
}
export interface MotionRecipe {
  version: 1;
  motions: Partial<Record<ClipKey, Motion>>;
}
export interface BuildBody {
  recipe: ModelRecipe;
  motions: MotionRecipe;
  palette: string[];
}
/** A track Claude asked for on a joint the model does not have. */
export interface Skipped {
  clip: ClipName;
  joint: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const TRACK_FIELDS = ["joint", "channel", "axis", "wave", "amplitude", "cycles", "phase"] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
// A value in a message: short, with no control characters, so a hostile string cannot shape a log line.
const shown = (v: unknown): string => {
  const text = typeof v === "string" ? JSON.stringify(v.replace(CONTROL, " ").slice(0, 40)) : isNumber(v) ? String(v) : typeof v;
  return text;
};

/** The joints a model of this kind starts with (a vehicle's wheels follow its wheel count). */
function baseJoints(kind: ModelRecipe["kind"], build: ModelRecipe["build"]): string[] {
  if (kind === "scenery") return ["root"];
  if (kind === "vehicle") {
    const field = KIT.kinds.vehicle.build.wheelCount;
    const fallback = "min" in field ? field.default : 4;
    const wheels = typeof build.wheelCount === "number" ? build.wheelCount : fallback;
    return ["body", ...Array.from({ length: Math.max(0, Math.floor(wheels)) }, (_, i) => `wheel_${i + 1}`)];
  }
  return KIT.kinds[kind].joints.map(([name]) => name);
}

/** Base joints, then each extra's joints in recipe order. */
export function jointsOf(recipe: ModelRecipe): string[] {
  // hasOwn, not `in`: "constructor" is `in` every object, and an unchecked recipe may name anything
  const extras = (Array.isArray(recipe.extras) ? recipe.extras : []).flatMap((e) => (Object.hasOwn(KIT.extras, e) ? KIT.extras[e].joints.map(([name]) => name) : []));
  return [...baseJoints(recipe.kind, recipe.build), ...extras];
}

function keysProblem(obj: Record<string, unknown>, expected: readonly string[], where: string): string | null {
  const own = Object.keys(obj); // own keys only: a "__proto__" made by JSON.parse is just an unknown key
  for (const k of own) if (!expected.includes(k)) return `${where}: unknown field ${shown(k)}`;
  for (const k of expected) if (!own.includes(k)) return `${where}: missing field ${k}`;
  return null;
}

function checkRecipe(recipe: unknown): string | null {
  if (!isObject(recipe)) return "recipe: must be an object";
  const keys = keysProblem(recipe, ["version", "kind", "summary", "build", "colors", "extras"], "recipe");
  if (keys) return keys;
  if (recipe.version !== 1) return "recipe.version: must be 1";
  const kind = recipe.kind;
  if (typeof kind !== "string" || !(MODEL_KINDS as readonly string[]).includes(kind)) return `recipe.kind: ${shown(kind)} is not one of ${MODEL_KINDS.join(", ")}`;
  const spec = KIT.kinds[kind as ModelKind];

  const summary = recipe.summary;
  if (typeof summary !== "string") return "recipe.summary: must be text";
  if (Array.from(summary).length > KIT.caps.summary) return `recipe.summary: longer than ${KIT.caps.summary} characters`;
  if (CONTROL.test(summary)) return "recipe.summary: has a control character";

  const build = recipe.build;
  if (!isObject(build)) return "recipe.build: must be an object";
  const buildKeys = keysProblem(build, Object.keys(spec.build), "recipe.build");
  if (buildKeys) return buildKeys;
  for (const [name, field] of Object.entries(spec.build)) {
    const v = build[name];
    if ("choices" in field) {
      if (typeof v !== "string" || !field.choices.includes(v)) return `recipe.build.${name}: ${shown(v)} is not one of ${field.choices.join(", ")}`;
    } else {
      if (!isNumber(v)) return `recipe.build.${name}: must be a number`;
      if (v < field.min || v > field.max) return `recipe.build.${name}: ${v} is outside ${field.min} to ${field.max}`;
      if (field.whole && !Number.isInteger(v)) return `recipe.build.${name}: ${v} must be a whole number`;
    }
  }

  const colors = recipe.colors;
  if (!isObject(colors)) return "recipe.colors: must be an object";
  const colorKeys = keysProblem(colors, Object.keys(spec.slots), "recipe.colors");
  if (colorKeys) return colorKeys;
  for (const slot of Object.keys(spec.slots)) {
    const v = colors[slot];
    if (!isNumber(v) || !Number.isInteger(v) || v < 0 || v > 4) return `recipe.colors.${slot}: ${shown(v)} must be a whole number 0 to 4`;
  }

  const extras = recipe.extras;
  if (!Array.isArray(extras)) return "recipe.extras: must be a list";
  if (extras.length > KIT.caps.extras) return `recipe.extras: at most ${KIT.caps.extras}`;
  for (const [i, e] of extras.entries()) {
    if (typeof e !== "string" || !(spec.extras as readonly string[]).includes(e)) return `recipe.extras: ${shown(e)} is not allowed for this kind`;
    if (extras.indexOf(e) !== i) return `recipe.extras: ${e} twice`;
  }
  return null;
}

function checkMotions(motions: unknown, recipe: ModelRecipe): string | null {
  if (!isObject(motions)) return "motions: must be an object";
  const keys = keysProblem(motions, ["version", "motions"], "motions");
  if (keys) return keys;
  if (motions.version !== 1) return "motions.version: must be 1";
  const clips = motions.motions;
  if (!isObject(clips)) return "motions.motions: must be an object";
  const joints = new Set(jointsOf(recipe));
  const { motion, caps } = KIT;
  for (const clip of Object.keys(clips)) {
    if (!(CLIP_KEYS as readonly string[]).includes(clip)) return `motions.motions: unknown clip ${shown(clip)}`;
    const where = `motions.motions.${clip}`;
    const m = clips[clip];
    if (!isObject(m)) return `${where}: must be an object`;
    const mk = keysProblem(m, ["seconds", "tracks"], where);
    if (mk) return mk;
    if (!isNumber(m.seconds) || m.seconds < motion.seconds[0] || m.seconds > motion.seconds[1]) return `${where}.seconds: ${shown(m.seconds)} is outside ${motion.seconds[0]} to ${motion.seconds[1]}`;
    if (!Array.isArray(m.tracks)) return `${where}.tracks: must be a list`;
    if (m.tracks.length > caps.tracks) return `${where}.tracks: more than ${caps.tracks}`;
    for (const [i, track] of m.tracks.entries()) {
      const at = `${where}.tracks[${i}]`;
      if (!isObject(track)) return `${at}: must be an object`;
      const tk = keysProblem(track, TRACK_FIELDS, at);
      if (tk) return tk;
      if (typeof track.joint !== "string" || !joints.has(track.joint)) return `${at}.joint: ${shown(track.joint)} is not a joint of this model`;
      if (typeof track.channel !== "string" || !(CHANNELS as readonly string[]).includes(track.channel)) return `${at}.channel: ${shown(track.channel)} is not one of ${CHANNELS.join(", ")}`;
      if (typeof track.axis !== "string" || !(AXES as readonly string[]).includes(track.axis)) return `${at}.axis: ${shown(track.axis)} is not one of ${AXES.join(", ")}`;
      if (typeof track.wave !== "string" || !(WAVES as readonly string[]).includes(track.wave)) return `${at}.wave: ${shown(track.wave)} is not one of ${WAVES.join(", ")}`;
      if (track.wave === "spin" && track.channel !== "rotate") return `${at}.wave: spin works only with rotate`;
      const [lo, hi] = motion.amplitude[track.channel as Channel];
      if (!isNumber(track.amplitude) || track.amplitude < lo || track.amplitude > hi) return `${at}.amplitude: ${shown(track.amplitude)} is outside ${lo} to ${hi}`;
      if (!isNumber(track.cycles) || track.cycles < motion.cycles[0] || track.cycles > motion.cycles[1]) return `${at}.cycles: ${shown(track.cycles)} is outside ${motion.cycles[0]} to ${motion.cycles[1]}`;
      if (!isNumber(track.phase) || track.phase < motion.phase[0] || track.phase > motion.phase[1]) return `${at}.phase: ${shown(track.phase)} is outside ${motion.phase[0]} to ${motion.phase[1]}`;
    }
  }
  return null;
}

/** null when the body is valid; otherwise a short problem that names the field. The worker's recipe.mjs has the same rules. */
export function checkBuildBody(body: unknown): string | null {
  if (!isObject(body)) return "body: must be an object";
  const keys = keysProblem(body, ["recipe", "motions", "palette"], "body");
  if (keys) return keys;
  const palette = body.palette;
  if (!Array.isArray(palette) || palette.length !== 5 || !palette.every((c) => typeof c === "string" && HEX.test(c))) return "palette: must be five #rrggbb colors";
  const recipeProblem = checkRecipe(body.recipe);
  if (recipeProblem) return recipeProblem;
  return checkMotions(body.motions, body.recipe as ModelRecipe);
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The kit's recipe for a kind: its summary, every build field at its default, every color slot at its default, no extras. */
export function defaultRecipe(kind: ModelKind): ModelRecipe {
  const spec = KIT.kinds[kind];
  return {
    version: 1,
    kind,
    summary: spec.summary,
    build: Object.fromEntries(Object.entries(spec.build).map(([name, field]) => [name, field.default])),
    colors: { ...spec.slots },
    extras: [],
  };
}

/** The kit's motions for these clips; tracks on joints the recipe lacks are dropped silently (a three-wheeled vehicle has no wheel_4). */
export function defaultMotions(recipe: ModelRecipe, clips: readonly ClipKey[]): MotionRecipe {
  const motions: MotionRecipe["motions"] = {};
  if (recipe.kind === "scenery") return { version: 1, motions };
  const joints = new Set(jointsOf(recipe));
  for (const clip of clips) {
    const spec = KIT.kinds[recipe.kind].motions[clip];
    motions[clip] = { seconds: spec.seconds, tracks: clone(spec.tracks).filter((t) => joints.has(t.joint)) };
  }
  return { version: 1, motions };
}

function counts(recipe: ModelRecipe): { parts: number; triangles: number } {
  if (recipe.kind === "scenery") return { parts: 0, triangles: 0 };
  const count = KIT.kinds[recipe.kind].count;
  let parts = 0;
  let triangles = 0;
  if (recipe.kind === "prop") {
    const shape = KIT.kinds.prop.count.shapes?.[recipe.build.shape as keyof NonNullable<typeof count.shapes>];
    return { parts: shape?.parts ?? 0, triangles: shape?.triangles ?? 0 };
  }
  parts = count.parts ?? 0;
  triangles = count.triangles ?? 0;
  if (recipe.kind === "vehicle") {
    const wheels = typeof recipe.build.wheelCount === "number" ? recipe.build.wheelCount : 0;
    if (typeof recipe.build.cabSize === "number" && recipe.build.cabSize > 0 && count.cab) {
      parts += count.cab.parts;
      triangles += count.cab.triangles;
    }
    if (count.wheel) {
      parts += wheels * count.wheel.parts;
      triangles += wheels * count.wheel.triangles;
    }
  }
  for (const e of recipe.extras) {
    parts += KIT.extras[e].parts;
    triangles += KIT.extras[e].triangles;
  }
  return { parts, triangles };
}

export const partCount = (recipe: ModelRecipe): number => counts(recipe).parts;
export const triangleEstimate = (recipe: ModelRecipe): number => counts(recipe).triangles;

/** Clips with at least one track, in Run, Jump, Loop order. */
export function clipsOf(motions: MotionRecipe): ClipName[] {
  return CLIP_KEYS.filter((clip) => (motions.motions[clip]?.tracks.length ?? 0) > 0).map((clip) => CLIP_NAMES[clip]);
}
