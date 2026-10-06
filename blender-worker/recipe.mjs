// The worker's own check of a POST /build body. It repeats, exactly, the rules of web/src/lib/builder/recipes.ts (checkBuildBody), because
// the worker never trusts its caller: the body is JSON from the network, and only a body that passes is written to a file Blender reads.
// Both sides read the same kit (scripts/kit.json) and are tested against the same fixtures (fixtures/recipes/). Nothing here, and nothing
// in build.py, uses a field of the body as code, a path or a Blender property name: every name is looked up in the kit first.
import { readFileSync } from "node:fs";

export const KIT = JSON.parse(readFileSync(new URL("./scripts/kit.json", import.meta.url), "utf8"));

const MODEL_KINDS = Object.keys(KIT.kinds);
const QUALITIES = ["standard", "high"];
const FINISHES = Object.keys(KIT.tiers.high.finishes);
const DETAILS = Object.keys(KIT.tiers.high.details);
const WORLD_PIECES = KIT.tiers.high.worlds.pieces;
const WORLD_STYLES = KIT.tiers.high.worlds.styles;
const OPTIONAL_KEYS = ["quality", "finishes", "details"];
const CLIP_KEYS = ["run", "jump", "loop"];
const CHANNELS = ["rotate", "move", "scale"];
const AXES = ["x", "y", "z"];
const WAVES = ["swing", "spin", "bounce", "pulse", "hold"];
const TRACK_FIELDS = ["joint", "channel", "axis", "wave", "amplitude", "cycles", "phase"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
// A value in a message: short, with no control characters, so a hostile string cannot shape a log line.
const shown = (v) => (typeof v === "string" ? JSON.stringify(v.replace(new RegExp(CONTROL, "g"), " ").slice(0, 40)) : isNumber(v) ? String(v) : typeof v);

function baseJoints(kind, build) {
  if (kind === "world") return ["root"];
  if (kind === "scenery") {
    const piece = build?.scenery;
    return typeof piece === "string" && Object.hasOwn(KIT.scenery, piece) ? KIT.scenery[piece].joints.map(([name]) => name) : ["root"];
  }
  if (kind === "vehicle") {
    const field = KIT.kinds.vehicle.build.wheelCount;
    const wheels = typeof build?.wheelCount === "number" ? build.wheelCount : field.default;
    return ["body", ...Array.from({ length: Math.max(0, Math.floor(wheels)) }, (_, i) => `wheel_${i + 1}`)];
  }
  return KIT.kinds[kind].joints.map(([name]) => name);
}

/** Base joints, then each extra's joints in recipe order. */
export function jointsOf(recipe) {
  if (!MODEL_KINDS.includes(recipe?.kind) && recipe?.kind !== "scenery" && recipe?.kind !== "world") return [];
  const extras = (Array.isArray(recipe.extras) ? recipe.extras : []).flatMap((e) => (Object.hasOwn(KIT.extras, e) ? KIT.extras[e].joints.map(([name]) => name) : []));
  return [...baseJoints(recipe.kind, recipe.build), ...extras];
}

function keysProblem(obj, expected, where) {
  const own = Object.keys(obj); // own keys only: a "__proto__" made by JSON.parse is just an unknown key
  for (const k of own) if (!expected.includes(k)) return `${where}: unknown field ${shown(k)}`;
  for (const k of expected) if (!own.includes(k)) return `${where}: missing field ${k}`;
  return null;
}

function buildFieldsOf(kind) {
  if (kind === "scenery") return { scenery: { choices: Object.keys(KIT.scenery), default: "tree" } };
  if (kind === "world") return { piece: { choices: WORLD_PIECES, default: WORLD_PIECES[0] }, style: { choices: WORLD_STYLES, default: WORLD_STYLES[0] } };
  return KIT.kinds[kind].build;
}

function checkRecipe(recipe) {
  if (!isObject(recipe)) return "recipe: must be an object";
  const keys = keysProblem(recipe, ["version", "kind", "summary", "build", "colors", "extras", ...OPTIONAL_KEYS.filter((key) => Object.hasOwn(recipe, key))], "recipe");
  if (keys) return keys;
  if (recipe.version !== 1) return "recipe.version: must be 1";
  const kind = recipe.kind;
  const isScenery = kind === "scenery";
  const isWorld = kind === "world";
  if (typeof kind !== "string" || !(isScenery || isWorld || MODEL_KINDS.includes(kind))) return `recipe.kind: ${shown(kind)} is not one of ${[...MODEL_KINDS, "scenery", "world"].join(", ")}`;
  const quality = Object.hasOwn(recipe, "quality") ? recipe.quality : "standard";
  if (typeof quality !== "string" || !QUALITIES.includes(quality)) return `recipe.quality: ${shown(quality)} is not standard or high`;
  const high = quality === "high";
  if (isWorld && !high) return 'recipe.kind: "world" is only for the High tier';
  const spec = isScenery || isWorld ? null : KIT.kinds[kind];
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
    if (Object.hasOwn(field, "choices")) {
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
  const slots = isWorld ? KIT.tiers.high.worlds.slots : spec ? spec.slots : KIT.scenery[build.scenery].slots;
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
    if (typeof e !== "string" || !(spec?.extras ?? []).includes(e)) return `recipe.extras: ${shown(e)} is not allowed for this kind`;
    if (extras.indexOf(e) !== i) return `recipe.extras: ${e} twice`;
  }

  if (!high) {
    if (Object.hasOwn(recipe, "finishes")) return "recipe.finishes: a Standard recipe has no finishes";
    if (Object.hasOwn(recipe, "details")) return "recipe.details: a Standard recipe has no details";
    return null;
  }
  return checkHigh(recipe, kind, slots);
}

// What only a High recipe has: a finish for each color slot, details the kind can carry, and a size within the budget of the tier.
function checkHigh(recipe, kind, slots) {
  const finishes = recipe.finishes;
  if (!isObject(finishes)) return "recipe.finishes: a High recipe needs a finish for each color";
  const finishKeys = keysProblem(finishes, Object.keys(slots), "recipe.finishes");
  if (finishKeys) return finishKeys;
  for (const slot of Object.keys(slots)) {
    const f = finishes[slot];
    if (typeof f !== "string" || !FINISHES.includes(f)) return `recipe.finishes.${slot}: ${shown(f)} is not one of ${FINISHES.join(", ")}`;
  }

  const details = recipe.details;
  if (!Array.isArray(details)) return "recipe.details: a High recipe needs a list of details (it may be empty)";
  if (details.length > KIT.tiers.high.caps.details) return `recipe.details: at most ${KIT.tiers.high.caps.details}`;
  const forModel = MODEL_KINDS.includes(kind);
  for (const [i, d] of details.entries()) {
    if (typeof d !== "string" || !DETAILS.includes(d)) return `recipe.details: ${shown(d)} is not one of ${DETAILS.join(", ")}`;
    if (details.indexOf(d) !== i) return `recipe.details: ${d} twice`;
    if (!forModel || KIT.tiers.high.details[d][kind] === undefined) return `recipe.details: ${d} is not for this kind`;
  }

  const e = estimate(recipe);
  if (kind === "world") {
    const caps = KIT.tiers.high.caps.world[recipe.build.piece];
    if (e.triangles > caps.triangles) return `recipe: ${e.triangles} triangles is over the world piece's limit of ${caps.triangles}`;
    if (e.vertices > caps.vertices) return `recipe: ${e.vertices} vertices is over the world piece's limit of ${caps.vertices}`;
    return null;
  }
  const caps = KIT.tiers.high.caps[kind];
  if (e.triangles > caps.triangles) return `recipe: ${e.triangles} triangles is over the ${kind} limit of ${caps.triangles}`;
  if (e.vertices > caps.vertices) return `recipe: ${e.vertices} vertices is over the ${kind} limit of ${caps.vertices}`;
  if (e.parts > caps.parts) return `recipe: ${e.parts} parts is over the ${kind} limit of ${caps.parts}`;
  if (e.meshes > caps.meshes) return `recipe: ${e.meshes} meshes is over the ${kind} limit of ${caps.meshes}`;
  return null;
}

const NONE = { parts: 0, triangles: 0, vertices: 0, meshes: 0 };
const plus = (a, b) => ({ parts: a.parts + b.parts, triangles: a.triangles + b.triangles, vertices: a.vertices + b.vertices, meshes: a.meshes + b.meshes });
const times = (b, n) => ({ parts: b.parts * n, triangles: b.triangles * n, vertices: b.vertices * n, meshes: b.meshes * n });

/** What a High recipe uses (parts, triangles, shared vertices, meshes), from the kit's tier. The same arithmetic as the web app's estimate. */
export function estimate(recipe) {
  const high = KIT.tiers.high;
  const kind = recipe.kind;
  const build = recipe.build;
  if (kind === "world") {
    const piece = typeof build.piece === "string" && Object.hasOwn(high.base.world, build.piece) ? high.base.world[build.piece] : null;
    return piece ? { parts: 1, triangles: piece.triangles, vertices: piece.vertices, meshes: 1 } : NONE;
  }
  if (kind === "scenery") {
    const piece = typeof build.scenery === "string" && Object.hasOwn(high.base.scenery, build.scenery) ? high.base.scenery[build.scenery] : null;
    return piece ? plus(NONE, piece) : NONE;
  }
  let total = NONE;
  if (kind === "vehicle") {
    const { cab, wheel, ...body } = high.base.vehicle;
    total = plus(NONE, body);
    if (typeof build.cabSize === "number" && build.cabSize > 0) total = plus(total, cab);
    if (typeof build.wheelCount === "number") total = plus(total, times(wheel, Math.max(0, Math.floor(build.wheelCount))));
  } else if (kind === "prop") {
    const shape = typeof build.shape === "string" && Object.hasOwn(high.base.prop.shapes, build.shape) ? high.base.prop.shapes[build.shape] : null;
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

function checkMotions(motions, recipe) {
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
    if (!CLIP_KEYS.includes(clip)) return `motions.motions: unknown clip ${shown(clip)}`;
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
      if (typeof track.channel !== "string" || !CHANNELS.includes(track.channel)) return `${at}.channel: ${shown(track.channel)} is not one of ${CHANNELS.join(", ")}`;
      if (typeof track.axis !== "string" || !AXES.includes(track.axis)) return `${at}.axis: ${shown(track.axis)} is not one of ${AXES.join(", ")}`;
      if (typeof track.wave !== "string" || !WAVES.includes(track.wave)) return `${at}.wave: ${shown(track.wave)} is not one of ${WAVES.join(", ")}`;
      if (track.wave === "spin" && track.channel !== "rotate") return `${at}.wave: spin works only with rotate`;
      const [lo, hi] = motion.amplitude[track.channel];
      if (!isNumber(track.amplitude) || track.amplitude < lo || track.amplitude > hi) return `${at}.amplitude: ${shown(track.amplitude)} is outside ${lo} to ${hi}`;
      if (!isNumber(track.cycles) || track.cycles < motion.cycles[0] || track.cycles > motion.cycles[1]) return `${at}.cycles: ${shown(track.cycles)} is outside ${motion.cycles[0]} to ${motion.cycles[1]}`;
      if (!isNumber(track.phase) || track.phase < motion.phase[0] || track.phase > motion.phase[1]) return `${at}.phase: ${shown(track.phase)} is outside ${motion.phase[0]} to ${motion.phase[1]}`;
    }
  }
  return null;
}

/** null when the body is valid; otherwise a short problem that names the field. Never throws. */
export function checkBuildBody(body) {
  if (!isObject(body)) return "body: must be an object";
  const keys = keysProblem(body, ["recipe", "motions", "palette"], "body");
  if (keys) return keys;
  const palette = body.palette;
  if (!Array.isArray(palette) || palette.length !== 5 || !palette.every((c) => typeof c === "string" && HEX.test(c))) return "palette: must be five #rrggbb colors";
  const recipeProblem = checkRecipe(body.recipe);
  if (recipeProblem) return recipeProblem;
  const motionsProblem = checkMotions(body.motions, body.recipe);
  if (motionsProblem) return motionsProblem;
  if (body.recipe.quality === "high" && body.recipe.kind !== "world") {
    const needed = meshesNeeded(body.recipe, body.motions);
    const limit = KIT.tiers.high.caps[body.recipe.kind].meshes;
    if (needed > limit) return `motions: ${needed} meshes is over the ${body.recipe.kind} limit of ${limit}`;
  }
  return null;
}

/** The most meshes a High build can make from these clips (the same bound as web/src/lib/builder/recipes.ts meshesNeeded). */
export function meshesNeeded(recipe, motions) {
  const root = jointsOf(recipe)[0];
  const moved = new Set();
  for (const clip of CLIP_KEYS) for (const track of motions.motions[clip]?.tracks ?? []) if (track.joint !== root) moved.add(track.joint);
  return 1 + moved.size;
}
