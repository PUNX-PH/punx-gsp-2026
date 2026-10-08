// The test players the playtest uses: one that does nothing, one that taps at random, and one that reacts to what is coming.
import { xorshift32 } from "./rng";
import type { SimInput, SimState } from "./sim";
import type { GameSpec } from "./spec";

export interface Bot {
  name: string;
  /** The input for the next step, given the state after the last one. */
  act(state: SimState): SimInput;
}

const NONE: SimInput = { tap: false, hold: false };

export const idleBot = (): Bot => ({ name: "idle", act: () => NONE });

export function randomBot(seed: number): Bot {
  const next = xorshift32(seed);
  let holdUntil = 0;
  return {
    name: "random",
    act(state) {
      const tap = next() % 20 === 0;
      if (tap) holdUntil = state.step + 6;
      return { tap, hold: state.step < holdUntil };
    },
  };
}

/** Taps when a moving hazard is about to reach the hero, and keeps a flier's height. */
export function reactiveBot(spec: GameSpec): Bot {
  const heroName = Object.keys(spec.entities).find((n) => spec.entities[n].role === "hero")!;
  const controls = spec.entities[heroName].behaviors.filter((b) => b.type === "control");
  const flies = controls.some((c) => c.type === "control" && (c.does === "flap" || c.does === "thrust"));
  const side = spec.world.camera === "side";
  const moving = (type: string) => spec.entities[type].behaviors.some((b) => b.type === "move" || b.type === "fall") || spec.world.scroll !== 0;
  return {
    name: "reactive",
    act(state) {
      const hero = state.entities.find((e) => e.type === heroName);
      if (!hero) return NONE;
      const h = spec.entities[heroName];
      if (flies) {
        const low = hero.y < Math.trunc(spec.world.height * 0.45) && hero.vy <= 0;
        return { tap: low, hold: low };
      }
      const threat = state.entities.some((e) => {
        const d = spec.entities[e.type];
        if (d.role !== "hazard" || !moving(e.type)) return false;
        if (side) return e.x > hero.x && e.x - (hero.x + h.w) < 1500 && e.y < hero.y + h.h + 2000;
        return e.x < hero.x + h.w && e.x + d.w > hero.x && e.y > hero.y && e.y - (hero.y + h.h) < 4000;
      });
      return { tap: threat, hold: threat };
    },
  };
}
