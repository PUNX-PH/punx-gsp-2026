// repairSpec: what Claude's answer is fixed to before the checker sees it. It clamps and rounds numbers, drops what is not in the vocabulary or
// points at nothing, trims to the caps from the end, and turns the schema's named lists back into maps. The result always passes checkSpec, or
// the answer is null (nothing usable). Every change is a short note.
import { checkSpec } from "./check";
import { ACTION_FIELDS, BEHAVIOR_FIELDS, CONDITION_FIELDS, EVENT_FIELDS, type FieldSpec, type Fields } from "./fields";
import { CAMERAS, COLLIDERS, ENGINE_CAPS, ENGINE_VERSION, PRIMITIVES, ROLES, type GameSpec } from "./spec";

const NAME = /^[a-z][a-zA-Z0-9]{0,15}$/;
const MODEL_NAME = /^[a-z][a-zA-Z0-9-]{0,31}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_PALETTE = ["#e8553d", "#2b2d42", "#f4c430", "#8ecae6", "#6a994e"];

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Fixer {
  notes: string[] = [];

  /** A whole number in range, or undefined when `v` is not a number at all. */
  num(v: unknown, min: number, max: number, path: string): number | undefined {
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    const fixed = Math.min(max, Math.max(min, Math.round(v)));
    if (fixed !== v) this.notes.push(`${path}: ${v} became ${fixed}`);
    return fixed;
  }

  /** Reads the fields of a tagged item; null when it must be dropped (a note says why). Name references are left as strings. */
  tagged(v: unknown, table: Record<string, Fields>, what: string, path: string): Obj | null {
    if (!isObject(v) || typeof v.type !== "string" || !Object.hasOwn(table, v.type)) {
      this.notes.push(`${path}: dropped an unknown ${what} "${isObject(v) ? String(v.type) : String(v)}"`);
      return null;
    }
    const out: Obj = { type: v.type };
    for (const [key, spec] of Object.entries(table[v.type]) as [string, FieldSpec][]) {
      const value = this.field(v[key], spec, `${path}.${key}`);
      if (value === undefined) {
        this.notes.push(`${path}: dropped a ${what} "${v.type}" with a bad ${key}`);
        return null;
      }
      out[key] = value;
    }
    return out;
  }

  field(v: unknown, spec: FieldSpec, path: string): unknown {
    if (spec.kind === "int") return this.num(v, spec.min, spec.max, path);
    if (spec.kind === "bool") return typeof v === "boolean" ? v : undefined;
    if (spec.kind === "enum") return typeof v === "string" && spec.values.includes(v) ? v : undefined;
    return typeof v === "string" ? v : undefined;
  }
}

/** Counters and entities arrive as named lists (the schema) or as maps (a stored spec); both become a list of [name, value]. */
function named(v: unknown, valueOf: (item: Obj) => unknown): [string, unknown][] {
  if (Array.isArray(v)) return v.filter(isObject).filter((i) => typeof i.name === "string").map((i) => [i.name as string, valueOf(i)]);
  if (isObject(v)) return Object.entries(v);
  return [];
}

