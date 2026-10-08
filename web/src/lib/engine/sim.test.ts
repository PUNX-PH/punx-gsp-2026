import { describe, expect, it } from "vitest";
import { checkSpec } from "./check";
import { xorshift32 } from "./rng";
import { createSim } from "./sim";
import type { Behavior, Entity, GameSpec, Rule } from "./spec";

const NONE = { tap: false, hold: false };
const TAP = { tap: true, hold: true };

/** A small spec: a field 10000 by 6000, one hero at (2000, 0) and whatever the test adds. */
function make(extra: Record<string, Partial<Entity> & { behaviors?: Behavior[] }> = {}, rules: Rule[] = [], world: Partial<GameSpec["world"]> = {}, hero: Behavior[] = []): GameSpec {
  const base = (role: Entity["role"], over: Partial<Entity> = {}): Entity => ({
    role, model: "box", color: 0, w: 800, h: 800, collider: "box", x: 0, y: 0, behaviors: [], ...over,
  });
  const entities: Record<string, Entity> = { hero: base("hero", { x: 2000, y: 0, behaviors: hero }) };
  for (const [name, over] of Object.entries(extra)) entities[name] = base(over.role ?? "hazard", over);
  const spec: GameSpec = {
    engine: 1, seed: 1,
    world: { camera: "side", gravity: 0, width: 10000, height: 6000, scroll: 0, ...world },
    counters: { score: 0, lives: 3 },
    entities, rules,
    ends: { timeLimitMs: 0, winOnTime: true, scoreToWin: 0 },
    difficulty: { rampMs: 0, speedPercent: 0, spawnPercent: 0 },
    look: { palette: ["#ff0000"] },
  };
  const r = checkSpec(spec);
  if (!r.ok) throw new Error(r.error);
  return spec;
}

const run = (sim: ReturnType<typeof createSim>, steps: number, input = NONE) => {
  for (let i = 0; i < steps; i++) sim.step(input);
};
const find = (sim: ReturnType<typeof createSim>, type: string) => sim.state().entities.filter((e) => e.type === type && e.alive);

describe("xorshift32", () => {
  it("is the documented generator", () => {
    const next = xorshift32(1);
    // x=1: x ^= x<<13 -> 8193; x ^= x>>>17 -> 8193; x ^= x<<5 -> 270369
    expect(next()).toBe(270369);
    expect(next()).toBe(67634689);
  });
});

