import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_LIBRARIES, apiText, CALLBACKS, CAMERA_MODES, limitsText, PRIMITIVE_KINDS, REMOVED_NAMES, REQUIRED_ONE_OF, SCRIPT_API, SCRIPT_FILE, SCRIPT_LIMITS } from "./api";

const names = SCRIPT_API.map((a) => a.name);

describe("the script API table", () => {
  it("has every table, function and field of the spec", () => {
    for (const name of [
      "game.win", "game.lose", "game.score", "game.lives", "game.time", "game.width", "game.height", "game.over",
      "world.spawn", "world.find", "world.count", "world.clear", "world.gravity", "world.bounds", "world.camera",
      "obj.destroy", "obj.set_color", "obj.play", "obj.distance", "obj.fields",
      "input", "ui.text", "ui.bar", "ui.clear", "timer.after", "timer.every", "timer.cancel", "rand", "rand_int", "print",
    ]) {
      expect(names, name).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("has the eight callbacks, and the four of which one must be defined", () => {
    expect(CALLBACKS.map((c) => c.name)).toEqual(["init", "update", "on_tap", "on_hold", "on_release", "on_drag", "on_collide", "on_exit"]);
    expect([...REQUIRED_ONE_OF]).toEqual(["init", "update", "on_tap", "on_drag"]);
    for (const name of REQUIRED_ONE_OF) expect(CALLBACKS.map((c) => c.name)).toContain(name);
  });

  it("has the camera modes and primitive kinds of the spec", () => {
    expect([...CAMERA_MODES]).toEqual(["side", "top", "chase", "fixed", "side2d", "top2d"]);
    expect([...PRIMITIVE_KINDS]).toEqual(["box", "sphere", "capsule", "cylinder", "cone", "plane", "quad"]);
    expect(SCRIPT_FILE).toBe("game.lua");
  });

  it("removes the dangerous names, and none of them is in the API", () => {
    for (const name of ["os", "io", "debug", "require", "load", "loadstring", "dofile", "collectgarbage", "coroutine", "setmetatable"]) expect(REMOVED_NAMES).toContain(name);
    for (const removed of REMOVED_NAMES) expect(names.some((n) => n === removed || n.startsWith(removed + "."))).toBe(false);
    expect(ALLOWED_LIBRARIES.join(" ")).toContain("without random");
  });

  it("states every limit of the spec", () => {
    expect(SCRIPT_LIMITS).toEqual({
      scriptBytes: 65_536,
      instructionsPerFrame: 200_000,
      objects: 300,
      spawnsPerSecond: 120,
      timers: 50,
      uiElements: 24,
      uiTextLength: 2_000,
      stringLength: 10_000,
      slowFrameMs: 250,
      slowFramesInARow: 3,
      assets: 6,
    });
  });

  it("renders the prompt text from the table, with every entry and every limit", () => {
    const text = apiText();
    for (const a of SCRIPT_API) expect(text).toContain(a.signature);
    for (const c of CALLBACKS) expect(text).toContain(c.signature);
    const limits = limitsText();
    expect(limits).toContain("200000 Lua instructions");
    expect(limits).toContain("300 objects");
    expect(limits).toContain("65536 bytes");
  });

  it("agrees with the limits in the player's C# (ScriptLimits and the host's constants)", () => {
    const cs = readFileSync(join(process.cwd(), "..", "unity", "runner-template", "Assets", "Runner", "Runtime", "Script", "Pure", "ScriptHost.cs"), "utf8");
    expect(cs).toContain(`InstructionsPerFrame = ${SCRIPT_LIMITS.instructionsPerFrame}`);
    expect(cs).toContain(`MaxStringLength = ${SCRIPT_LIMITS.stringLength}`);
    const world = readFileSync(join(process.cwd(), "..", "unity", "runner-template", "Assets", "Runner", "Runtime", "Script", "Pure", "ScriptWorld.cs"), "utf8");
    expect(world).toContain(`MaxObjects = ${SCRIPT_LIMITS.objects}`);
    expect(world).toContain(`MaxSpawnsPerSecond = ${SCRIPT_LIMITS.spawnsPerSecond}`);
    for (const name of REMOVED_NAMES.filter((n) => n !== "loadsafe" || cs.includes("loadsafe"))) expect(cs, name).toContain(`"${name}"`);
  });
});
