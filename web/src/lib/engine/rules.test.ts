import { describe, expect, it } from "vitest";
import { checkSpec } from "./check";
import { createSim } from "./sim";
import type { Action, Behavior, Entity, GameEvent, GameSpec, Rule } from "./spec";

const NONE = { tap: false, hold: false };

function make(rules: Rule[], extra: Record<string, Partial<Entity> & { behaviors?: Behavior[] }> = {}, counters: Record<string, number> = {}, tune: (s: GameSpec) => void = () => {}): GameSpec {
  const base = (role: Entity["role"], over: Partial<Entity> = {}): Entity => ({
    role, model: "box", color: 0, w: 800, h: 800, collider: "box", x: 0, y: 0, behaviors: [], ...over,
  });
  const entities: Record<string, Entity> = { hero: base("hero", { x: 2000, y: 0 }) };
  for (const [name, over] of Object.entries(extra)) entities[name] = base(over.role ?? "hazard", over);
  const spec: GameSpec = {
    engine: 1, seed: 1,
    world: { camera: "side", gravity: 0, width: 10000, height: 6000, scroll: 0 },
    counters: { score: 0, lives: 9, ...counters },
    entities, rules,
    ends: { timeLimitMs: 0, winOnTime: true, scoreToWin: 0 },
    difficulty: { rampMs: 0, speedPercent: 0, spawnPercent: 0 },
    look: { palette: ["#ff0000"] },
  };
  tune(spec);
  const r = checkSpec(spec);
  if (!r.ok) throw new Error(r.error);
  return spec;
}
const on = (event: GameEvent, ...actions: Action[]): Rule => ({ on: event, do: actions });
const add = (n: number): Action => ({ type: "add", counter: "score", n });
const score = (sim: ReturnType<typeof createSim>) => sim.state().counters.score;
const run = (sim: ReturnType<typeof createSim>, n: number, input = NONE) => {
  for (let i = 0; i < n; i++) sim.step(input);
};

describe("events", () => {
  it("start fires on the first step only", () => {
    const sim = createSim(make([on({ type: "start" }, add(1))]));
    run(sim, 5);
    expect(score(sim)).toBe(1);
  });

  it("tick fires every N ms of game time", () => {
    const sim = createSim(make([on({ type: "tick", everyMs: 500 }, add(1))]));
    run(sim, 29);
    expect(score(sim)).toBe(0);
    run(sim, 1);
    expect(score(sim)).toBe(1);
    run(sim, 60);
    expect(score(sim)).toBe(3);
  });

  it("tap, hold and release follow the input", () => {
    const sim = createSim(make([on({ type: "tap" }, add(1)), on({ type: "hold" }, add(10)), on({ type: "release" }, add(100))]));
    sim.step({ tap: true, hold: true });
    sim.step({ tap: false, hold: true });
    sim.step(NONE);
    sim.step(NONE);
    expect(score(sim)).toBe(1 + 10 + 10 + 100);
  });

  it("collide matches either order and binds a and b to the right objects", () => {
    const rules = [on({ type: "collide", a: "coin", b: "hero" }, add(1), { type: "destroy", target: "a" })];
    const sim = createSim(make(rules, { coin: { role: "pickup", x: 2000 } }));
    sim.step(NONE);
    expect(score(sim)).toBe(1);
    expect(sim.state().entities.map((e) => e.type)).toEqual(["hero"]);
  });

  it("counterReaches fires once per crossing", () => {
    const rules = [on({ type: "tick", everyMs: 100 }, add(1)), on({ type: "counterReaches", counter: "score", value: 3 }, { type: "add", counter: "lives", n: -1 })];
    const sim = createSim(make(rules));
    run(sim, 60);
    expect(sim.state().counters.lives).toBe(8);
  });
});

