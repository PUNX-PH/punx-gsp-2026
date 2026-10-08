// The shared fixtures: specs and input logs with the state digest the engine must have at every checkpoint. The C# engine replays the very same
// files (copied to the Unity project), so a mismatch between the two implementations fails on one side. To record new expectations after an
// intended change to the semantics: UPDATE_ENGINE_FIXTURES=1 npx vitest run src/lib/engine/fixtures.test.ts
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLog, stateDigest, type InputLog } from "./log";
import type { GameSpec } from "./spec";

const here = join(__dirname, "fixtures");
const unity = join(process.cwd(), "..", "unity", "runner-template", "Assets", "Runner", "Tests", "Engine");
const names = readdirSync(join(here, "specs")).map((f) => f.replace(/\.json$/, "")).sort();
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

type Expected = Record<string, { step: number; digest: string }[]>;

function record(): Expected {
  const out: Expected = {};
  for (const name of names) {
    const spec = read<GameSpec>(join(here, "specs", `${name}.json`));
    const log = read<InputLog>(join(here, "logs", `${name}.json`));
    out[name] = runLog(spec, log).map((s) => ({ step: s.step, digest: stateDigest(s) }));
  }
  return out;
}

if (process.env.UPDATE_ENGINE_FIXTURES === "1") {
  writeFileSync(join(here, "expected.json"), JSON.stringify(record(), null, 1) + "\n");
  mkdirSync(unity, { recursive: true });
  for (const part of ["specs", "logs"]) cpSync(join(here, part), join(unity, part), { recursive: true });
  cpSync(join(here, "expected.json"), join(unity, "expected.json"));
}

describe("shared engine fixtures", () => {
  it("has a log for every spec", () => {
    expect(readdirSync(join(here, "logs")).map((f) => f.replace(/\.json$/, "")).sort()).toEqual(names);
  });

  it.each(names)("replays %s to the recorded digests", (name) => {
    const expected = read<Expected>(join(here, "expected.json"));
    expect(runLog(read<GameSpec>(join(here, "specs", `${name}.json`)), read<InputLog>(join(here, "logs", `${name}.json`))).map((s) => ({ step: s.step, digest: stateDigest(s) }))).toEqual(expected[name]);
  });

  it("reaches interesting states: spawned objects, score changes, and an ended round somewhere", () => {
    const all = Object.values(read<Expected>(join(here, "expected.json"))).flat();
    expect(all.some((c) => /e=.*:(spike|drone|rock|post|apple):/.test(c.digest))).toBe(true);
    expect(all.some((c) => /score=[1-9]/.test(c.digest))).toBe(true);
    expect(all.some((c) => /status=(won|lost)/.test(c.digest))).toBe(true);
  });

  it("keeps the Unity copy equal to these files", () => {
    expect(existsSync(unity)).toBe(true);
    for (const part of ["specs", "logs"]) {
      for (const f of readdirSync(join(here, part))) expect(readFileSync(join(unity, part, f), "utf8")).toBe(readFileSync(join(here, part, f), "utf8"));
    }
    expect(readFileSync(join(unity, "expected.json"), "utf8")).toBe(readFileSync(join(here, "expected.json"), "utf8"));
  });
});
