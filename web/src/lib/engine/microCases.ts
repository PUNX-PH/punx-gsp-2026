// Small specs that each pin one boundary of the engine's semantics (a touching edge, a cap, a rounding, a cooldown). They are written to
// fixtures/specs and fixtures/logs with the others (see fixtures.test.ts), so the C# engine is held to every one of them. Found by mutation
// checks: each line of the simulator these cases pin made no difference to the three game fixtures.
import type { Action, Behavior, Entity, GameSpec, Rule } from "./spec";
import type { InputLog } from "./log";

const box = (role: Entity["role"], over: Partial<Entity> = {}): Entity => ({
  role, model: "box", color: 0, w: 800, h: 800, collider: "box", x: 0, y: 0, behaviors: [], ...over,
});

interface Parts {
  entities?: Record<string, Partial<Entity>>;
  hero?: Partial<Entity>;
  rules?: Rule[];
  world?: Partial<GameSpec["world"]>;
  ends?: Partial<GameSpec["ends"]>;
  difficulty?: Partial<GameSpec["difficulty"]>;
  counters?: Record<string, number>;
}

function spec(p: Parts): GameSpec {
  const entities: Record<string, Entity> = { hero: box("hero", { x: 2000, y: 0, ...p.hero }) };
  for (const [name, over] of Object.entries(p.entities ?? {})) entities[name] = box(over.role ?? "hazard", over);
  return {
    engine: 1, seed: 5,
    world: { camera: "side", gravity: 0, width: 10000, height: 6000, scroll: 0, ...p.world },
    counters: { score: 0, lives: 3, ...p.counters },
    entities, rules: p.rules ?? [],
    ends: { timeLimitMs: 5000, winOnTime: true, scoreToWin: 0, ...p.ends },
    difficulty: { rampMs: 0, speedPercent: 0, spawnPercent: 0, ...p.difficulty },
    look: { palette: ["#ff0000"] },
  };
}

const log = (steps: number, taps: number[] = [], holds: [number, number][] = []): InputLog => ({ steps, taps, holds });
const add = (counter: string, n: number): Action => ({ type: "add", counter, n });
/** A collision rule that removes the second object, so that each contact counts once. */
const hit = (a: string, b: string, ...actions: Action[]): Rule => ({ on: { type: "collide", a, b }, do: [...actions, { type: "destroy", target: "b" }] });
const move = (dir: "left" | "right" | "up" | "down", speed: number): Behavior => ({ type: "move", dir, speed });
const spawner = (entity: string, pattern: "stream" | "random", intervalMs: number, ramp = false): Behavior => ({ type: "spawn", entity, pattern, intervalMs, speed: 0, ramp });
const spawnerBox = (over: Partial<Entity>): Partial<Entity> => ({ w: 0, h: 0, ...over });

