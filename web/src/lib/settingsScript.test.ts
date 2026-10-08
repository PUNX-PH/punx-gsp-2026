import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXAMPLE_GAME } from "@/lib/engine/exampleGame";
import { filesNeeded, validateSettings } from "@/lib/settings";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/settings/", import.meta.url));
const base = (): Record<string, unknown> => JSON.parse(readFileSync(FIXTURES + "valid.json", "utf8"));
const withScript = (script: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ ...base(), ...extra, script });

describe("the script key of a game's settings", () => {
  it("accepts game.lua with no models, and with models", () => {
    expect(validateSettings(withScript({ file: "game.lua", models: [] })).ok).toBe(true);
    const result = validateSettings(withScript({ file: "game.lua", models: ["hero", "coin"] }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.settings.script).toEqual({ file: "game.lua", models: ["hero", "coin"] });
  });

  it("needs game.lua and one entity file per model, in order, and nothing of the runner's", () => {
    const result = validateSettings(withScript({ file: "game.lua", models: ["hero", "coin"] }));
    if (!result.ok) throw new Error(result.error);
    expect(filesNeeded(result.settings)).toEqual(["game.lua", "entity-hero.glb", "entity-coin.glb"]);
    const none = validateSettings(withScript({ file: "game.lua", models: [] }));
    if (!none.ok) throw new Error(none.error);
    expect(filesNeeded(none.settings)).toEqual(["game.lua"]);
  });

  it.each([
    [5, "object"],
    [null, "object"],
    [[], "object"],
    [{}, "script.file"],
    [{ file: "game.lua" }, "script.models"],
    [{ models: [] }, "script.file"],
    [{ file: "other.lua", models: [] }, "script.file"],
    [{ file: "../game.lua", models: [] }, "script.file"],
    [{ file: "game.lua", models: "hero" }, "script.models"],
    [{ file: "game.lua", models: [5] }, "script.models"],
    [{ file: "game.lua", models: ["Hero"] }, "script.models"],
    [{ file: "game.lua", models: ["../x"] }, "script.models"],
    [{ file: "game.lua", models: ["box"] }, "script.models"],
    [{ file: "game.lua", models: ["a", "b", "c", "d", "e", "f", "g"] }, "script.models"],
    [{ file: "game.lua", models: ["hero", "hero"] }, "script.models"],
    [{ file: "game.lua", models: [], extra: 1 }, "script"],
  ])("refuses the script %j", (script, word) => {
    const result = validateSettings(withScript(script));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(word);
  });

  it("refuses settings that have both a script and a game of rules", () => {
    const result = validateSettings(withScript({ file: "game.lua", models: [] }, { game: EXAMPLE_GAME }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/script or rules/);
  });

  it("leaves settings without a script exactly as they were", () => {
    const result = validateSettings(JSON.stringify(base()));
    expect(result.ok && result.settings.script).toBeUndefined();
  });
});