export function repairSpec(raw: unknown): { spec: GameSpec; notes: string[] } | null {
  if (!isObject(raw)) return null;
  const fx = new Fixer();

  const w = isObject(raw.world) ? raw.world : {};
  const camera = typeof w.camera === "string" && (CAMERAS as readonly string[]).includes(w.camera) ? w.camera : "side";
  const world = {
    camera,
    gravity: fx.num(w.gravity, -100_000, 100_000, "world.gravity") ?? 0,
    width: fx.num(w.width, 1000, 100_000, "world.width") ?? 12_000,
    height: fx.num(w.height, 1000, 100_000, "world.height") ?? 6000,
    scroll: fx.num(w.scroll, -50_000, 50_000, "world.scroll") ?? 0,
  };

  let counterList = named(raw.counters, (i) => i.value).filter(([n]) => NAME.test(n));
  if (counterList.length > ENGINE_CAPS.counters) {
    fx.notes.push(`counters: kept the first ${ENGINE_CAPS.counters}`);
    counterList = counterList.slice(0, ENGINE_CAPS.counters);
  }
  const counters: Record<string, number> = {};
  for (const [n, v] of counterList) counters[n] = fx.num(v, -1_000_000, 1_000_000, `counters.${n}`) ?? 0;

  const palette = (Array.isArray((raw.look as Obj | undefined)?.palette) ? ((raw.look as Obj).palette as unknown[]) : [])
    .filter((c): c is string => typeof c === "string" && HEX.test(c))
    .slice(0, 5);
  if (palette.length === 0) palette.push(...DEFAULT_PALETTE);

  // Entities: valid names and roles, fields clamped, behaviors read; one hero.
  const entities: Record<string, Obj> = {};
  for (const [name, value] of named(raw.entities, (i) => {
    const rest = { ...i };
    delete rest.name;
    return rest;
  })) {
    if (Object.keys(entities).some((kept) => kept.toLowerCase() === name.toLowerCase())) {
      fx.notes.push(`entities: dropped "${name}" (the same name as another, apart from capital letters)`);
      continue;
    }
    if (!NAME.test(name) || !isObject(value)) {
      fx.notes.push(`entities: dropped "${name}" (not a valid entity)`);
      continue;
    }
    const at = `entities.${name}`;
    if (typeof value.role !== "string" || !(ROLES as readonly string[]).includes(value.role)) {
      fx.notes.push(`${at}: dropped (unknown role)`);
      continue;
    }
    const behaviors = (Array.isArray(value.behaviors) ? value.behaviors : [])
      .slice(0, 8)
      .map((b, i) => fx.tagged(b, BEHAVIOR_FIELDS, "behavior", `${at}.behaviors[${i}]`))
      .filter((b): b is Obj => b !== null);
    const spawner = behaviors.some((b) => b.type === "spawn");
    const size = (v: unknown, p: string) => {
      const n = fx.num(v, 0, 20_000, p) ?? 500;
      return n === 0 && !spawner ? 500 : n;
    };
    const model = typeof value.model === "string" && (PRIMITIVES.includes(value.model as never) || MODEL_NAME.test(value.model)) ? value.model : "box";
    entities[name] = {
      role: value.role,
      model,
      color: fx.num(value.color, 0, 4, `${at}.color`) ?? 0,
      w: size(value.w, `${at}.w`),
      h: size(value.h, `${at}.h`),
      collider: typeof value.collider === "string" && (COLLIDERS as readonly string[]).includes(value.collider) ? value.collider : "box",
      x: fx.num(value.x, -100_000, 100_000, `${at}.x`) ?? 0,
      y: fx.num(value.y, -100_000, 100_000, `${at}.y`) ?? 0,
      behaviors,
    };
  }

  let names = Object.keys(entities);
  const hero = names.find((n) => entities[n].role === "hero");
  if (hero === undefined) return null;
  for (const n of names) if (n !== hero && entities[n].role === "hero") entities[n].role = "hazard";
  if (names.length > ENGINE_CAPS.entities) {
    const keep = names.slice(0, ENGINE_CAPS.entities);
    if (!keep.includes(hero)) keep[keep.length - 1] = hero;
    for (const n of names) if (!keep.includes(n)) delete entities[n];
    fx.notes.push(`entities: kept ${ENGINE_CAPS.entities}`);
    names = keep;
  }
  const spawners = new Set(names.filter((n) => (entities[n].behaviors as Obj[]).some((b) => b.type === "spawn")));
  for (const n of names) {
    entities[n].behaviors = (entities[n].behaviors as Obj[]).filter((b) => {
      const target = b.type === "spawn" ? b.entity : b.type === "follow" ? b.target : null;
      if (target === null) return true;
      const ok = names.includes(target as string) && !(b.type === "spawn" && spawners.has(target as string));
      if (!ok) fx.notes.push(`entities.${n}: dropped a ${String(b.type)} of "${String(target)}" (not a usable entity)`);
      return ok;
    });
    if (!(entities[n].behaviors as Obj[]).some((b) => b.type === "spawn")) {
      if (entities[n].w === 0) entities[n].w = 500;
      if (entities[n].h === 0) entities[n].h = 500;
    }
    if ((entities[n].color as number) >= palette.length) {
      fx.notes.push(`entities.${n}.color: ${entities[n].color} became ${palette.length - 1}`);
      entities[n].color = palette.length - 1;
    }
  }

  // Rules: events, conditions and actions read, references resolved, whole rules dropped when empty or dangling.
  const entityRefs = (o: Obj, keys: string[]) => keys.every((k) => o[k] === undefined || names.includes(o[k] as string));
  const hasCounter = (o: Obj) => o.counter === undefined || Object.hasOwn(counters, o.counter as string);
  const rules: Obj[] = [];
  (Array.isArray(raw.rules) ? raw.rules : []).forEach((r, i) => {
    if (!isObject(r)) return;
    const at = `rules[${i}]`;
    const on = fx.tagged(r.on, EVENT_FIELDS, "event", `${at}.on`);
    if (!on || !entityRefs(on, ["a", "b", "entity"]) || !hasCounter(on)) {
      if (on) fx.notes.push(`${at}: dropped (its event points at nothing)`);
      return;
    }
    const when = (Array.isArray(r.when) ? r.when : [])
      .slice(0, 4)
      .map((c, j) => {
        const out: Obj = {};
        for (const [key, spec] of Object.entries(CONDITION_FIELDS) as [string, FieldSpec][]) {
          const value = isObject(c) ? fx.field(c[key], spec, `${at}.when[${j}].${key}`) : undefined;
          if (value === undefined) return null;
          out[key] = value;
        }
        return out;
      })
      .filter((c): c is Obj => c !== null && hasCounter(c));
    const actions = (Array.isArray(r.do) ? r.do : [])
      .slice(0, 10)
      .map((a, j) => fx.tagged(a, ACTION_FIELDS, "action", `${at}.do[${j}]`))
      .filter((a): a is Obj => a !== null && entityRefs(a, ["entity"]) && hasCounter(a));
    if (actions.length === 0) {
      fx.notes.push(`${at}: dropped (no usable action)`);
      return;
    }
    rules.push({ on, ...(when.length > 0 ? { when } : {}), do: actions });
  });
  if (rules.length > ENGINE_CAPS.rules) {
    fx.notes.push(`rules: kept the first ${ENGINE_CAPS.rules}`);
    rules.length = ENGINE_CAPS.rules;
  }

  const ends = isObject(raw.ends) ? raw.ends : {};
  const difficulty = isObject(raw.difficulty) ? raw.difficulty : {};
  const candidate = {
    engine: ENGINE_VERSION,
    seed: fx.num(raw.seed, 1, 4_294_967_295, "seed") ?? 1,
    world,
    counters,
    entities,
    rules,
    ends: {
      timeLimitMs: fx.num(ends.timeLimitMs, 0, 600_000, "ends.timeLimitMs") ?? 60_000,
      winOnTime: typeof ends.winOnTime === "boolean" ? ends.winOnTime : true,
      scoreToWin: fx.num(ends.scoreToWin, 0, 1_000_000, "ends.scoreToWin") ?? 0,
    },
    difficulty: {
      rampMs: fx.num(difficulty.rampMs, 0, 600_000, "difficulty.rampMs") ?? 0,
      speedPercent: fx.num(difficulty.speedPercent, 0, 300, "difficulty.speedPercent") ?? 0,
      spawnPercent: fx.num(difficulty.spawnPercent, 0, 90, "difficulty.spawnPercent") ?? 0,
    },
    look: { palette },
  };
  const checked = checkSpec(candidate);
  return checked.ok ? { spec: checked.spec, notes: fx.notes } : null;
}
