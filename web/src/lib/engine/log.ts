// Input logs and state digests: how two implementations of the engine are compared. A log says which steps a tap began on and which ranges of
// steps the input was held; a digest is a stable text of the integers in a state.
import { createSim, type SimInput, type SimState } from "./sim";
import type { GameSpec } from "./spec";

export interface InputLog {
  /** How many steps to run. */
  steps: number;
  /** Steps (counted from 1) on which the input was newly pressed. */
  taps: number[];
  /** Inclusive ranges of steps on which the input was held. */
  holds: [number, number][];
}

export const CHECKPOINT_EVERY = 60;

export function inputAt(log: InputLog, step: number): SimInput {
  return { tap: log.taps.includes(step), hold: log.holds.some(([a, b]) => step >= a && step <= b) };
}

export function stateDigest(s: SimState): string {
  const counters = Object.keys(s.counters).sort().map((k) => `${k}=${s.counters[k]}`).join(",");
  const entities = s.entities.map((e) => `${e.id}:${e.type}:${e.x}:${e.y}:${e.vx}:${e.vy}`).join("|");
  return `step=${s.step};status=${s.status};c=${counters};e=${entities}`;
}

/** The state at steps 0, 60, 120, ... up to `log.steps`. */
export function runLog(spec: GameSpec, log: InputLog): SimState[] {
  const sim = createSim(spec);
  const states = [sim.state()];
  for (let step = 1; step <= log.steps; step++) {
    sim.step(inputAt(log, step));
    if (step % CHECKPOINT_EVERY === 0) states.push(sim.state());
  }
  return states;
}
