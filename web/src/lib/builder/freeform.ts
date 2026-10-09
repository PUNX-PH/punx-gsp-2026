// The freeform recipe: a model composed from a list of parts (ellipsoid, capsule, box, loft, ...), so a fox, a ship or a lamp each get their own
// silhouette. The same rules as blender-worker/scripts/freeform.py (check_model) and blender-worker/recipe.mjs (checkModelBody); the numbers come from
// the kit (kit.json `freeform`). Claude's answer is untrusted: `repairFreeform` clamps and drops until it is valid, or fails. Pure.
import { FINISHES, KIT, type Finish } from "@/lib/builder/kinds";
import type { Role } from "@/lib/graph/types";

export const FREEFORM_SHAPES = ["ellipsoid", "capsule", "cylinder", "box", "torus", "lump", "tube", "revolve", "loft"] as const;
export type FreeformShape = (typeof FREEFORM_SHAPES)[number];

export const FREEFORM_RIGS = Object.keys(KIT.freeform.rigs) as (keyof typeof KIT.freeform.rigs)[];
export type FreeformRig = (typeof FREEFORM_RIGS)[number];

export const FREEFORM_ROLES = ["hero", "prop", "scenery"] as const;
export type FreeformRole = (typeof FREEFORM_ROLES)[number];
export const TARGETS = ["pc", "mobile"] as const;
export type Target = (typeof TARGETS)[number];
/** The stock clips a freeform model can have: the worker puts a motion for each on the model (there are no joints to animate). */
export const FREEFORM_CLIPS = ["Run", "Jump", "Loop"] as const;
export type FreeformClip = (typeof FREEFORM_CLIPS)[number];

type Vec3 = [number, number, number];
export interface FreeformSection {
  z: number;
  w?: number;
  h?: number;
  round?: number;
  dx?: number;
  dy?: number;
}
export interface FreeformPart {
  shape: FreeformShape;
  at?: Vec3;
  size?: Vec3;
  rot?: Vec3;
  material?: number;
  mirror?: boolean;
  /** A joint of the recipe's rig: the part moves with that joint (a leg swings, a head nods). Without one it is part of the body. */
  joint?: string;
  detail?: number;
  taper?: number;
  bevel?: number;
  thickness?: number;
  seed?: number;
  points?: Vec3[];
  radius?: number;
  profile?: [number, number][];
  sections?: FreeformSection[];
}
export interface FreeformMaterial {
  color: number;
  finish: Finish;
}
export interface FreeformRecipe {
  version: 2;
  kind: "model";
  summary: string;
  /** A rig gives the model joints its parts can be bound to, and stock Run and Jump clips that swing them. Without one the whole body moves as one. */
  rig?: FreeformRig;
  materials: FreeformMaterial[];
  parts: FreeformPart[];
}
/** What a freeform build sends the worker: no motions (a freeform model has no clips yet); the role picks the triangle budget, the target its column. */
export interface FreeformBody {
  recipe: FreeformRecipe;
  palette: string[];
  role: FreeformRole;
  target: Target;
  clips: FreeformClip[];
}

const { caps: CAPS, budgets: BUDGETS } = KIT.freeform;
export const FREEFORM_CAPS = CAPS;
export const freeformBudget = (role: FreeformRole, target: Target): number => BUDGETS[role][target];

/** The clips a graph role needs: the hero runs and jumps, a collectible turns, an obstacle stands still. */
export const freeformClipsOf = (role: Role): FreeformClip[] => (role === "hero" ? ["Run", "Jump"] : role === "collectible" ? ["Loop"] : []);

/** The budget class of a graph role: the hero is the one big model, everything else the player meets is a prop. */
export const freeformRoleOf = (role: Role): FreeformRole => (role === "hero" ? "hero" : "prop");

export const isFreeformRecipe = (recipe: unknown): recipe is FreeformRecipe => typeof recipe === "object" && recipe !== null && (recipe as { kind?: unknown }).kind === "model";

const HEX = /^#[0-9a-fA-F]{6}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const PART_KEYS = ["shape", "at", "size", "rot", "material", "mirror", "detail", "taper", "bevel", "thickness", "seed", "points", "radius", "profile", "sections", "joint"];
const SECTION_KEYS = ["z", "w", "h", "round", "dx", "dy"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const shown = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 40)) : isNumber(v) ? String(v) : typeof v);
const inRange = (v: unknown, low: number, high: number): boolean => isNumber(v) && v >= low && v <= high;
const wholeIn = (v: unknown, low: number, high: number): boolean => Number.isInteger(v) && (v as number) >= low && (v as number) <= high;
const vecProblem = (v: unknown, n: number, low: number, high: number, where: string): string | null =>
  Array.isArray(v) && v.length === n && v.every((x) => inRange(x, low, high)) ? null : `${where}: must be ${n} numbers within ${low} to ${high}`;

