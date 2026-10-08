// The shared fixtures: specs and input logs with the state digest the engine must have at every checkpoint, and refused specs with the sentence
// the checker gives. The C# engine replays and parses the very same files (copied to the Unity project), so a mismatch between the two
// implementations fails on one side. To record new expectations after an intended change:
//   UPDATE_ENGINE_FIXTURES=1 npx vitest run src/lib/engine/fixtures.test.ts
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BAD_CASES } from "./badCases";
import { checkSpec } from "./check";
import { runLog, stateDigest, type InputLog } from "./log";
import type { GameSpec } from "./spec";

const here = join(__dirname, "fixtures");
const unity = join(process.cwd(), "..", "unity", "runner-template", "Assets", "Runner", "Tests", "Engine");
const names = readdirSync(join(here, "specs")).map((f) => f.replace(/\.json$/, "")).sort();
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

type Expected = Record<string, { step: number; digest: string }[]>;

function digests(name: string): { step: number; digest: string }[] {
  const spec = read<GameSpec>(join(here, "specs", `${name}.json`));
  const log = read<InputLog>(join(here, "logs", `${name}.json`));
  return runLog(spec, log).map((s) => ({ step: s.step, digest: stateDigest(s) }));
}

/** Each bad case with the sentence the checker gives for it. */
function badSpecs(): { name: string; text: string; error: string }[] {
  return BAD_CASES.map(({ name, text }) => {
    const t = text();
    const r = checkSpec(JSON.parse(t));
    if (r.ok) throw new Error(`bad case "${name}" was accepted`);
    return { name, text: t, error: r.error };
  });
}

if (process.env.UPDATE_ENGINE_FIXTURES === "1") {
  const expected: Expected = {};
  for (const name of names) expected[name] = digests(name);
  writeFileSync(join(here, "expected.json"), JSON.stringify(expected, null, 1) + "\n");
  writeFileSync(join(here, "bad-specs.json"), JSON.stringify(badSpecs()) + "\n");
  mkdirSync(unity, { recursive: true });
  for (const part of ["specs", "logs"]) cpSync(join(here, part), join(unity, part), { recursive: true });
  for (const f of ["expected.json", "bad-specs.json"]) cpSync(join(here, f), join(unity, f));
}

describe("shared engine fixtures", () => {
  it("has a log for every spec", () => {
    expect(readdirSync(join(here, "logs")).map((f) => f.replace(/\.json$/, "")).sort()).toEqual(names);
  });

  it.each(names)("replays %s to the recorded digests", (name) => {
    expect(digests(name)).toEqual(read<Expected>(join(here, "expected.json"))[name]);
  });

  it("reaches interesting states: spawned objects, score changes, and an ended round somewhere", () => {
    const all = Object.values(read<Expected>(join(here, "expected.json"))).flat();
    expect(all.some((c) => /e=.*:(spike|drone|rock|post|apple):/.test(c.digest))).toBe(true);
    expect(all.some((c) => /score=[1-9]/.test(c.digest))).toBe(true);
    expect(all.some((c) => /status=(won|lost)/.test(c.digest))).toBe(true);
  });

  it("refuses every bad case with the recorded sentence", () => {
    expect(badSpecs()).toEqual(read(join(here, "bad-specs.json")));
  });

  it("keeps the Unity copy equal to these files", () => {
    expect(existsSync(unity)).toBe(true);
    for (const part of ["specs", "logs"]) {
      for (const f of readdirSync(join(here, part))) expect(readFileSync(join(unity, part, f), "utf8")).toBe(readFileSync(join(here, part, f), "utf8"));
    }
    for (const f of ["expected.json", "bad-specs.json"]) expect(readFileSync(join(unity, f), "utf8")).toBe(readFileSync(join(here, f), "utf8"));
  });
});
