// The GameSpec: a described game as data. The vocabulary is closed; docs/superpowers/notes/engine-semantics.md says how each word plays, and a
// test keeps the name lists below equal to that note's tables. Every number is an integer: positions, sizes, speeds and counters are Milli
// (thousandths of a unit), times are milliseconds.

export const ENGINE_VERSION = 1;

export const ENGINE_CAPS = {
  entities: 12,
  rules: 40,
  counters: 9,
  liveObjects: 150,
  spawnsPerSecond: 10,
  actionsPerStep: 200,
  specBytes: 65536,
  generatedAssets: 6,
} as const;

/** Thousandths of a unit, always an integer. */
export type Milli = number;

export const CAMERAS = ["side", "top", "behind"] as const;
export type Camera = (typeof CAMERAS)[number];

export const ROLES = ["hero", "hazard", "pickup", "platform", "projectile"] as const;
export type EntityRole = (typeof ROLES)[number];

export const PRIMITIVES = ["box", "sphere", "capsule", "cylinder"] as const;
export const COLLIDERS = ["box", "circle"] as const;
export const DIRECTIONS = ["left", "right", "up", "down"] as const;
export const AXES = ["x", "y"] as const;

export const BEHAVIOR_NAMES = ["move", "lane", "oscillate", "fall", "follow", "control", "spawn", "lifetime"] as const;
export const CONTROL_NAMES = ["jump", "flap", "flip", "fire", "switchLane", "thrust"] as const;
export const SPAWN_PATTERNS = ["random", "lanes", "wave", "rain", "stream"] as const;
export const EVENT_NAMES = ["start", "tick", "tap", "hold", "release", "collide", "exitBounds", "counterReaches"] as const;
export const ACTION_NAMES = ["add", "set", "destroy", "spawn", "bounce", "win", "lose", "speedUp"] as const;
export const OPERATORS = ["<", "<=", "==", ">=", ">"] as const;
export const TARGETS = ["a", "b", "self"] as const;

export type Control = (typeof CONTROL_NAMES)[number];
export type SpawnPattern = (typeof SPAWN_PATTERNS)[number];
export type Operator = (typeof OPERATORS)[number];

export type Behavior =
  | { type: "move"; dir: (typeof DIRECTIONS)[number]; speed: Milli }
  | { type: "lane"; count: number; switchMs: number }
  | { type: "oscillate"; axis: (typeof AXES)[number]; amplitude: Milli; periodMs: number }
  | { type: "fall"; speed: Milli }
  | { type: "follow"; target: string; speed: Milli }
  | { type: "control"; on: "tap" | "hold"; does: Control; power: Milli }
  | { type: "spawn"; entity: string; pattern: SpawnPattern; intervalMs: number; speed: Milli; ramp: boolean }
  | { type: "lifetime"; ms: number };

export interface Entity {
  role: EntityRole;
  /** An input name from the graph, or one of PRIMITIVES. */
  model: string;
  /** A palette slot 0 to 4. */
  color: number;
  w: Milli;
  h: Milli;
  collider: (typeof COLLIDERS)[number];
  x: Milli;
  y: Milli;
  behaviors: Behavior[];
}

export type GameEvent =
  | { type: "start" }
  | { type: "tick"; everyMs: number }
  | { type: "tap" }
  | { type: "hold" }
  | { type: "release" }
  | { type: "collide"; a: string; b: string }
  | { type: "exitBounds"; entity: string }
  | { type: "counterReaches"; counter: string; value: Milli };

export interface Condition {
  counter: string;
  op: Operator;
  value: Milli;
}

export type Action =
  | { type: "add"; counter: string; n: Milli }
  | { type: "set"; counter: string; n: Milli }
  | { type: "destroy"; target: (typeof TARGETS)[number] }
  | { type: "spawn"; entity: string }
  | { type: "bounce"; target: "a" | "b" }
  | { type: "win" }
  | { type: "lose" }
  | { type: "speedUp"; percent: number };

export interface Rule {
  on: GameEvent;
  when?: Condition[];
  do: Action[];
}

export interface GameSpec {
  engine: typeof ENGINE_VERSION;
  seed: number;
  world: { camera: Camera; gravity: Milli; width: Milli; height: Milli; scroll: Milli };
  /** Named counters with their start values; `score`, `lives` and `time` are the usual ones. */
  counters: Record<string, Milli>;
  entities: Record<string, Entity>;
  rules: Rule[];
  ends: { timeLimitMs: number; winOnTime: boolean; scoreToWin: number };
  difficulty: { rampMs: number; speedPercent: number; spawnPercent: number };
  look: { palette: string[] };
}