function keysProblem(obj: Record<string, unknown>, expected: readonly string[], where: string): string | null {
  const own = Object.keys(obj);
  for (const k of own) if (!expected.includes(k)) return `${where}: unknown field ${shown(k)}`;
  for (const k of expected) if (!own.includes(k)) return `${where}: missing field ${k}`;
  return null;
}

/** null when the recipe is valid; otherwise a short problem that names the field. Never throws. The same rules and words as the worker's. */
export function checkFreeformRecipe(recipe: unknown): string | null {
  if (!isObject(recipe)) return "recipe: must be an object";
  const { extent } = CAPS;
  const keys = keysProblem(recipe, ["version", "kind", "summary", "materials", "parts", ...(Object.hasOwn(recipe, "rig") ? ["rig"] : [])], "recipe");
  if (keys) return keys;
  if (recipe.version !== 2) return "recipe.version: must be 2";
  if (typeof recipe.summary !== "string") return "recipe.summary: must be text";
  if (Array.from(recipe.summary).length > KIT.caps.summary) return `recipe.summary: longer than ${KIT.caps.summary} characters`;
  if (CONTROL.test(recipe.summary)) return "recipe.summary: has a control character";
  if (Object.hasOwn(recipe, "rig") && (typeof recipe.rig !== "string" || !(FREEFORM_RIGS as string[]).includes(recipe.rig))) return `recipe.rig: ${shown(recipe.rig)} is not one of ${FREEFORM_RIGS.join(", ")}`;
  const { materials, parts } = recipe;
  if (!Array.isArray(materials) || materials.length < 1 || materials.length > CAPS.materials) return `recipe.materials: a list of 1 to ${CAPS.materials}`;
  for (const [i, m] of materials.entries()) {
    if (!isObject(m)) return `recipe.materials[${i}]: must be an object`;
    const mk = keysProblem(m, ["color", "finish"], `recipe.materials[${i}]`);
    if (mk) return mk;
    if (!wholeIn(m.color, 0, 4)) return `recipe.materials[${i}].color: must be a whole number 0 to 4`;
    if (typeof m.finish !== "string" || !(FINISHES as readonly string[]).includes(m.finish)) return `recipe.materials[${i}].finish: ${shown(m.finish)} is not one of ${FINISHES.join(", ")}`;
  }
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > CAPS.parts) return `recipe.parts: a list of 1 to ${CAPS.parts}`;
  for (const [i, p] of parts.entries()) {
    const at = `recipe.parts[${i}]`;
    if (!isObject(p)) return `${at}: must be an object`;
    for (const k of Object.keys(p)) if (!PART_KEYS.includes(k)) return `${at}: unknown field ${shown(k)}`;
    if (typeof p.shape !== "string" || !(FREEFORM_SHAPES as readonly string[]).includes(p.shape)) return `${at}.shape: ${shown(p.shape)} is not one of ${FREEFORM_SHAPES.join(", ")}`;
    if (Object.hasOwn(p, "material") && !wholeIn(p.material, 0, materials.length - 1)) return `${at}.material: must be a whole number 0 to ${materials.length - 1}`;
    if (Object.hasOwn(p, "detail") && !wholeIn(p.detail, 1, 3)) return `${at}.detail: must be 1, 2 or 3`;
    if (Object.hasOwn(p, "mirror") && typeof p.mirror !== "boolean") return `${at}.mirror: must be true or false`;
    if (Object.hasOwn(p, "joint") && (typeof recipe.rig !== "string" || typeof p.joint !== "string" || !KIT.freeform.rigs[recipe.rig as FreeformRig].includes(p.joint))) return `${at}.joint: ${shown(p.joint)} is not a joint of this model's rig`;
    const vec = (name: string, low: number, high: number) => (Object.hasOwn(p, name) ? vecProblem(p[name], 3, low, high, `${at}.${name}`) : null);
    const bad = vec("at", -extent, extent) ?? vec("size", 0.005, extent) ?? vec("rot", -360, 360);
    if (bad) return bad;
    const numeric: Record<string, [string, number, number][]> = {
      cylinder: [["taper", 0, 1]],
      box: [["bevel", 0, 0.45]],
      torus: [["thickness", 0.05, 0.9]],
      lump: [["seed", 0, 1000]],
      tube: [["radius", 0.005, extent], ["taper", 0, 1]],
    };
    for (const [name, low, high] of numeric[p.shape] ?? []) {
      if (Object.hasOwn(p, name) && !inRange(p[name], low, high)) return `${at}.${name}: must be a number ${low} to ${high}`;
    }
    if (p.shape === "tube") {
      const pts = p.points;
      if (!Array.isArray(pts) || pts.length < 2 || pts.length > CAPS.points) return `${at}.points: a list of 2 to ${CAPS.points} points`;
      for (const pt of pts) {
        const problem = vecProblem(pt, 3, -extent, extent, `${at}.points`);
        if (problem) return problem;
      }
      if ((pts as Vec3[]).some((pt, j) => j > 0 && Math.hypot(pt[0] - pts[j - 1][0], pt[1] - pts[j - 1][1], pt[2] - pts[j - 1][2]) <= 1e-4)) return `${at}.points: two points in a row are the same`;
    }
    if (p.shape === "revolve") {
      const profile = p.profile;
      if (!Array.isArray(profile) || profile.length < 2 || profile.length > CAPS.profile) return `${at}.profile: a list of 2 to ${CAPS.profile} pairs`;
      for (const pair of profile) {
        const problem = vecProblem(pair, 2, -extent, extent, `${at}.profile`);
        if (problem) return problem;
        if ((pair as number[])[0] < 0) return `${at}.profile: a radius cannot be negative`;
      }
    }
    if (p.shape === "loft") {
      const sections = p.sections;
      if (!Array.isArray(sections) || sections.length < 2 || sections.length > CAPS.sections) return `${at}.sections: a list of 2 to ${CAPS.sections} sections`;
      for (const s of sections) {
        if (!isObject(s) || !Object.keys(s).every((k) => SECTION_KEYS.includes(k)) || !Object.hasOwn(s, "z")) return `${at}.sections: each is { z, w, h, round, dx, dy } with z`;
        const ranges: [string, number, number][] = [["z", -extent, extent], ["w", 0, extent], ["h", 0, extent], ["round", 0, 1], ["dx", -extent, extent], ["dy", -extent, extent]];
        for (const [name, low, high] of ranges) if (Object.hasOwn(s, name) && !inRange(s[name], low, high)) return `${at}.sections.${name}: must be a number ${low} to ${high}`;
      }
    }
  }
  return null;
}

