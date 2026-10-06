// A recipe is the data a model is built from: what kind of thing, how big, which colors (palette slots), which extras, and how it moves.
// Claude's answers are turned into this shape and repaired (repair.ts); the worker checks the same shape again before Blender starts
// (blender-worker/recipe.mjs has the identical rules). Nothing in a recipe is ever used as code, a path or a Blender property name: every
// name is looked up in the kit.
import {
  AXES,
  CHANNELS,
  CLIP_KEYS,
  CLIP_NAMES,
  DETAILS,
  DROP_ORDER,
  FINISHES,
  KIT,
  MODEL_KINDS,
  QUALITIES,
  SCENERY_KINDS,
  tierCaps,
  WAVES,
  WORLD_PIECES,
  WORLD_STYLES,
  type Axis,
  type Budget,
  type BuildField,
  type Channel,
  type ClipKey,
  type ClipName,
  type Detail,
  type Extra,
  type Finish,
  type ModelKind,
  type Quality,
  type SceneryKind,
  type Wave,
  type WorldPiece,
  type WorldStyle,
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
  // "scenery" is an environment piece: its build is exactly { scenery: <one of the kit's six> }. "world" is a piece of the High world: its
  // build is exactly { piece, style }, and it exists only in the High tier.
  kind: ModelKind | "scenery" | "world";
  summary: string;
  build: Record<string, number | string>;
  colors: Record<string, number>;
  extras: Extra[];
  /** Absent means Standard. */
  quality?: Quality;
  /** High only: one finish for each color slot. */
  finishes?: Record<string, Finish>;
  /** High only: extra detail, each priced in triangles. */
  details?: Detail[];
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
/**
 * The world around the track as Claude designs it: three palette indices (0 to 4) and up to three pieces of scenery from the kit. The
 * density is the person's setting, not Claude's, so it is not here.
 */
export interface EnvironmentDesign {
  version: 1;
  sky: number;
  field: number;
  stripe: number;
  scenery: SceneryKind[];
  /** The style of the land, road and far hills. Only a High design has one. */
  world?: WorldStyle;
}

/** The meadow: what an empty theme gives, and what takes the place of anything Claude's answer leaves out. */
export const DEFAULT_ENVIRONMENT: EnvironmentDesign = { version: 1, sky: 0, field: 3, stripe: 4, scenery: ["tree", "windmill", "rock"] };

/** The style of world a High environment has when nothing says another (an empty theme, or an answer with no style or one we do not have). */
export const DEFAULT_WORLD: WorldStyle = "desert";

/**
 * A track that was left out: Claude asked for it on a joint the model does not have (no `why`), or it was dropped to keep a High model's
 * moving joints within the meshes its kind may have (`why: "budget"`).
 */
export interface Skipped {
  clip: ClipName;
  joint: string;
  why?: "budget";
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
  if (kind === "world") return ["root"];
  if (kind === "scenery") {
    const piece = build.scenery;
    return typeof piece === "string" && Object.hasOwn(KIT.scenery, piece) ? KIT.scenery[piece as SceneryKind].joints.map(([name]) => name) : ["root"];
  }
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

const OPTIONAL_KEYS = ["quality", "finishes", "details"] as const;

/** The recipe's own pieces for the kind it is: its build fields, and (once its build is known) its color slots and the extras it may have. */
function buildFieldsOf(kind: string): Record<string, BuildField> {
  if (kind === "scenery") return { scenery: { choices: SCENERY_KINDS, default: SCENERY_KINDS[0] } };
  if (kind === "world") return { piece: { choices: WORLD_PIECES, default: WORLD_PIECES[0] }, style: { choices: WORLD_STYLES, default: WORLD_STYLES[0] } };
  return KIT.kinds[kind as ModelKind].build;
}

function checkRecipe(recipe: unknown): string | null {
  if (!isObject(recipe)) return "recipe: must be an object";
  const keys = keysProblem(recipe, ["version", "kind", "summary", "build", "colors", "extras", ...OPTIONAL_KEYS.filter((key) => Object.hasOwn(recipe, key))], "recipe");
  if (keys) return keys;
  if (recipe.version !== 1) return "recipe.version: must be 1";
  const kind = recipe.kind;
  const isScenery = kind === "scenery";
  const isWorld = kind === "world";
  if (typeof kind !== "string" || !(isScenery || isWorld || (MODEL_KINDS as readonly string[]).includes(kind))) {
    return `recipe.kind: ${shown(kind)} is not one of ${[...MODEL_KINDS, "scenery", "world"].join(", ")}`;
  }
  const quality = Object.hasOwn(recipe, "quality") ? recipe.quality : "standard";
  if (typeof quality !== "string" || !(QUALITIES as readonly string[]).includes(quality)) return `recipe.quality: ${shown(quality)} is not standard or high`;
  const high = quality === "high";
  if (isWorld && !high) return 'recipe.kind: "world" is only for the High tier';
  const spec = isScenery || isWorld ? null : KIT.kinds[kind as ModelKind];
  // A scenery piece or a world piece has its own build fields, takes the color slots of the piece (or of the world), and takes no extras.
  const buildFields = buildFieldsOf(kind);

  const summary = recipe.summary;
  if (typeof summary !== "string") return "recipe.summary: must be text";
  if (Array.from(summary).length > KIT.caps.summary) return `recipe.summary: longer than ${KIT.caps.summary} characters`;
  if (CONTROL.test(summary)) return "recipe.summary: has a control character";

  const build = recipe.build;
  if (!isObject(build)) return "recipe.build: must be an object";
  const buildKeys = keysProblem(build, Object.keys(buildFields), "recipe.build");
  if (buildKeys) return buildKeys;
  for (const [name, field] of Object.entries(buildFields)) {
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
  // build.scenery was checked to be one of the six above
  const slots = isWorld ? KIT.tiers.high.worlds.slots : spec ? spec.slots : KIT.scenery[build.scenery as SceneryKind].slots;
  const colorKeys = keysProblem(colors, Object.keys(slots), "recipe.colors");
  if (colorKeys) return colorKeys;
  for (const slot of Object.keys(slots)) {
    const v = colors[slot];
    if (!isNumber(v) || !Number.isInteger(v) || v < 0 || v > 4) return `recipe.colors.${slot}: ${shown(v)} must be a whole number 0 to 4`;
  }

  const extras = recipe.extras;
  if (!Array.isArray(extras)) return "recipe.extras: must be a list";
  if (extras.length > KIT.caps.extras) return `recipe.extras: at most ${KIT.caps.extras}`;
  for (const [i, e] of extras.entries()) {
    if (typeof e !== "string" || !((spec?.extras ?? []) as readonly string[]).includes(e)) return `recipe.extras: ${shown(e)} is not allowed for this kind`;
    if (extras.indexOf(e) !== i) return `recipe.extras: ${e} twice`;
  }

  if (!high) {
    if (Object.hasOwn(recipe, "finishes")) return "recipe.finishes: a Standard recipe has no finishes";
    if (Object.hasOwn(recipe, "details")) return "recipe.details: a Standard recipe has no details";
    return null;
  }
  return checkHigh(recipe, kind, slots);
}

// What only a High recipe has: a finish for each color slot, details the kind can carry, and a size within the tier's budget.
function checkHigh(recipe: Record<string, unknown>, kind: string, slots: Record<string, number>): string | null {
  const finishes = recipe.finishes;
  if (!isObject(finishes)) return "recipe.finishes: a High recipe needs a finish for each color";
  const finishKeys = keysProblem(finishes, Object.keys(slots), "recipe.finishes");
  if (finishKeys) return finishKeys;
  for (const slot of Object.keys(slots)) {
    const f = finishes[slot];
    if (typeof f !== "string" || !(FINISHES as readonly string[]).includes(f)) return `recipe.finishes.${slot}: ${shown(f)} is not one of ${FINISHES.join(", ")}`;
  }

  const details = recipe.details;
  if (!Array.isArray(details)) return "recipe.details: a High recipe needs a list of details (it may be empty)";
  if (details.length > KIT.tiers.high.caps.details) return `recipe.details: at most ${KIT.tiers.high.caps.details}`;
  const forModel = (MODEL_KINDS as readonly string[]).includes(kind);
  for (const [i, d] of details.entries()) {
    if (typeof d !== "string" || !(DETAILS as readonly string[]).includes(d)) return `recipe.details: ${shown(d)} is not one of ${DETAILS.join(", ")}`;
    if (details.indexOf(d) !== i) return `recipe.details: ${d} twice`;
    if (!forModel || KIT.tiers.high.details[d as Detail][kind as ModelKind] === undefined) return `recipe.details: ${d} is not for this kind`;
  }

  const e = estimate(recipe as unknown as ModelRecipe);
  if (kind === "world") {
    const caps = KIT.tiers.high.caps.world[(recipe.build as Record<string, string>).piece as WorldPiece];
    if (e.triangles > caps.triangles) return `recipe: ${e.triangles} triangles is over the world piece's limit of ${caps.triangles}`;
    if (e.vertices > caps.vertices) return `recipe: ${e.vertices} vertices is over the world piece's limit of ${caps.vertices}`;
    return null;
  }
  const caps = tierCaps(kind as ModelKind | "scenery", "high");
  if (e.triangles > caps.triangles) return `recipe: ${e.triangles} triangles is over the ${kind} limit of ${caps.triangles}`;
  if (e.vertices > caps.vertices) return `recipe: ${e.vertices} vertices is over the ${kind} limit of ${caps.vertices}`;
  if (e.parts > caps.parts) return `recipe: ${e.parts} parts is over the ${kind} limit of ${caps.parts}`;
  if (e.meshes > caps.meshes) return `recipe: ${e.meshes} meshes is over the ${kind} limit of ${caps.meshes}`;
  return null;
}

function checkMotions(motions: unknown, recipe: ModelRecipe): string | null {
  if (!isObject(motions)) return "motions: must be an object";
  const keys = keysProblem(motions, ["version", "motions"], "motions");
  if (keys) return keys;
  if (motions.version !== 1) return "motions.version: must be 1";
  const clips = motions.motions;
  if (!isObject(clips)) return "motions.motions: must be an object";
  if (recipe.kind === "world" && Object.keys(clips).length > 0) return "motions.motions: a world piece has no motions";
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
  const motionsProblem = checkMotions(body.motions, body.recipe as ModelRecipe);
  if (motionsProblem) return motionsProblem;
  const recipe = body.recipe as ModelRecipe;
  if (isHigh(recipe) && recipe.kind !== "world") {
    const needed = meshesNeeded(recipe, body.motions as MotionRecipe);
    const limit = tierCaps(recipe.kind, "high").meshes;
    if (needed > limit) return `motions: ${needed} meshes is over the ${recipe.kind} limit of ${limit}`;
  }
  return null;
}

/**
 * The most meshes a High build can make from these clips: one for the first joint (the root) and every joint that stands still (they share
 * it), and one more for each other joint some clip has a track for, because a joint that moves needs a mesh of its own. A joint with no part
 * on it makes none, so this is a bound, and it is the one the check and the repair both use.
 */
export function meshesNeeded(recipe: ModelRecipe, motions: MotionRecipe): number {
  const root = jointsOf(recipe)[0];
  const moved = new Set<string>();
  for (const clip of CLIP_KEYS) for (const track of motions.motions[clip]?.tracks ?? []) if (track.joint !== root) moved.add(track.joint);
  return 1 + moved.size;
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

/** The kit's recipe for a scenery piece: no summary, the piece named in its build, its own color slots, no extras. In High it also has finishes. */
export function sceneryRecipe(kind: SceneryKind, quality: Quality = "standard"): ModelRecipe {
  const recipe: ModelRecipe = { version: 1, kind: "scenery", summary: "", build: { scenery: kind }, colors: { ...KIT.scenery[kind].slots }, extras: [] };
  if (quality === "high") return { ...recipe, quality: "high", finishes: { ...KIT.tiers.high.defaults.scenery[kind].finishes }, details: [] };
  return recipe;
}

/** One piece of the High world in a style: terrain, road or backdrop, colored by the palette slots ground, accent and far. */
export function worldRecipe(piece: WorldPiece, style: WorldStyle): ModelRecipe {
  const high = KIT.tiers.high;
  return {
    version: 1,
    kind: "world",
    summary: "",
    build: { piece, style },
    colors: { ...high.worlds.slots },
    extras: [],
    quality: "high",
    finishes: { ...high.defaults.world.finishes },
    details: [],
  };
}

/** The kit's High recipe for a kind: its default build, the default finishes for each color slot and the default details. */
export function defaultHighRecipe(kind: ModelKind): ModelRecipe {
  const defaults = KIT.tiers.high.defaults[kind];
  return { ...defaultRecipe(kind), quality: "high", finishes: { ...defaults.finishes }, details: [...defaults.details] };
}

export const isHigh = (recipe: ModelRecipe): boolean => recipe.quality === "high";

/** What a recipe uses: parts, triangles, shared vertices and meshes. Standard counts only parts and triangles (vertices and meshes are 0). */
export interface Estimate {
  parts: number;
  triangles: number;
  vertices: number;
  meshes: number;
}

const plus = (a: Estimate, b: Budget): Estimate => ({ parts: a.parts + b.parts, triangles: a.triangles + b.triangles, vertices: a.vertices + b.vertices, meshes: a.meshes + b.meshes });
const times = (b: Budget, n: number): Budget => ({ parts: b.parts * n, triangles: b.triangles * n, vertices: b.vertices * n, meshes: b.meshes * n });
const NONE: Estimate = { parts: 0, triangles: 0, vertices: 0, meshes: 0 };

export function estimate(recipe: ModelRecipe): Estimate {
  if (!isHigh(recipe)) {
    const standard = counts(recipe);
    return { parts: standard.parts, triangles: standard.triangles, vertices: 0, meshes: 0 };
  }
  const high = KIT.tiers.high;
  const kind = recipe.kind;
  const { build } = recipe;
  if (kind === "world") {
    const piece = typeof build.piece === "string" && Object.hasOwn(high.base.world, build.piece) ? high.base.world[build.piece as WorldPiece] : null;
    return piece ? { parts: 1, triangles: piece.triangles, vertices: piece.vertices, meshes: 1 } : NONE;
  }

  let total: Estimate = NONE;
  if (kind === "scenery") {
    const piece = typeof build.scenery === "string" && Object.hasOwn(high.base.scenery, build.scenery) ? high.base.scenery[build.scenery as SceneryKind] : null;
    return piece ? plus(NONE, piece) : NONE;
  }
  if (kind === "vehicle") {
    const { cab, wheel, ...body } = high.base.vehicle;
    total = plus(NONE, body);
    if (typeof build.cabSize === "number" && build.cabSize > 0) total = plus(total, cab);
    if (typeof build.wheelCount === "number") total = plus(total, times(wheel, Math.max(0, Math.floor(build.wheelCount))));
  } else if (kind === "prop") {
    const shape = typeof build.shape === "string" && Object.hasOwn(high.base.prop.shapes, build.shape) ? high.base.prop.shapes[build.shape as keyof typeof high.base.prop.shapes] : null;
    total = shape ? plus(NONE, shape) : NONE;
  } else {
    total = plus(NONE, high.base[kind]);
  }
  for (const extra of recipe.extras) if (Object.hasOwn(high.extras, extra)) total = plus(total, high.extras[extra]);
  for (const detail of recipe.details ?? []) {
    const cost = Object.hasOwn(high.details, detail) ? high.details[detail][kind] : undefined;
    if (cost) total = plus(total, cost);
  }
  return total;
}

/**
 * Brings a High recipe within its caps by dropping, in this order, cables, bolts, seams, lights, then extras from the end. It adds nothing,
 * never touches a recipe that is already within budget, and never changes the one it is given. Null when it is still over with nothing left
 * to drop. A Standard recipe (or a world piece, which has nothing to drop) comes back as a copy. `caps` is for tests: the tier's own by default.
 */
export function fitToBudget(recipe: ModelRecipe, caps?: Budget): ModelRecipe | null {
  const fitted = clone(recipe);
  if (!isHigh(fitted) || fitted.kind === "world") return fitted;
  const limits = caps ?? tierCaps(fitted.kind === "scenery" ? "scenery" : fitted.kind, "high");
  const over = () => {
    const e = estimate(fitted);
    return e.triangles > limits.triangles || e.vertices > limits.vertices || e.parts > limits.parts || e.meshes > limits.meshes;
  };
  while (over()) {
    const details = fitted.details ?? [];
    const next = DROP_ORDER.find((detail) => details.includes(detail));
    if (next) {
      fitted.details = details.filter((detail) => detail !== next);
    } else if (fitted.extras.length > 0) {
      fitted.extras = fitted.extras.slice(0, -1);
    } else {
      return null;
    }
  }
  return fitted;
}

/** A piece's motions: the Loop of an animated one (a tree, a pine, a windmill), nothing for one that stands still. */
export function sceneryMotions(kind: SceneryKind): MotionRecipe {
  const { loop } = KIT.scenery[kind];
  return { version: 1, motions: loop ? { loop: clone(loop) } : {} };
}

/** The kit's motions for these clips; tracks on joints the recipe lacks are dropped silently (a three-wheeled vehicle has no wheel_4). */
export function defaultMotions(recipe: ModelRecipe, clips: readonly ClipKey[]): MotionRecipe {
  const motions: MotionRecipe["motions"] = {};
  if (recipe.kind === "scenery" || recipe.kind === "world") return { version: 1, motions };
  const joints = new Set(jointsOf(recipe));
  for (const clip of clips) {
    const spec = KIT.kinds[recipe.kind].motions[clip];
    motions[clip] = { seconds: spec.seconds, tracks: clone(spec.tracks).filter((t) => joints.has(t.joint)) };
  }
  return { version: 1, motions };
}

function counts(recipe: ModelRecipe): { parts: number; triangles: number } {
  if (recipe.kind === "world") return { parts: 0, triangles: 0 };
  if (recipe.kind === "scenery") {
    const piece = recipe.build.scenery;
    const entry = typeof piece === "string" && Object.hasOwn(KIT.scenery, piece) ? KIT.scenery[piece as SceneryKind].count : null;
    return { parts: entry?.parts ?? 0, triangles: entry?.triangles ?? 0 };
  }
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
