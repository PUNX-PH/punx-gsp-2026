import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inputAt, runLog, stateDigest, type InputLog } from "./log";
import { createSim } from "./sim";
import type { GameSpec } from "./spec";

const runner = JSON.parse(readFileSync(join(__dirname, "fixtures", "specs", "runner.json"), "utf8")) as GameSpec;
const log: InputLog = { steps: 300, taps: [20, 100, 180], holds: [[20, 25], [100, 110]] };

describe("input logs", () => {
  it("reads a step's input: tap on the listed steps, hold inside the listed ranges", () => {
    expect(inputAt(log, 20)).toEqual({ tap: true, hold: true });
    expect(inputAt(log, 22)).toEqual({ tap: false, hold: true });
    expect(inputAt(log, 26)).toEqual({ tap: false, hold: false });
    expect(inputAt(log, 180)).toEqual({ tap: true, hold: false });
  });

  it("gives the state at steps 0, 60, 120, ... up to the log's length", () => {
    const states = runLog(runner, log);
    expect(states.map((s) => s.step)).toEqual([0, 60, 120, 180, 240, 300]);
  });

  it("is deterministic: the same spec and log give equal digests", () => {
    const a = runLog(runner, log).map(stateDigest);
    const b = runLog(runner, log).map(stateDigest);
    expect(a).toEqual(b);
  });

  it("changes the digest when any entity moves one Milli, or a counter or the status changes", () => {
    const sim = createSim(runner);
    for (let i = 0; i < 100; i++) sim.step(inputAt(log, i + 1));
    const s = sim.state();
    const base = stateDigest(s);
    const moved = { ...s, entities: s.entities.map((e, i) => (i === 0 ? { ...e, x: e.x + 1 } : e)) };
    expect(stateDigest(moved)).not.toBe(base);
    expect(stateDigest({ ...s, counters: { ...s.counters, score: s.counters.score + 1 } })).not.toBe(base);
    expect(stateDigest({ ...s, status: "lost" })).not.toBe(base);
    expect(base).toMatch(/^step=100;status=running;/);
    expect(base).not.toMatch(/\./); // integers only
  });
});
