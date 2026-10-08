// One complete, valid game, shown to Claude in the prompt as the shape to write (a lane-free runner: tap to jump over spikes, collect coins). A test checks that it
// passes checkSpec and the playtest, so the example in the prompt can never drift into something the engine refuses. It uses only primitive models.
import type { GameSpec } from "./spec";

export const EXAMPLE_GAME: GameSpec = {
  engine: 1,
  seed: 1,
  world: { camera: "side", gravity: 30000, width: 12000, height: 6000, scroll: 0 },
  counters: { score: 0, lives: 3 },
  entities: {
    hero: { role: "hero", model: "capsule", color: 0, w: 800, h: 1200, collider: "box", x: 2000, y: 0, behaviors: [{ type: "control", on: "tap", does: "jump", power: 12000 }] },
    spike: { role: "hazard", model: "box", color: 1, w: 800, h: 800, collider: "box", x: 12000, y: 0, behaviors: [{ type: "move", dir: "left", speed: 6000 }] },
    coin: { role: "pickup", model: "sphere", color: 2, w: 500, h: 500, collider: "circle", x: 12000, y: 1500, behaviors: [{ type: "move", dir: "left", speed: 6000 }] },
    spikes: { role: "hazard", model: "box", color: 1, w: 0, h: 0, collider: "box", x: 12000, y: 0, behaviors: [{ type: "spawn", entity: "spike", pattern: "stream", intervalMs: 1600, speed: 0, ramp: true }] },
    coins: { role: "pickup", model: "box", color: 2, w: 0, h: 0, collider: "box", x: 12000, y: 1500, behaviors: [{ type: "spawn", entity: "coin", pattern: "stream", intervalMs: 2300, speed: 0, ramp: false }] },
  },
  rules: [
    { on: { type: "collide", a: "hero", b: "spike" }, do: [{ type: "add", counter: "lives", n: -1 }, { type: "destroy", target: "b" }] },
    { on: { type: "collide", a: "hero", b: "coin" }, do: [{ type: "add", counter: "score", n: 1 }, { type: "destroy", target: "b" }] },
  ],
  ends: { timeLimitMs: 60000, winOnTime: true, scoreToWin: 0 },
  difficulty: { rampMs: 30000, speedPercent: 50, spawnPercent: 40 },
  look: { palette: ["#e8553d", "#2b2d42", "#f4c430", "#8ecae6", "#6a994e"] },
};
