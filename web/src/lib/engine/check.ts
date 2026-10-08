// checkSpec: the one place a GameSpec is accepted or refused, with a sentence a person or Claude can act on. The player's parser repeats these
// rules (same messages, shared bad-spec fixtures). Own keys only: a key such as "__proto__" is just an unknown name.
import {
  ACTION_FIELDS,
  BEHAVIOR_FIELDS,
  CONDITION_FIELDS,
  COUNTER_LIMIT,
  EVENT_FIELDS,
  type FieldSpec,
  type Fields,
} from "./fields";
import { CAMERAS, COLLIDERS, ENGINE_CAPS, ENGINE_VERSION, PRIMITIVES, ROLES, type GameSpec } from "./spec";

export type CheckResult = { ok: true; spec: GameSpec } | { ok: false; error: string };

const NAME = /^[a-z][a-zA-Z0-9]{0,15}$/;
const MODEL_NAME = /^[a-z][a-zA-Z0-9-]{0,31}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_BEHAVIORS = 8;
const MAX_ACTIONS = 10;
const MAX_CONDITIONS = 4;

class Refusal extends Error {}
const refuse = (path: string, problem: string): never => {
  throw new Refusal(`${path}: ${problem}`);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) refuse(path, `unknown field "${key}"`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) refuse(path, `missing field "${key}"`);
}

function whole(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return refuse(path, "must be a whole number");
  if (value < min || value > max) return refuse(path, `must be between ${min} and ${max}`);
  return value;
}

interface Refs {
  entities: { path: string; name: string }[];
  counters: { path: string; name: string }[];
}

function checkFields(value: Record<string, unknown>, fields: Fields, path: string, refs: Refs): void {
  for (const [key, spec] of Object.entries(fields) as [string, FieldSpec][]) {
    const at = `${path}.${key}`;
    const v = value[key];
    if (spec.kind === "int") whole(v, spec.min, spec.max, at);
    else if (spec.kind === "bool") {
      if (typeof v !== "boolean") refuse(at, "must be true or false");
    } else if (spec.kind === "enum") {
      if (typeof v !== "string" || !spec.values.includes(v)) refuse(at, `must be one of ${spec.values.join(", ")}`);
    } else {
      if (typeof v !== "string") refuse(at, "must be a name");
      (spec.kind === "entity" ? refs.entities : refs.counters).push({ path: at, name: v as string });
    }
  }
}

/** A `{ type, ...params }` object whose type is a key of `table`. */
function checkTagged(value: unknown, table: Record<string, Fields>, what: string, path: string, refs: Refs): void {
  if (!isObject(value)) return refuse(path, "must be an object");
  const type = value.type;
  if (typeof type !== "string" || !Object.hasOwn(table, type)) return refuse(path, `unknown ${what} "${String(type)}"`);
  onlyKeys(value, ["type", ...Object.keys(table[type])], path);
  checkFields(value, table[type], path, refs);
}

function checkMap(value: unknown, path: string, max: number, what: string): Record<string, unknown> {
  if (!isObject(value)) return refuse(path, "must be an object");
  const keys = Object.keys(value);
  if (keys.length > max) refuse(path, `at most ${max} ${what}`);
  for (const key of keys) if (!NAME.test(key)) refuse(path, `"${key}" is not a valid name (a letter, then letters and digits, up to 16)`);
  return value;
}

function checkEntity(value: unknown, path: string, refs: Refs): void {
  if (!isObject(value)) return refuse(path, "must be an object");
  onlyKeys(value, ["role", "model", "color", "w", "h", "collider", "x", "y", "behaviors"], path);
  if (typeof value.role !== "string" || !(ROLES as readonly string[]).includes(value.role)) refuse(`${path}.role`, `must be one of ${ROLES.join(", ")}`);
  const model = value.model;
  if (typeof model !== "string" || !(PRIMITIVES.includes(model as never) || MODEL_NAME.test(model))) refuse(`${path}.model`, "must be a model name or a primitive");
  whole(value.color, 0, 4, `${path}.color`);
  if (typeof value.collider !== "string" || !(COLLIDERS as readonly string[]).includes(value.collider)) refuse(`${path}.collider`, "must be box or circle");
  whole(value.w, 0, 20_000, `${path}.w`);
  whole(value.h, 0, 20_000, `${path}.h`);
  whole(value.x, -100_000, 100_000, `${path}.x`);
  whole(value.y, -100_000, 100_000, `${path}.y`);
  if (!Array.isArray(value.behaviors)) return refuse(`${path}.behaviors`, "must be a list");
  if (value.behaviors.length > MAX_BEHAVIORS) refuse(`${path}.behaviors`, `at most ${MAX_BEHAVIORS}`);
  const spawner = value.behaviors.some((b) => isObject(b) && b.type === "spawn");
  if ((value.w === 0 || value.h === 0) && !spawner) refuse(path, "only a spawner may have size 0");
  value.behaviors.forEach((b, i) => checkTagged(b, BEHAVIOR_FIELDS, "behavior", `${path}.behaviors[${i}]`, refs));
}

