import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_NAMES,
  BEHAVIOR_NAMES,
  CONTROL_NAMES,
  ENGINE_CAPS,
  ENGINE_VERSION,
  EVENT_NAMES,
  SPAWN_PATTERNS,
} from "./spec";

const note = readFileSync(join(process.cwd(), "..", "docs", "superpowers", "notes", "engine-semantics.md"), "utf8");

/** The backticked first-column names of the table under a `## <heading>` of the note. */
function tableNames(heading: string): string[] {
  const start = note.indexOf(`\n## ${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = note.slice(start + 1).split(/\n## /)[0];
  return [...rest.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
}

describe("the engine's closed vocabulary", () => {
  it("has the caps the spec states", () => {
    expect(ENGINE_VERSION).toBe(1);
    expect(ENGINE_CAPS).toEqual({
      entities: 12,
      rules: 40,
      counters: 9,
      liveObjects: 150,
      spawnsPerSecond: 10,
      actionsPerStep: 200,
      specBytes: 65536,
      generatedAssets: 6,
    });
  });

  it("equals the tables in the semantics note", () => {
    expect([...BEHAVIOR_NAMES]).toEqual(tableNames("Behaviors"));
    expect([...CONTROL_NAMES]).toEqual(tableNames("Controls"));
    expect([...SPAWN_PATTERNS]).toEqual(tableNames("Spawn patterns"));
    expect([...EVENT_NAMES]).toEqual(tableNames("Events"));
    expect([...ACTION_NAMES]).toEqual(tableNames("Actions"));
  });
});
