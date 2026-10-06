// The worker's own check of a POST /build body. It repeats, exactly, the rules of web/src/lib/builder/recipes.ts (checkBuildBody), because
// the worker never trusts its caller: the body is JSON from the network, and only a body that passes is written to a file Blender reads.
// Both sides read the same kit (scripts/kit.json) and are tested against the same fixtures (fixtures/recipes/). Nothing here, and nothing
// in build.py, uses a field of the body as code, a path or a Blender property name: every name is looked up in the kit first.
import { readFileSync } from "node:fs";

export const KIT = JSON.parse(readFileSync(new URL("./scripts/kit.json", import.meta.url), "utf8"));

const MODEL_KINDS = Object.keys(KIT.kinds);
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
  if (!MODEL_KINDS.includes(recipe?.kind) && recipe?.kind !== "scenery") return [];
  const extras = (Array.isArray(recipe.extras) ? recipe.extras : []).flatMap((e) => (Object.hasOwn(KIT.extras, e) ? KIT.extras[e].joints.map(([name]) => name) : []));
  return [...baseJoints(recipe.kind, recipe.build), ...extras];
}

function keysProblem(obj, expected, where) {
  const own = Object.keys(obj); // own keys only: a "__proto__" made by JSON.parse is just an unknown key
  for (const k of own) if (!expected.includes(k)) return `${where}: unknown field ${shown(k)}`;
  for (const k of expected) if (!own.includes(k)) return `${where}: missing field ${k}`;
  return null;
}

function checkRecipe(recipe) {
  if (!isObject(recipe)) return "recipe: must be an object";
  const keys = keysProblem(recipe, ["version", "kind", "summary", "build", "colors", "extras"], "recipe");
  if (keys) return keys;
  if (recipe.version !== 1) return "recipe.version: must be 1";
  const kind = recipe.kind;
  const isScenery = kind === "scenery";
  if (typeof kind !== "string" || !(isScenery || MODEL_KINDS.includes(kind))) return `recipe.kind: ${shown(kind)} is not one of ${[...MODEL_KINDS, "scenery"].join(", ")}`;
  const spec = isScenery ? null : KIT.kinds[kind];
  // A scenery piece has one build field, which piece it is, and the color slots and joints of that piece; it takes no extras.
  const buildFields = spec ? spec.build : { scenery: { choices: Object.keys(KIT.scenery), default: "tree" } };

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
  const slots = spec ? spec.slots : KIT.scenery[build.scenery].slots; // build.scenery was checked to be one of the six above
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
  return null;
}

function checkMotions(motions, recipe) {
  if (!isObject(motions)) return "motions: must be an object";
  const keys = keysProblem(motions, ["version", "motions"], "motions");
  if (keys) return keys;
  if (motions.version !== 1) return "motions.version: must be 1";
  const clips = motions.motions;
  if (!isObject(clips)) return "motions.motions: must be an object";
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
  return checkMotions(body.motions, body.recipe);
}