function checkRule(value: unknown, path: string, refs: Refs): void {
  if (!isObject(value)) return refuse(path, "must be an object");
  if (Object.keys(value).some((k) => k !== "on" && k !== "when" && k !== "do")) refuse(path, "unknown field");
  checkTagged(value.on, EVENT_FIELDS, "event", `${path}.on`, refs);
  if (value.when !== undefined) {
    if (!Array.isArray(value.when) || value.when.length > MAX_CONDITIONS) return refuse(`${path}.when`, `must be a list of at most ${MAX_CONDITIONS}`);
    value.when.forEach((c, i) => {
      const at = `${path}.when[${i}]`;
      if (!isObject(c)) return refuse(at, "must be an object");
      onlyKeys(c, Object.keys(CONDITION_FIELDS), at);
      checkFields(c, CONDITION_FIELDS, at, refs);
    });
  }
  if (!Array.isArray(value.do) || value.do.length === 0 || value.do.length > MAX_ACTIONS) return refuse(`${path}.do`, `must be a list of 1 to ${MAX_ACTIONS} actions`);
  value.do.forEach((a, i) => checkTagged(a, ACTION_FIELDS, "action", `${path}.do[${i}]`, refs));
}

function checkAll(input: unknown): GameSpec {
  if (!isObject(input)) return refuse("game", "must be an object");
  if (new TextEncoder().encode(JSON.stringify(input)).length > ENGINE_CAPS.specBytes) refuse("game", "is over 64 KiB");
  onlyKeys(input, ["engine", "seed", "world", "counters", "entities", "rules", "ends", "difficulty", "look"], "game");
  if (input.engine !== ENGINE_VERSION) refuse("engine", `must be ${ENGINE_VERSION}`);
  whole(input.seed, 1, 4_294_967_295, "seed");

  const world = input.world;
  if (!isObject(world)) return refuse("world", "must be an object");
  onlyKeys(world, ["camera", "gravity", "width", "height", "scroll"], "world");
  if (typeof world.camera !== "string" || !(CAMERAS as readonly string[]).includes(world.camera)) refuse("world.camera", `must be one of ${CAMERAS.join(", ")}`);
  whole(world.gravity, -100_000, 100_000, "world.gravity");
  whole(world.width, 1000, 100_000, "world.width");
  whole(world.height, 1000, 100_000, "world.height");
  whole(world.scroll, -50_000, 50_000, "world.scroll");

  const counters = checkMap(input.counters, "counters", ENGINE_CAPS.counters, "counters");
  for (const [name, v] of Object.entries(counters)) whole(v, -COUNTER_LIMIT, COUNTER_LIMIT, `counters.${name}`);

  const entities = checkMap(input.entities, "entities", ENGINE_CAPS.entities, "entities");
  const refs: Refs = { entities: [], counters: [] };
  for (const [name, e] of Object.entries(entities)) checkEntity(e, `entities.${name}`, refs);
  const heroes = Object.values(entities).filter((e) => isObject(e) && e.role === "hero").length;
  if (heroes !== 1) refuse("entities", "there must be exactly one hero");

  if (!Array.isArray(input.rules)) return refuse("rules", "must be a list");
  if (input.rules.length > ENGINE_CAPS.rules) refuse("rules", `at most ${ENGINE_CAPS.rules} rules`);
  input.rules.forEach((r, i) => checkRule(r, `rules[${i}]`, refs));

  for (const r of refs.entities) if (!Object.hasOwn(entities, r.name)) refuse(r.path, `unknown entity "${r.name}"`);
  for (const r of refs.counters) if (!Object.hasOwn(counters, r.name)) refuse(r.path, `unknown counter "${r.name}"`);
  for (const [name, e] of Object.entries(entities) as [string, { behaviors: { type: string; entity?: string }[] }][]) {
    for (const b of e.behaviors) {
      if (b.type === "spawn" && (entities[b.entity as string] as { behaviors: { type: string }[] }).behaviors.some((x) => x.type === "spawn")) {
        refuse(`entities.${name}`, `spawns "${b.entity}", which is itself a spawner`);
      }
    }
  }

  const ends = input.ends;
  if (!isObject(ends)) return refuse("ends", "must be an object");
  onlyKeys(ends, ["timeLimitMs", "winOnTime", "scoreToWin"], "ends");
  whole(ends.timeLimitMs, 0, 600_000, "ends.timeLimitMs");
  if (typeof ends.winOnTime !== "boolean") refuse("ends.winOnTime", "must be true or false");
  whole(ends.scoreToWin, 0, COUNTER_LIMIT, "ends.scoreToWin");

  const difficulty = input.difficulty;
  if (!isObject(difficulty)) return refuse("difficulty", "must be an object");
  onlyKeys(difficulty, ["rampMs", "speedPercent", "spawnPercent"], "difficulty");
  whole(difficulty.rampMs, 0, 600_000, "difficulty.rampMs");
  whole(difficulty.speedPercent, 0, 300, "difficulty.speedPercent");
  whole(difficulty.spawnPercent, 0, 90, "difficulty.spawnPercent");

  const look = input.look;
  if (!isObject(look)) return refuse("look", "must be an object");
  onlyKeys(look, ["palette"], "look");
  const palette = look.palette;
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > 5 || !palette.every((c) => typeof c === "string" && HEX.test(c))) {
    refuse("look.palette", "must be 1 to 5 colors like #aabbcc");
  }
  for (const [name, e] of Object.entries(entities) as [string, { color: number }][]) {
    if (e.color >= (palette as string[]).length) refuse(`entities.${name}.color`, `palette has only ${(palette as string[]).length} colors`);
  }
  return input as unknown as GameSpec;
}

