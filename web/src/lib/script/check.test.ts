import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REMOVED_NAMES, SCRIPT_LIMITS } from "./api";
import { checkScript } from "./check";

const GOOD = `
local score_per_coin = 10
function init()
  world.camera{ mode = "side2d" }
  world.spawn("box", { x = 0, y = 0, tag = "player" })
end
function update(dt)
  game.score = game.score + dt
end
function on_tap(x, y)
  print("tap", x, y)
end
`;

function reason(text: string): string {
  const result = checkScript(text);
  if (result.ok) throw new Error("expected the script to fail");
  return result.reason;
}

describe("checkScript", () => {
  it("passes a valid game", () => {
    expect(checkScript(GOOD)).toEqual({ ok: true });
  });

  it("accepts callbacks defined as assigned functions, and local helpers", () => {
    expect(checkScript("local function help() return 1 end\nupdate = function(dt) help() end")).toEqual({ ok: true });
  });

  it("refuses a script over the size limit", () => {
    const big = "-- " + "x".repeat(SCRIPT_LIMITS.scriptBytes) + "\nfunction update(dt) end";
    expect(reason(big)).toMatch(/65536 bytes/);
  });

  it("counts bytes, not characters", () => {
    const wide = "-- " + "é".repeat(SCRIPT_LIMITS.scriptBytes / 2) + "\nfunction update(dt) end";
    expect(reason(wide)).toMatch(/bytes/);
  });

  it("refuses a NUL character", () => {
    expect(reason("function update(dt) end\0")).toMatch(/NUL/);
  });

  it("refuses invalid syntax and names the line", () => {
    const r = reason("function update(dt)\n  local x = \nend end");
    expect(r).toMatch(/line 3/);
    expect(r.toLowerCase()).toContain("syntax");
  });

  it("refuses an empty script", () => {
    expect(reason("   \n")).toMatch(/empty/i);
  });

  it.each(REMOVED_NAMES.map((n) => [n]))("refuses the removed name %s used as a name", (name) => {
    const r = reason(`function update(dt)\n  local a = ${name}\nend`);
    expect(r).toContain(`\`${name}\``);
    expect(r).toMatch(/line 2/);
  });

  it("refuses a removed name used through a member access or a call", () => {
    expect(reason("function update(dt)\n  x = os.time()\nend")).toContain("`os`");
    expect(reason("function update(dt)\n  local f = load('return 1')\nend")).toContain("`load`");
    expect(reason("function update(dt)\n  t.debug = 1\nend")).toContain("`debug`");
  });

  it("lets a removed name appear in a string or a comment", () => {
    const text = `-- this does not use os or load\nfunction init() print("os load require debug") end`;
    expect(checkScript(text)).toEqual({ ok: true });
  });

  it("refuses a script with no callback, and says which to define", () => {
    const r = reason("local x = 1\nfunction helper() return x end");
    expect(r).toContain("init");
    expect(r).toContain("update");
    expect(r).toContain("on_tap");
    expect(r).toContain("on_drag");
  });

  it("does not count a local function as a callback", () => {
    expect(reason("local function update(dt) end")).toContain("define at least one");
  });

  it("counts any of the four required callbacks", () => {
    for (const name of ["init", "update", "on_tap", "on_drag"]) expect(checkScript(`function ${name}() end`)).toEqual({ ok: true });
    expect(reason("function on_collide(a, b) end")).toContain("define at least one");
  });

  it("refuses a callback defined twice", () => {
    const r = reason("function update(dt) end\nfunction update(dt) end");
    expect(r).toContain("`update`");
    expect(r).toMatch(/twice|more than once/);
  });

  it("reports every problem it finds, in one sentence block", () => {
    const r = reason("function update(dt)\n  os.exit()\n  io.write('x')\nend");
    expect(r).toContain("`os`");
    expect(r).toContain("`io`");
  });

  it("passes every example game in Tests/Scripts", () => {
    const dir = join(process.cwd(), "..", "unity", "runner-template", "Assets", "Runner", "Tests", "Scripts");
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".lua"))) {
      const result = checkScript(readFileSync(join(dir, file), "utf8"));
      expect(result, file).toEqual({ ok: true });
    }
  });
});