export const MICRO_CASES: { name: string; spec: GameSpec; log: InputLog }[] = [
  {
    // Hero 2000..2800 by 0..800. Edges that touch overlap (closed intervals); one more unit does not.
    name: "micro-touching-edges",
    spec: spec({
      entities: {
        right: { x: 2800, y: 0 }, rightGap: { x: 2801, y: 2000 },
        left: { x: 1200, y: 3000 }, leftGap: { x: 1199, y: 4000 },
        above: { x: 2000, y: 800, behaviors: [] }, aboveGap: { x: 5000, y: 801 },
      },
      rules: [
        hit("hero", "right", add("score", 1)), hit("hero", "rightGap", add("score", 10)),
        hit("hero", "left", add("score", 100)), hit("hero", "leftGap", add("score", 1000)),
        hit("hero", "above", add("score", 10000)), hit("hero", "aboveGap", add("score", 100000)),
      ],
    }),
    log: log(120),
  },
  {
    // Circles touch when the distance between centers equals the sum of the radii; a circle and a box use the circle's bounding box.
    name: "micro-circles",
    spec: spec({
      hero: { collider: "circle", w: 800, h: 800 },
      entities: {
        touching: { collider: "circle", w: 600, h: 600, x: 2800, y: 100 },
        apart: { collider: "circle", w: 600, h: 600, x: 2801, y: 2100 },
        corner: { collider: "circle", w: 800, h: 800, x: 2700, y: 700 },
        boxNear: { collider: "box", w: 500, h: 500, x: 2800, y: 4000 },
      },
      rules: [hit("hero", "touching", add("score", 1)), hit("hero", "apart", add("score", 10)), hit("hero", "corner", add("score", 100)), hit("hero", "boxNear", add("score", 1000))],
    }),
    log: log(120),
  },
  {
    // A spawner makes an object on the hero in step 30; spawns come before collisions, so the win is in that same step.
    name: "micro-spawn-before-collide",
    spec: spec({
      entities: {
        pile: spawnerBox({ role: "hazard", x: 2000, y: 0, behaviors: [spawner("lump", "stream", 500)] }),
        lump: { x: 0, y: 0 },
      },
      rules: [hit("hero", "lump", add("score", 1))],
      ends: { scoreToWin: 1, timeLimitMs: 0 },
    }),
    log: log(120),
  },
  {
    // 125 ms is 7.5 steps and rounds up to 8: ticks come every 8 steps.
    name: "micro-ms-rounding",
    spec: spec({ rules: [{ on: { type: "tick", everyMs: 125 }, do: [add("score", 1)] }] }),
    log: log(120),
  },
  {
    // A follower 50 away with a step of 100 lands on its target and stays there.
    name: "micro-follow-lands",
    spec: spec({ entities: { chaser: { x: 2050, y: 3000, behaviors: [{ type: "follow", target: "hero", speed: 6000 }] }, mark: { x: 2300, y: 3000 } } }),
    log: log(120),
  },
  {
    // Flip control: a tap flips gravity for the hero, so it rises instead of falling.
    name: "micro-flip",
    spec: spec({ hero: { y: 3000, behaviors: [{ type: "control", on: "tap", does: "flip", power: 0 }] }, world: { gravity: 12000 } }),
    log: log(180, [30, 90]),
  },
  {
    // Fire has a cooldown of 10 steps: a tap on step 10 after one on step 1 fires nothing, a tap on step 11 does.
    name: "micro-fire-cooldown",
    spec: spec({
      hero: { behaviors: [{ type: "control", on: "tap", does: "fire", power: 1000 }] },
      entities: { shot: { role: "projectile", w: 100, h: 100, x: 0, y: 0, behaviors: [{ type: "lifetime", ms: 600000 }] } },
    }),
    log: log(120, [1, 10, 21, 32, 42]),
  },
  {
    // counterReaches re-arms when the counter drops below its value: the rule fires on both crossings.
    name: "micro-counter-rearm",
    spec: spec({
      rules: [
        { on: { type: "counterReaches", counter: "score", value: 3 }, do: [add("lives", 1)] },
        { on: { type: "tap" }, when: [{ counter: "score", op: "<", value: 3 }], do: [{ type: "set", counter: "score", n: 3 }] },
        { on: { type: "release" }, do: [{ type: "set", counter: "score", n: 0 }] },
      ],
    }),
    log: log(120, [5, 20], [[5, 5], [20, 20]]),
  },
  {
    // An object leaves the field when its right edge passes 0: x + w < 0. Here that is step 20, and the round ends then.
    name: "micro-exit-bounds",
    spec: spec({
      entities: { drift: { x: -81, y: 3000, w: 100, h: 100, behaviors: [move("left", 60)] } },
      rules: [{ on: { type: "exitBounds", entity: "drift" }, do: [add("score", 1)] }],
      ends: { scoreToWin: 1, timeLimitMs: 0 },
    }),
    log: log(60),
  },
  {
    // An object is removed once it is outside by more than its own size: x + w < -w, which is step 120 here.
    name: "micro-cleanup-margin",
    spec: spec({ entities: { drift: { x: -81, y: 3000, w: 100, h: 100, behaviors: [move("left", 60)] } } }),
    log: log(180),
  },
  {
    // At most 10 spawns in any 60 steps (a ramp shrinks the interval to 1 step), and at most 150 live objects.
    name: "micro-spawn-caps",
    spec: spec({
      entities: {
        mill: spawnerBox({ role: "hazard", x: 5000, y: 3000, behaviors: [spawner("dust", "stream", 100, true)] }),
        dust: { w: 100, h: 100, x: 0, y: 0, behaviors: [{ type: "lifetime", ms: 600000 }] },
      },
      difficulty: { rampMs: 100, speedPercent: 0, spawnPercent: 90 },
      ends: { timeLimitMs: 0, scoreToWin: 0, winOnTime: true },
      rules: [{ on: { type: "tick", everyMs: 60000 }, do: [{ type: "win" }] }],
    }),
    log: log(1500),
  },
  {
    // The spawn action stops at 150 live objects (it has no rate limit): ticks every 100 ms make 150 in 15 seconds and no more after.
    name: "micro-spawn-action-cap",
    spec: spec({
      entities: { dust: { w: 100, h: 100, x: 5000, y: 3000, behaviors: [{ type: "lifetime", ms: 600000 }] } },
      rules: [{ on: { type: "tick", everyMs: 100 }, do: [{ type: "spawn", entity: "dust" }] }],
      ends: { timeLimitMs: 0 },
    }),
    log: log(1500),
  },
  {
    // Counters clamp at a million after every change: two adds of a million, then one of minus a million, leaves 0.
    name: "micro-counter-clamp",
    spec: spec({
      rules: [{ on: { type: "start" }, do: [add("score", 1000000), add("score", 1000000), add("score", -1000000), add("lives", -1000000), add("lives", -1000000), add("lives", 1000000)] }],
      ends: { timeLimitMs: 0 },
    }),
    log: log(60),
  },
  {
    // 201 actions in one step is over the cap of 200 and loses the round; 200 would not.
    name: "micro-action-cap",
    spec: spec({
      rules: [
        ...Array.from({ length: 20 }, () => ({ on: { type: "start" }, do: Array.from({ length: 10 }, () => add("score", 1)) }) as Rule),
        { on: { type: "start" }, do: [add("score", 1)] },
      ],
      ends: { timeLimitMs: 0 },
    }),
    log: log(60),
  },
];
