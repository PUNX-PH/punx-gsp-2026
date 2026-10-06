// Claude's answers are untrusted data in a requested shape. Nothing here believes them: numbers are clamped into the kit's ranges, anything
// unknown is dropped, anything missing takes the kit's default, and what cannot be repaired fails the step. Every lookup of a name goes
// through the kit with an own-key check, so a hostile key is just an unknown key.
import {
  AXES,
  CHANNELS,
  CLIP_NAMES,
  KIT,
  MAX_SCENERY,
  MODEL_KINDS,
  SCENERY_KINDS,
  WAVES,
  type Axis,
  type BuildField,
  type Channel,
  type ClipKey,
  type Extra,
  type ModelKind,
  type SceneryKind,
  type Wave,
} from "@/lib/builder/kinds";
import {
  DEFAULT_ENVIRONMENT,
  defaultMotions,
  jointsOf,
  partCount,
  triangleEstimate,
  type EnvironmentDesign,
  type ModelRecipe,
  type MotionRecipe,
  type Skipped,
  type Track,
} from "@/lib/builder/recipes";

const CONTROL = /[\u0000-\u001f\u007f]/g;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Caps {
  parts: number;
  triangles: number;
}

/**
 * Drops extras from the end until the recipe fits the caps. Null when it is still over with none left (the kind alone is too big).
 * The recipe it is given is never changed.
 */
export function enforceCaps(recipe: ModelRecipe, caps: Caps = { parts: KIT.caps.parts, triangles: KIT.caps.triangles }): ModelRecipe | null {
  const over = (r: ModelRecipe) => partCount(r) > caps.parts || triangleEstimate(r) > caps.triangles;
  let current: ModelRecipe = { ...recipe, extras: [...recipe.extras] };
  while (over(current) && current.extras.length > 0) current = { ...current, extras: current.extras.slice(0, -1) };
  return over(current) ? null : current;
}

function repairField(field: BuildField, v: unknown): number | string {
  if ("choices" in field) return oneOf(field.choices, v) ? v : field.default;
  if (!isNumber(v)) return field.default;
  return clamp(field.whole ? Math.round(v) : v, field.min, field.max);
}

/** A model answer made into a valid recipe, or `{ ok: false }`. `wanted.kind` is the person's choice; null means Claude picks (Auto). */
export function repairModelRecipe(raw: unknown, wanted: { kind: ModelKind | null }): { ok: true; recipe: ModelRecipe } | { ok: false } {
  if (!isObject(raw)) return { ok: false };
  const kind = wanted.kind ?? (oneOf(MODEL_KINDS, raw.kind) ? raw.kind : null);
  if (kind === null || !oneOf(MODEL_KINDS, kind)) return { ok: false };
  const spec = KIT.kinds[kind];
  const rawBuild = isObject(raw.build) ? raw.build : {};
  const rawColors = isObject(raw.colors) ? raw.colors : {};

  const build = Object.fromEntries(Object.entries(spec.build).map(([name, field]) => [name, repairField(field, Object.hasOwn(rawBuild, name) ? rawBuild[name] : undefined)]));
  const colors = Object.fromEntries(
    Object.entries(spec.slots).map(([slot, fallback]) => {
      const v = Object.hasOwn(rawColors, slot) ? rawColors[slot] : undefined;
      return [slot, isNumber(v) ? clamp(Math.round(v), 0, 4) : fallback];
    }),
  );
  const allowed = spec.extras as readonly string[];
  const extras = (Array.isArray(raw.extras) ? raw.extras : [])
    .filter((e): e is Extra => typeof e === "string" && allowed.includes(e))
    .filter((e, i, all) => all.indexOf(e) === i)
    .slice(0, KIT.caps.extras);
  const summary = typeof raw.summary === "string" ? Array.from(raw.summary.replace(CONTROL, " ").trim()).slice(0, KIT.caps.summary).join("") : "";

  const recipe: ModelRecipe = { version: 1, kind, summary, build, colors, extras };
  const capped = enforceCaps(recipe);
  return capped ? { ok: true, recipe: capped } : { ok: false };
}

/**
 * A motion answer made into valid motions for the clips this role needs. Tracks on joints the model lacks are dropped and reported in
 * `skipped`; a clip left with no track takes the kit's default motion.
 */