describe("conditions and actions", () => {
  it("when joins comparisons with and", () => {
    const rule: Rule = { on: { type: "tick", everyMs: 100 }, when: [{ counter: "score", op: ">=", value: 2 }, { counter: "score", op: "<", value: 4 }], do: [{ type: "add", counter: "lives", n: 1 }] };
    const sim = createSim(make([on({ type: "tick", everyMs: 100 }, add(1)), rule]));
    run(sim, 60);
    // score reaches 2 and 3 while the condition holds: rules run in written order within one event queue
    expect(sim.state().counters.lives).toBeGreaterThan(9);
    expect(sim.state().counters.lives).toBeLessThan(12);
  });

  it.each([
    ["<", 1, 2, true], ["<", 2, 2, false], ["<=", 2, 2, true], ["==", 2, 2, true], ["==", 3, 2, false], [">=", 2, 2, true], [">", 2, 2, false], [">", 3, 2, true],
  ] as const)("operator %s with %i against %i is %s", (op, left, value, expected) => {
    const sim = createSim(make([{ on: { type: "start" }, when: [{ counter: "score", op, value }], do: [{ type: "add", counter: "lives", n: 1 }] }], {}, { score: left }));
    sim.step(NONE);
    expect(sim.state().counters.lives).toBe(expected ? 10 : 9);
  });

  it("set, spawn, bounce, win, lose and speedUp", () => {
    const set = createSim(make([on({ type: "start" }, { type: "set", counter: "score", n: 7 })]));
    set.step(NONE);
    expect(score(set)).toBe(7);

    const spawned = createSim(make([on({ type: "start" }, { type: "spawn", entity: "coin" })], { coin: { role: "pickup", x: 7000, y: 500 } }));
    spawned.step(NONE);
    expect(spawned.state().entities.filter((e) => e.type === "coin")).toHaveLength(1);

    const bounced = createSim(make([on({ type: "collide", a: "hero", b: "ball" }, { type: "bounce", target: "b" })], { ball: { role: "hazard", x: 2000, y: 0, behaviors: [{ type: "fall", speed: 600 }] } }));
    bounced.step(NONE);
    expect(bounced.state().entities.find((e) => e.type === "ball")!.vy).toBe(600);

    const won = createSim(make([on({ type: "start" }, { type: "win" }, { type: "lose" })]));
    won.step(NONE);
    expect(won.state().status).toBe("won");

    const lost = createSim(make([on({ type: "start" }, { type: "lose" })]));
    lost.step(NONE);
    expect(lost.state().status).toBe("lost");

    const fast = (percent: number) => {
      const sim = createSim(make(
        [on({ type: "start" }, { type: "speedUp", percent })],
        { s: { w: 0, h: 0, x: 10000, y: 0, behaviors: [{ type: "spawn", entity: "t", pattern: "stream", intervalMs: 500, speed: 0, ramp: false }] }, t: { behaviors: [{ type: "move", dir: "left", speed: 6000 }] } },
      ));
      run(sim, 31);
      return sim.state().entities.find((e) => e.type === "t")!.vx;
    };
    expect(fast(0 + 1)).toBe(-6060);
    expect(fast(100)).toBe(-12000);
    expect(fast(300)).toBe(-24000);
  });
});

describe("limits", () => {
  it("more than 200 actions in one step ends the round as lost", () => {
    const many = Array.from({ length: 10 }, () => ({ type: "add", counter: "score", n: 1 }) as Action);
    const rules = Array.from({ length: 21 }, () => on({ type: "start" }, ...many));
    const sim = createSim(make(rules));
    sim.step(NONE);
    expect(sim.state().status).toBe("lost");
  });

  it("drops spawns silently at 150 live objects", () => {
    const spec = make([], {
      s: { w: 0, h: 0, x: 5000, y: 500, behaviors: [{ type: "spawn", entity: "t", pattern: "stream", intervalMs: 100, speed: 0, ramp: false }] },
      t: { w: 100, h: 100, x: 0, y: 0, behaviors: [] },
    });
    const sim = createSim(spec);
    run(sim, 60 * 40);
    expect(sim.state().entities.length).toBeLessThanOrEqual(151);
    expect(sim.state().status).toBe("running");
  });

  it("allows at most 10 spawns in any 60 steps", () => {
    const spec = make([], {
      s: { w: 0, h: 0, x: 5000, y: 500, behaviors: [{ type: "spawn", entity: "t", pattern: "stream", intervalMs: 100, speed: 0, ramp: false }] },
      t: { w: 100, h: 100, x: 0, y: 0, behaviors: [{ type: "lifetime", ms: 600000 }] },
    });
    const sim = createSim(spec);
    run(sim, 60);
    expect(sim.state().entities.filter((e) => e.type === "t").length).toBeLessThanOrEqual(10);
  });
});

describe("difficulty", () => {
  const spawnsIn = (tune: (s: GameSpec) => void, steps: number) => {
    const sim = createSim(make([], {
      s: { w: 0, h: 0, x: 5000, y: 500, behaviors: [{ type: "spawn", entity: "t", pattern: "stream", intervalMs: 1000, speed: 0, ramp: true }] },
      t: { w: 100, h: 100, x: 0, y: 0, behaviors: [{ type: "move", dir: "left", speed: 3000 }] },
    }, {}, tune));
    run(sim, steps);
    return sim;
  };

  it("shrinks the spawn interval over the ramp, never below one step", () => {
    const flat = spawnsIn(() => {}, 600).state().entities.filter((e) => e.type === "t").length;
    const ramped = spawnsIn((s) => { s.difficulty = { rampMs: 5000, speedPercent: 0, spawnPercent: 90 }; }, 600).state().entities.filter((e) => e.type === "t").length;
    expect(ramped).toBeGreaterThan(flat);
  });

  it("grows the speed of ramped spawns by the percent at the end of the ramp", () => {
    const sim = spawnsIn((s) => { s.difficulty = { rampMs: 2000, speedPercent: 100, spawnPercent: 0 }; }, 125);
    const speeds = sim.state().entities.filter((e) => e.type === "t").map((e) => e.vx);
    // the spawn at step 60 is halfway up the ramp, the one at step 120 is at the end of it
    expect(speeds.sort((a, b) => a - b)).toEqual([-6000, -4500]);
  });
});