/** null when the body is valid; otherwise a short problem that names the field. The worker's checkBuildBody has the same rules. */
export function checkFreeformBody(body: unknown): string | null {
  if (!isObject(body)) return "body: must be an object";
  const keys = keysProblem(body, ["recipe", "palette", "role", "target", "clips"], "body");
  if (keys) return keys;
  if (typeof body.role !== "string" || !(FREEFORM_ROLES as readonly string[]).includes(body.role)) return `body.role: ${shown(body.role)} is not one of ${FREEFORM_ROLES.join(", ")}`;
  if (typeof body.target !== "string" || !(TARGETS as readonly string[]).includes(body.target)) return `body.target: ${shown(body.target)} is not pc or mobile`;
  const clips = body.clips;
  if (!Array.isArray(clips) || new Set(clips).size !== clips.length || !clips.every((c) => (FREEFORM_CLIPS as readonly unknown[]).includes(c))) return `body.clips: a list of at most one each of ${FREEFORM_CLIPS.join(", ")}`;
  const palette = body.palette;
  if (!Array.isArray(palette) || palette.length !== 5 || !palette.every((c) => typeof c === "string" && HEX.test(c))) return "palette: must be five #rrggbb colors";
  return checkFreeformRecipe(body.recipe);
}

// ---- repair: Claude's answer made into a valid recipe, or nothing ----

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const MAX_ANSWER_CHARS = 60_000;
/** The worker takes a body of 64 KiB; a repaired recipe (defaults filled in) must leave room for the palette and the rest. */
const MAX_RECIPE_CHARS = 56_000;

function number(v: unknown, low: number, high: number, fallback: number): number {
  return isNumber(v) ? clamp(v, low, high) : fallback;
}

function vector(v: unknown, low: number, high: number, fallback: Vec3): Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every(isNumber) ? (v.map((x) => clamp(x as number, low, high)) as Vec3) : fallback;
}