export function repairMotions(
  raw: unknown,
  context: { recipe: ModelRecipe; clips: readonly ClipKey[] },
): { ok: true; motions: MotionRecipe; skipped: Skipped[] } | { ok: false } {
  if (!isObject(raw) || !isObject(raw.motions)) return { ok: false };
  const asked = raw.motions;
  const joints = new Set(jointsOf(context.recipe));
  const defaults = defaultMotions(context.recipe, context.clips).motions;
  const motions: MotionRecipe["motions"] = {};
  const skipped: Skipped[] = [];
  const seen = new Set<string>();

  for (const clip of context.clips) {
    const fallback = defaults[clip];
    if (!fallback) continue;
    const given = Object.hasOwn(asked, clip) ? asked[clip] : undefined;
    if (!isObject(given)) {
      motions[clip] = clone(fallback);
      continue;
    }
    const seconds = isNumber(given.seconds) ? clamp(given.seconds, KIT.motion.seconds[0], KIT.motion.seconds[1]) : fallback.seconds;
    const tracks: Track[] = [];
    for (const t of Array.isArray(given.tracks) ? given.tracks : []) {
      if (!isObject(t)) continue;
      if (!oneOf(CHANNELS, t.channel) || !oneOf(AXES, t.axis) || !oneOf(WAVES, t.wave)) continue;
      if (t.wave === "spin" && t.channel !== "rotate") continue;
      if (!isNumber(t.amplitude) || typeof t.joint !== "string") continue;
      if (!joints.has(t.joint)) {
        const joint = t.joint.replace(CONTROL, "").slice(0, 40);
        const key = `${clip}|${joint}`;
        if (!seen.has(key)) {
          seen.add(key);
          skipped.push({ clip: CLIP_NAMES[clip], joint });
        }
        continue;
      }
      const [lo, hi] = KIT.motion.amplitude[t.channel as Channel];
      let cycles = clamp(isNumber(t.cycles) ? t.cycles : 1, KIT.motion.cycles[0], KIT.motion.cycles[1]);
      if (clip === "run" || clip === "loop") cycles = Math.max(1, Math.round(cycles)); // a whole number of cycles loops seamlessly
      tracks.push({
        joint: t.joint,
        channel: t.channel as Channel,
        axis: t.axis as Axis,
        wave: t.wave as Wave,
        amplitude: clamp(t.amplitude, lo, hi),
        cycles,
        phase: isNumber(t.phase) ? clamp(t.phase, KIT.motion.phase[0], KIT.motion.phase[1]) : 0,
      });
    }
    motions[clip] = tracks.length > 0 ? { seconds, tracks: tracks.slice(0, KIT.caps.tracks) } : clone(fallback);
  }
  return { ok: true, motions: { version: 1, motions }, skipped };
}

/** A palette index from Claude's answer: rounded and kept within 0 to 4; anything that is not a number takes the meadow's. */
const paletteIndex = (value: unknown, fallback: number): number => (isNumber(value) ? clamp(Math.round(value), 0, 4) : fallback);

/**
 * Claude's environment, repaired: each index rounded and clamped, scenery cut to the kit's known pieces (each once, the first three), and
 * the meadow's pieces when none are left. Only a non-object fails.
 */
export function repairEnvironment(raw: unknown): { ok: true; design: EnvironmentDesign } | { ok: false } {
  if (!isObject(raw)) return { ok: false };
  const named = Array.isArray(raw.scenery) ? raw.scenery : [];
  const scenery: SceneryKind[] = [];
  for (const piece of named) {
    if (oneOf(SCENERY_KINDS, piece) && !scenery.includes(piece)) scenery.push(piece);
  }
  const kept = scenery.slice(0, MAX_SCENERY);
  return {
    ok: true,
    design: {
      version: 1,
      sky: paletteIndex(raw.sky, DEFAULT_ENVIRONMENT.sky),
      field: paletteIndex(raw.field, DEFAULT_ENVIRONMENT.field),
      stripe: paletteIndex(raw.stripe, DEFAULT_ENVIRONMENT.stripe),
      scenery: kept.length > 0 ? kept : [...DEFAULT_ENVIRONMENT.scenery],
    },
  };
}
