import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSpec } from "./check";

// The tests edit a parsed fixture freely, so it is deliberately untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", "specs", `${name}.json`), "utf8"));
const fixtures = ["runner", "flapper", "catcher"];

const error = (input: unknown): string => {
  const r = checkSpec(input);
  if (r.ok) throw new Error("expected a refusal");
  return r.error;
};

describe("checkSpec", () => {
  it.each(fixtures)("accepts the %s fixture", (name) => {
    const r = checkSpec(load(name));
    expect(r.ok).toBe(true);
  });

  it("refuses what is not an object, or has an unknown top-level key", () => {
    expect(error(null)).toMatch(/must be an object/);
    expect(error({ ...load("runner"), extra: 1 })).toMatch(/extra/);
  });

  it("names the cap when one is exceeded", () => {
    const many = load("runner");
    for (let i = 0; i < 12; i++) many.entities[`extra${i}`] = { ...many.entities.spike };
    expect(error(many)).toMatch(/entities: at most 12/);

    const rules = load("runner");
    rules.rules = Array.from({ length: 41 }, () => rules.rules[0]);
    expect(error(rules)).toMatch(/rules: at most 40/);

    const counters = load("runner");
    for (let i = 0; i < 8; i++) counters.counters[`c${i}`] = 0;
    expect(error(counters)).toMatch(/counters: at most 9/);
  });

  it("refuses an unknown behavior, a dangling entity or counter, and a second hero", () => {
    const behavior = load("runner");
    behavior.entities.spike.behaviors = [{ type: "teleport" }];
    expect(error(behavior)).toMatch(/entities\.spike\.behaviors\[0\]: unknown behavior "teleport"/);

    const entity = load("runner");
    entity.rules[0].on.b = "ghost";
    expect(error(entity)).toMatch(/unknown entity "ghost"/);

    const counter = load("runner");
    counter.rules[1].do[0].counter = "gold";
    expect(error(counter)).toMatch(/unknown counter "gold"/);

    const heroes = load("runner");
    heroes.entities.spike.role = "hero";
    expect(error(heroes)).toMatch(/exactly one hero/);
  });

  it("refuses numbers that are not whole or are out of range", () => {
    const fraction = load("runner");
    fraction.entities.hero.x = 10.5;
    expect(error(fraction)).toMatch(/entities\.hero\.x: must be a whole number/);

    const huge = load("runner");
    huge.world.width = 1e9;
    expect(error(huge)).toMatch(/world\.width: must be between/);
  });

  it("treats prototype keys as unknown names, never as members", () => {
    const text = JSON.stringify(load("runner")).replace('"coin"', '"__proto__"');
    expect(error(JSON.parse(text))).toBeTruthy();
    const viaParse = JSON.parse('{"engine":1,"__proto__":{"x":1}}');
    expect(error(viaParse)).toMatch(/__proto__/);
  });

  it("refuses a spec over 64 KiB", () => {
    const big = load("runner");
    big.look.palette = ["#ffffff"];
    big.padding = "x".repeat(70000);
    expect(error(big)).toMatch(/64 KiB/);
  });
});
