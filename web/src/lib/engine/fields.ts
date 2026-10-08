// The parameters of every behavior, event and action: one table that the checker and the JSON schema for Claude are both built from.
import { ACTION_NAMES, AXES, BEHAVIOR_NAMES, CONTROL_NAMES, DIRECTIONS, EVENT_NAMES, OPERATORS, SPAWN_PATTERNS, TARGETS } from "./spec";

export type FieldSpec =
  | { kind: "int"; min: number; max: number }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "bool" }
  | { kind: "entity" }
  | { kind: "counter" };
export type Fields = Record<string, FieldSpec>;

const int = (min: number, max: number): FieldSpec => ({ kind: "int", min, max });
const oneOf = (values: readonly string[]): FieldSpec => ({ kind: "enum", values });

export const COUNTER_LIMIT = 1_000_000;
export const SPEED = int(-100_000, 100_000);
export const COUNTER_VALUE = int(-COUNTER_LIMIT, COUNTER_LIMIT);

export const BEHAVIOR_FIELDS: Record<(typeof BEHAVIOR_NAMES)[number], Fields> = {
  move: { dir: oneOf(DIRECTIONS), speed: SPEED },
  lane: { count: int(2, 5), switchMs: int(1, 5000) },
  oscillate: { axis: oneOf(AXES), amplitude: int(0, 50_000), periodMs: int(100, 60_000) },
  fall: { speed: SPEED },
  follow: { target: { kind: "entity" }, speed: SPEED },
  control: { on: oneOf(["tap", "hold"]), does: oneOf(CONTROL_NAMES), power: SPEED },
  spawn: { entity: { kind: "entity" }, pattern: oneOf(SPAWN_PATTERNS), intervalMs: int(100, 60_000), speed: int(0, 100_000), ramp: { kind: "bool" } },
  lifetime: { ms: int(1, 600_000) },
};

export const EVENT_FIELDS: Record<(typeof EVENT_NAMES)[number], Fields> = {
  start: {},
  tick: { everyMs: int(100, 600_000) },
  tap: {},
  hold: {},
  release: {},
  collide: { a: { kind: "entity" }, b: { kind: "entity" } },
  exitBounds: { entity: { kind: "entity" } },
  counterReaches: { counter: { kind: "counter" }, value: COUNTER_VALUE },
};

export const ACTION_FIELDS: Record<(typeof ACTION_NAMES)[number], Fields> = {
  add: { counter: { kind: "counter" }, n: COUNTER_VALUE },
  set: { counter: { kind: "counter" }, n: COUNTER_VALUE },
  destroy: { target: oneOf(TARGETS) },
  spawn: { entity: { kind: "entity" } },
  bounce: { target: oneOf(["a", "b"]) },
  win: {},
  lose: {},
  speedUp: { percent: int(1, 300) },
};

export const CONDITION_FIELDS: Fields = { counter: { kind: "counter" }, op: oneOf(OPERATORS), value: COUNTER_VALUE };
