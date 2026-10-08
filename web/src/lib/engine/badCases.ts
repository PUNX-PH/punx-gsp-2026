// The refused specs the two implementations of the checker must agree on: each is spec text and the sentence the web's checkSpec gives. The text
// is recorded with the sentences into fixtures/bad-specs.json (see fixtures.test.ts) and the C# parser must give the same sentence for each.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The cases edit a parsed fixture freely, so it is deliberately untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;
const runner = (): Spec => JSON.parse(readFileSync(join(__dirname, "fixtures", "specs", "runner.json"), "utf8"));

export const BAD_CASES: { name: string; text: () => string }[] = [
  { name: "not an object", text: () => "[]" },
  { name: "extra top-level key", text: () => JSON.stringify({ ...runner(), extra: 1 }) },
  { name: "missing top-level key", text: () => { const s = runner(); delete s.look; return JSON.stringify(s); } },
  { name: "wrong engine", text: () => JSON.stringify({ ...runner(), engine: 2 }) },
  { name: "seed zero", text: () => JSON.stringify({ ...runner(), seed: 0 }) },
  { name: "bad camera", text: () => { const s = runner(); s.world.camera = "up"; return JSON.stringify(s); } },
  { name: "too many entities", text: () => { const s = runner(); for (let i = 0; i < 12; i++) s.entities[`extra${i}`] = { ...s.entities.spike }; return JSON.stringify(s); } },
  { name: "too many rules", text: () => { const s = runner(); s.rules = Array.from({ length: 41 }, () => s.rules[0]); return JSON.stringify(s); } },
  { name: "too many counters", text: () => { const s = runner(); for (let i = 0; i < 8; i++) s.counters[`c${i}`] = 0; return JSON.stringify(s); } },
  { name: "unknown behavior", text: () => { const s = runner(); s.entities.spike.behaviors = [{ type: "teleport" }]; return JSON.stringify(s); } },
  { name: "unknown entity", text: () => { const s = runner(); s.rules[0].on.b = "ghost"; return JSON.stringify(s); } },
  { name: "unknown counter", text: () => { const s = runner(); s.rules[1].do[0].counter = "gold"; return JSON.stringify(s); } },
  { name: "two heroes", text: () => { const s = runner(); s.entities.spike.role = "hero"; return JSON.stringify(s); } },
  { name: "fractional x", text: () => { const s = runner(); s.entities.hero.x = 10.5; return JSON.stringify(s); } },
  { name: "huge width", text: () => { const s = runner(); s.world.width = 1e9; return JSON.stringify(s); } },
  { name: "prototype key as entity name", text: () => JSON.stringify(runner()).replace('"coin":{', '"__proto__":{').replace('"coin"', '"__proto__"') },
  { name: "over 64 KiB", text: () => { const s = runner(); s.padding = "x".repeat(70000); return JSON.stringify(s); } },
  { name: "spawner of a spawner", text: () => { const s = runner(); s.entities.spikes.behaviors[0].entity = "coins"; return JSON.stringify(s); } },
  { name: "size zero without spawn", text: () => { const s = runner(); s.entities.spike.w = 0; return JSON.stringify(s); } },
  { name: "bad palette", text: () => { const s = runner(); s.look.palette = ["red"]; return JSON.stringify(s); } },
  { name: "color beyond the palette", text: () => { const s = runner(); s.look.palette = ["#ff0000"]; return JSON.stringify(s); } },
  { name: "when is not a list", text: () => { const s = runner(); s.rules[0].when = 3; return JSON.stringify(s); } },
  { name: "empty action list", text: () => { const s = runner(); s.rules[0].do = []; return JSON.stringify(s); } },
  { name: "unknown event", text: () => { const s = runner(); s.rules[0].on = { type: "earthquake" }; return JSON.stringify(s); } },
  { name: "bad enum", text: () => { const s = runner(); s.entities.spike.behaviors[0].dir = "sideways"; return JSON.stringify(s); } },
  { name: "bad bool", text: () => { const s = runner(); s.ends.winOnTime = "yes"; return JSON.stringify(s); } },
  { name: "unknown field in a behavior", text: () => { const s = runner(); s.entities.spike.behaviors[0].extra = 1; return JSON.stringify(s); } },
  { name: "unknown top-level key before another problem", text: () => JSON.stringify({ zzz: 1, engine: 9 }) },
];