export function checkSpec(input: unknown): CheckResult {
  try {
    return { ok: true, spec: checkAll(input) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    throw error;
  }
}

// ---- the JSON schema Claude writes to. Structured outputs need `additionalProperties: false` on every object, so the maps (counters, entities)
// are lists with a `name` here; repair turns them back into maps. ----

const fieldSchema = (f: FieldSpec): Record<string, unknown> =>
  f.kind === "int" ? { type: "integer" } : f.kind === "bool" ? { type: "boolean" } : f.kind === "enum" ? { type: "string", enum: [...f.values] } : { type: "string" };

const objectSchema = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const taggedSchema = (table: Record<string, Fields>): Record<string, unknown> => ({
  anyOf: Object.entries(table).map(([type, fields]) =>
    objectSchema({ type: { type: "string", enum: [type] }, ...Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, fieldSchema(f)])) }),
  ),
});

const int = { type: "integer" };

export const gameSpecSchema = {
  type: "object",
  additionalProperties: false,
  required: ["engine", "seed", "world", "counters", "entities", "rules", "ends", "difficulty", "look"],
  properties: {
    engine: { type: "integer", enum: [ENGINE_VERSION] },
    seed: int,
    world: objectSchema({ camera: { type: "string", enum: [...CAMERAS] }, gravity: int, width: int, height: int, scroll: int }),
    counters: { type: "array", items: objectSchema({ name: { type: "string" }, value: int }) },
    entities: {
      type: "array",
      items: objectSchema({
        name: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        model: { type: "string" },
        color: int,
        w: int,
        h: int,
        collider: { type: "string", enum: [...COLLIDERS] },
        x: int,
        y: int,
        behaviors: { type: "array", items: taggedSchema(BEHAVIOR_FIELDS) },
      }),
    },
    rules: {
      type: "array",
      items: objectSchema({
        on: taggedSchema(EVENT_FIELDS),
        when: { type: "array", items: objectSchema(Object.fromEntries(Object.entries(CONDITION_FIELDS).map(([k, f]) => [k, fieldSchema(f)]))) },
        do: { type: "array", items: taggedSchema(ACTION_FIELDS) },
      }),
    },
    ends: objectSchema({ timeLimitMs: int, winOnTime: { type: "boolean" }, scoreToWin: int }),
    difficulty: objectSchema({ rampMs: int, speedPercent: int, spawnPercent: int }),
    look: objectSchema({ palette: { type: "array", items: { type: "string" } } }),
  },
} as const;
