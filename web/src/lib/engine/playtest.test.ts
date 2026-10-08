import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { playtest } from "./playtest";
import type { GameSpec } from "./spec";

const load = (name: string): GameSpec => JSON.parse(readFileSync(join(__dirname, "fixtures", "specs", `${name}.json`), "utf8"));

const reason = (spec: GameSpec): string => {
  const r = playtest(spec);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
};

describe("playtest", () => {
  it.each(["runner", "flapper", "catcher"])("accepts the %s fixture", (name) => {
    expect(playtest(load(name))).toEqual({ ok: true });
  });

  it("rejects a game lost within half a second with no input", () => {
    const spec = load("runner");
    spec.entities.trap = { role: "hazard", model: "box", color: 1, w: 800, h: 800, collider: "box", x: 2000, y: 0, behaviors: [] };
    spec.rules.push({ on: { type: "collide", a: "hero", b: "trap" }, do: [{ type: "lose" }] });
    expect(reason(spec)).toMatch(/within half a second/);
  });

  it("rejects a game with no way to end", () => {
    const spec = load("runner");
    spec.counters = { score: 0 };
    spec.rules = [spec.rules[1]];
    spec.ends = { timeLimitMs: 0, winOnTime: true, scoreToWin: 0 };
    expect(reason(spec)).toMatch(/no way to end/);
  });

  it("rejects a game that can only be won by a score no player reaches", () => {
    const spec = load("catcher");
    spec.ends = { timeLimitMs: 0, winOnTime: false, scoreToWin: 900_000 };
    expect(reason(spec)).toMatch(/cannot be won/);
  });

  it("rejects a game that every test player loses within three seconds", () => {
    const spec = load("runner");
    spec.rules[0].do = [{ type: "lose" }];
    // A wall too tall to jump, arriving after about two seconds: every player is hit.
    spec.entities.spike.h = 6000;
    spec.entities.spikes.behaviors = [{ type: "spawn", entity: "spike", pattern: "stream", intervalMs: 500, speed: 0, ramp: false }];
    expect(reason(spec)).toMatch(/within three seconds/);
  });
});
