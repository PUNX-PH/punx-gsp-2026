import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSpec } from "./check";
import { repairSpec } from "./repair";

// The tests edit a parsed fixture freely, so it is deliberately untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", "specs", `${name}.json`), "utf8"));

/** The fixture in the shape Claude writes: counters and entities as named lists, every rule with a `when` list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClaudeWrites = (spec: Record<string, any>): Record<string, any> => ({
  ...spec,
  counters: Object.entries(spec.counters).map(([name, value]) => ({ name, value })),
  entities: Object.entries(spec.entities).map(([name, e]) => ({ name, ...(e as object) })),
  rules: spec.rules.map((r: object) => ({ when: [], ...r })),
});

describe("repairSpec", () => {
  it.each(["runner", "flapper", "catcher"])("turns the %s fixture, written as Claude writes it, into a checked spec", (name) => {
    const r = repairSpec(asClaudeWrites(load(name)));
    expect(r).not.toBeNull();
    expect(r!.notes).toEqual([]);
    expect(checkSpec(r!.spec).ok).toBe(true);
  });

  it("accepts the map form too, and leaves a good spec unchanged", () => {
    const r = repairSpec(load("runner"));
    expect(r!.spec).toEqual(load("runner"));
  });

  it("clamps numbers into range and rounds them", () => {
    const raw = asClaudeWrites(load("runner"));
    raw.world.width = 1e9;
    raw.entities[0].x = 10.6;
    raw.entities[0].behaviors[0].power = -1e9;
    const r = repairSpec(raw)!;
    expect(r.spec.world.width).toBe(100000);
    expect(r.spec.entities.hero.x).toBe(11);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(checkSpec(r.spec).ok).toBe(true);
  });

  it("drops unknown behaviors, rules and actions with a note", () => {
    const raw = asClaudeWrites(load("runner"));
    raw.entities[1].behaviors.push({ type: "teleport", where: "moon" });
    raw.rules.push({ on: { type: "earthquake" }, when: [], do: [{ type: "win" }] });
    raw.rules[0].do.push({ type: "explode" });
    const r = repairSpec(raw)!;
    expect(r.notes.join(" ")).toMatch(/teleport/);
    expect(r.notes.join(" ")).toMatch(/earthquake/);
    expect(r.notes.join(" ")).toMatch(/explode/);
    expect(r.spec.rules).toHaveLength(2);
    expect(checkSpec(r.spec).ok).toBe(true);
  });

  it("removes rules and behaviors that point at nothing", () => {
    const raw = asClaudeWrites(load("runner"));
    raw.rules[0].on.b = "ghost";
    raw.rules[1].do[0].counter = "gold";
    raw.entities[3].behaviors[0].entity = "ghost";
    const r = repairSpec(raw)!;
    // The first rule has a dangling event and goes; the second loses only its dangling action.
    expect(r.spec.rules).toHaveLength(1);
    expect(r.spec.rules[0].do).toEqual([{ type: "destroy", target: "b" }]);
    expect(r.spec.entities.spikes.behaviors).toHaveLength(0);
    expect(checkSpec(r.spec).ok).toBe(true);
  });

  it("trims to the caps from the end, in a fixed order", () => {
    const raw = asClaudeWrites(load("runner"));
    for (let i = 0; i < 20; i++) raw.entities.push({ ...raw.entities[1], name: `extra${i}` });
    for (let i = 0; i < 50; i++) raw.rules.push({ ...raw.rules[1] });
    for (let i = 0; i < 12; i++) raw.counters.push({ name: `c${i}`, value: 0 });
    const r = repairSpec(raw)!;
    expect(Object.keys(r.spec.entities)).toHaveLength(12);
    expect(Object.keys(r.spec.entities).slice(0, 5)).toEqual(["hero", "spike", "coin", "spikes", "coins"]);
    expect(r.spec.rules).toHaveLength(40);
    expect(Object.keys(r.spec.counters)).toHaveLength(9);
    expect(checkSpec(r.spec).ok).toBe(true);
  });

  it("keeps exactly one hero, drops invalid names, and keeps palette slots in range", () => {
    const raw = asClaudeWrites(load("runner"));
    raw.entities[1].role = "hero";
    raw.entities.push({ ...raw.entities[2], name: "__proto__" });
    raw.entities[2].color = 4;
    raw.look.palette = ["#ff0000", "nope", "#00ff00"];
    const r = repairSpec(raw)!;
    expect(Object.values(r.spec.entities).filter((e) => e.role === "hero")).toHaveLength(1);
    expect(Object.keys(r.spec.entities)).not.toContain("__proto__");
    expect(r.spec.look.palette).toEqual(["#ff0000", "#00ff00"]);
    expect(r.spec.entities.coin.color).toBe(1);
    expect(checkSpec(r.spec).ok).toBe(true);
  });

  it("gives null when nothing usable is left", () => {
    expect(repairSpec(null)).toBeNull();
    expect(repairSpec("a game")).toBeNull();
    expect(repairSpec({ engine: 1, entities: [] })).toBeNull();
  });
});