describe("the simulator, behavior by behavior", () => {
  it("move: constant velocity, speed/60 truncated per step", () => {
    const sim = createSim(make({ a: { x: 5000, y: 100, behaviors: [{ type: "move", dir: "left", speed: 1000 }] } }));
    run(sim, 60);
    expect(find(sim, "a")[0].x).toBe(5000 - 16 * 60); // 1000/60 truncates to 16 per step
  });

  it("fall moves down, and a platform/hazard/pickup scrolls with the world", () => {
    const sim = createSim(make({ a: { x: 5000, y: 3000, behaviors: [{ type: "fall", speed: 600 }] }, b: { x: 6000, y: 100 } }, [], { scroll: 600 }));
    run(sim, 60);
    expect(find(sim, "a")[0].y).toBe(3000 - 10 * 60);
    expect(find(sim, "b")[0].x).toBe(6000 - 10 * 60);
  });

  it("oscillate: a triangle wave around the start, back at the start after a period", () => {
    const sim = createSim(make({ a: { x: 5000, y: 100, behaviors: [{ type: "oscillate", axis: "y", amplitude: 1000, periodMs: 1000 }] } }));
    run(sim, 15);
    expect(find(sim, "a")[0].y).toBe(100 + 1000);
    run(sim, 15);
    expect(find(sim, "a")[0].y).toBe(100);
  });

  it("lifetime destroys after its steps", () => {
    const sim = createSim(make({ a: { x: 5000, behaviors: [{ type: "lifetime", ms: 500 }] } }));
    run(sim, 29);
    expect(find(sim, "a")).toHaveLength(1);
    run(sim, 2);
    expect(find(sim, "a")).toHaveLength(0);
  });

  it("follow moves toward the nearest target without overshooting", () => {
    const sim = createSim(make({ a: { x: 5000, y: 0, behaviors: [{ type: "follow", target: "hero", speed: 6000 }] } }));
    run(sim, 60);
    expect(find(sim, "a")[0].x).toBe(2000); // 3000 away at 100 per step: arrives and stops
  });

  it("control jump: needs the floor, then gravity brings the hero back", () => {
    const sim = createSim(make({}, [], { gravity: 30000 }, [{ type: "control", on: "tap", does: "jump", power: 12000 }]));
    sim.step(TAP);
    const rising = sim.state().entities[0];
    expect(rising.vy).toBeGreaterThan(0);
    run(sim, 3);
    const heroY = () => sim.state().entities.find((e) => e.type === "hero")!.y;
    expect(heroY()).toBeGreaterThan(0);
    sim.step(TAP); // in the air: a jump does nothing
    run(sim, 90);
    expect(heroY()).toBe(0);
  });

  it("control flap works anywhere", () => {
    const sim = createSim(make({}, [], { gravity: 12000 }, [{ type: "control", on: "tap", does: "flap", power: 6500 }]));
    sim.step(TAP);
    run(sim, 10);
    const y1 = sim.state().entities[0].y;
    sim.step(TAP);
    expect(sim.state().entities[0].vy).toBe(6300); // 6500 less one step of gravity (12000/60 = 200)
    expect(y1).toBeGreaterThan(0);
  });

  it("control switchLane moves one lane over the switch time", () => {
    const spec = make({}, [], { camera: "top", width: 6000, height: 10000 }, [{ type: "lane", count: 3, switchMs: 100 }, { type: "control", on: "tap", does: "switchLane", power: 0 }]);
    const sim = createSim(spec);
    const x0 = sim.state().entities[0].x;
    sim.step(TAP);
    run(sim, 12);
    expect(sim.state().entities[0].x).not.toBe(x0);
  });

  it("spawn: first object after the interval, at the pattern's edge, drawn from the seeded generator", () => {
    const spec = make(
      { s: { w: 0, h: 0, x: 10000, y: 700, behaviors: [{ type: "spawn", entity: "t", pattern: "stream", intervalMs: 500, speed: 0, ramp: false }] }, t: { x: 0, y: 0, behaviors: [{ type: "move", dir: "left", speed: 600 }] } },
    );
    const a = createSim(spec);
    const b = createSim(spec);
    run(a, 29);
    expect(find(a, "t")).toHaveLength(0);
    run(a, 1);
    expect(find(a, "t")).toHaveLength(1);
    expect(find(a, "t")[0].x).toBe(10000);
    run(b, 90);
    expect(find(b, "t")).toHaveLength(3);
  });

  it("collisions: closed intervals touch, circles use the smaller side", () => {
    const touching = createSim(make({ a: { x: 2800, y: 0 } }, [{ on: { type: "collide", a: "hero", b: "a" }, do: [{ type: "add", counter: "score", n: 1 }] }]));
    touching.step(NONE);
    expect(touching.state().counters.score).toBe(1);
    const apart = createSim(make({ a: { x: 2801, y: 0 } }, [{ on: { type: "collide", a: "hero", b: "a" }, do: [{ type: "add", counter: "score", n: 1 }] }]));
    apart.step(NONE);
    expect(apart.state().counters.score).toBe(0);
  });

  it("counters clamp to a million, and exitBounds raises when an object has left", () => {
    const sim = createSim(make({ a: { x: 100, y: 100, behaviors: [{ type: "move", dir: "left", speed: 60000 }] } }, [
      { on: { type: "exitBounds", entity: "a" }, do: [{ type: "add", counter: "score", n: 1_000_000 }, { type: "add", counter: "score", n: 1_000_000 }] },
    ]));
    run(sim, 30);
    expect(sim.state().counters.score).toBe(1_000_000);
  });

  it("ends: the first end reached wins and later steps change nothing", () => {
    const spec = make({ a: { x: 2000 } }, [{ on: { type: "collide", a: "hero", b: "a" }, do: [{ type: "lose" }] }]);
    spec.counters.score = 0;
    const sim = createSim(spec);
    sim.step(NONE);
    expect(sim.state().status).toBe("lost");
    const before = JSON.stringify(sim.state());
    run(sim, 10);
    expect(JSON.stringify(sim.state())).toBe(before.replace(/"step":\d+/, `"step":${sim.state().step}`));
  });

  it("ends: time limit and score to win, and lives at zero", () => {
    const timed = make();
    timed.ends = { timeLimitMs: 500, winOnTime: true, scoreToWin: 0 };
    const t = createSim(timed);
    run(t, 30);
    expect(t.state().status).toBe("won");
    const scored = make({}, [{ on: { type: "start" }, do: [{ type: "add", counter: "score", n: 3 }] }]);
    scored.ends = { timeLimitMs: 0, winOnTime: true, scoreToWin: 3 };
    const s = createSim(scored);
    s.step(NONE);
    expect(s.state().status).toBe("won");
    const dead = make({}, [{ on: { type: "start" }, do: [{ type: "add", counter: "lives", n: -3 }] }]);
    const d = createSim(dead);
    d.step(NONE);
    expect(d.state().status).toBe("lost");
  });
});