function repairPart(raw: unknown, materials: number, rig: FreeformRig | undefined): FreeformPart | null {
  if (!isObject(raw) || typeof raw.shape !== "string" || !(FREEFORM_SHAPES as readonly string[]).includes(raw.shape)) return null;
  const shape = raw.shape as FreeformShape;
  const { extent } = CAPS;
  const part: FreeformPart = {
    shape,
    at: vector(raw.at, -extent, extent, [0, 0, 0]),
    size: vector(raw.size, 0.005, extent, [1, 1, 1]),
    rot: vector(raw.rot, -360, 360, [0, 0, 0]),
    material: isNumber(raw.material) ? clamp(Math.round(raw.material), 0, materials - 1) : 0,
    mirror: raw.mirror === true,
    detail: isNumber(raw.detail) ? clamp(Math.round(raw.detail), 1, 3) : 2,
  };
  // a joint the rig does not have is only dropped: the part is then part of the body
  if (rig && typeof raw.joint === "string" && KIT.freeform.rigs[rig].includes(raw.joint)) part.joint = raw.joint;
  if (shape === "cylinder") part.taper = number(raw.taper, 0, 1, 1);
  if (shape === "box") part.bevel = number(raw.bevel, 0, 0.45, 0);
  if (shape === "torus") part.thickness = number(raw.thickness, 0.05, 0.9, 0.3);
  if (shape === "lump") part.seed = number(raw.seed, 0, 1000, 1);
  if (shape === "tube") {
    const points: Vec3[] = [];
    for (const p of (Array.isArray(raw.points) ? raw.points : []).slice(0, CAPS.points)) {
      if (!(Array.isArray(p) && p.length === 3 && p.every(isNumber))) continue;
      const next = vector(p, -extent, extent, [0, 0, 0]);
      const last = points[points.length - 1];
      if (!last || Math.hypot(next[0] - last[0], next[1] - last[1], next[2] - last[2]) > 1e-4) points.push(next);
    }
    if (points.length < 2) return null;
    part.points = points;
    part.radius = number(raw.radius, 0.005, extent, 0.1);
    part.taper = number(raw.taper, 0, 1, 1);
  }
  if (shape === "revolve") {
    const profile = (Array.isArray(raw.profile) ? raw.profile : [])
      .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(isNumber))
      .slice(0, CAPS.profile)
      .map(([r, y]) => [clamp(r, 0, extent), clamp(y, -extent, extent)] as [number, number]);
    if (profile.length < 2) return null;
    part.profile = profile;
  }
  if (shape === "loft") {
    const sections = (Array.isArray(raw.sections) ? raw.sections : [])
      .filter((s): s is Record<string, unknown> => isObject(s) && isNumber(s.z))
      .slice(0, CAPS.sections)
      .map((s): FreeformSection => ({
        z: clamp(s.z as number, -extent, extent),
        w: number(s.w, 0, extent, 1),
        h: number(s.h, 0, extent, 1),
        round: number(s.round, 0, 1, 1),
        dx: number(s.dx, -extent, extent, 0),
        dy: number(s.dy, -extent, extent, 0),
      }));
    if (sections.length < 2) return null;
    part.sections = sections;
  }
  return part;
}

/**
 * Claude's answer made into a valid freeform recipe, or `{ ok: false }`. The answer is `{ recipe: "<JSON text>" }` (one string field, because a big
 * schema is refused by the API) and the text is { summary, materials, parts }. Numbers are clamped into the kit's ranges, unknown fields and parts
 * with an unknown shape are dropped, a material index out of range becomes the first material, the lists are cut to their caps; at least one part must
 * survive. The result passes `checkFreeformRecipe`, or it is not returned.
 */
export function repairFreeform(raw: unknown): { ok: true; recipe: FreeformRecipe } | { ok: false } {
  let design: unknown = raw;
  if (isObject(raw) && typeof raw.recipe === "string") {
    if (raw.recipe.length > MAX_ANSWER_CHARS) return { ok: false };
    try {
      design = JSON.parse(raw.recipe);
    } catch {
      return { ok: false };
    }
  } else if (isObject(raw) && isObject(raw.recipe)) {
    design = raw.recipe;
  }
  if (!isObject(design)) return { ok: false };

  const materials: FreeformMaterial[] = (Array.isArray(design.materials) ? design.materials : [])
    .filter(isObject)
    .slice(0, CAPS.materials)
    .map((m) => ({
      color: isNumber(m.color) ? clamp(Math.round(m.color), 0, 4) : 0,
      finish: typeof m.finish === "string" && (FINISHES as readonly string[]).includes(m.finish) ? (m.finish as Finish) : "matte",
    }));
  if (materials.length === 0) materials.push({ color: 3, finish: "painted" });
  const rig = typeof design.rig === "string" && (FREEFORM_RIGS as string[]).includes(design.rig) ? (design.rig as FreeformRig) : undefined;
  const parts = (Array.isArray(design.parts) ? design.parts : [])
    .map((p) => repairPart(p, materials.length, rig))
    .filter((p): p is FreeformPart => p !== null)
    .slice(0, CAPS.parts);
  if (parts.length === 0) return { ok: false };
  const summary = typeof design.summary === "string" ? Array.from(design.summary.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, KIT.caps.summary).join("") : "";

  const recipe: FreeformRecipe = { version: 2, kind: "model", summary, ...(rig ? { rig } : {}), materials, parts };
  return checkFreeformRecipe(recipe) === null && JSON.stringify(recipe).length <= MAX_RECIPE_CHARS ? { ok: true, recipe } : { ok: false };
}
