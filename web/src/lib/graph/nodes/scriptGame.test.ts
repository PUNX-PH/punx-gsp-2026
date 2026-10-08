import { describe, expect, it } from "vitest";
import { entityFile } from "@/lib/engine/files";
import { describeGame } from "@/lib/graph/nodes/describeGame";
import { gameTemplate } from "@/lib/graph/nodes/gameTemplate";
import { preview } from "@/lib/graph/nodes/preview";
import { makeGameMode, NODE_SPECS } from "@/lib/graph/registry";
import { type ExecutorContext, NodeError, type WireValue } from "@/lib/graph/types";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { EXAMPLE_GAMES } from "@/lib/script/examples";
import type { ScriptService, StoredScript } from "@/lib/script/service";
import { filesNeeded, validateSettings } from "@/lib/settings";
import { makeGlb } from "@/lib/testing/glb";

const user = { uid: "alice", email: "alice@punx.ai" };
const SHA = "a".repeat(64);
const PALETTE = ["#112233", "#445566", "#778899", "#aabbcc", "#ddeeff"];
const SCRIPT = EXAMPLE_GAMES.flier;

function scripts(over: Partial<StoredScript> = {}, asked = true) {
  const calls: { job: unknown; input: Record<string, unknown> }[] = [];
  const service: ScriptService = {
    async create(job, input) {
      calls.push({ job, input: input as unknown as Record<string, unknown> });
      return { script: SCRIPT, palette: PALETTE, leftOut: "no sound", assets: [], ...over, asked };
    },
  };
  return { service, calls };
}
const ctxWith = (service?: ScriptService, extra: object = {}) => ({ user, deadline: 123, scripts: service, readAsset: async () => null, ...extra }) as unknown as ExecutorContext;

const scriptWire = (files: { file: string; sha256: string }[] = [], over: object = {}): WireValue => ({
  type: "game",
  script: SCRIPT,
  palette: PALETTE,
  leftOut: "",
  assets: files.map((f) => ({ entity: f.file.slice("entity-".length, -".glb".length), role: "hero" as const, kind: "biped" as const, description: "x" })),
  entityFiles: files,
  ...over,
});

describe("the Make a game setting", () => {
  it("means script, rules or off, and a saved true means rules and a saved false or none means off", () => {
    expect(makeGameMode("script")).toBe("script");
    expect(makeGameMode("rules")).toBe("rules");
    expect(makeGameMode("off")).toBe("off");
    expect(makeGameMode(true)).toBe("rules");
    expect(makeGameMode(false)).toBe("off");
    expect(makeGameMode(undefined)).toBe("off");
    expect(makeGameMode("other")).toBe("off");
  });

  it("is checked when a graph is saved: the three words or a switch, and an attempt count", () => {
    const check = NODE_SPECS["describe-game"].shapeProblem;
    for (const makeGame of ["script", "rules", "off", true, false]) expect(check({ prompt: "", makeGame })).toBeNull();
    expect(check({ prompt: "" })).toBeNull();
    expect(check({ prompt: "", makeGame: "lua" })).toMatch(/script, rules or off/);
    expect(check({ prompt: "", makeGame: 3 })).toMatch(/script, rules or off/);
    expect(check({ prompt: "", makeGame: "script", attempt: 2 })).toBeNull();
    for (const attempt of [-1, 1.5, "2", 100_000, null]) expect(check({ prompt: "", makeGame: "script", attempt })).toMatch(/attempt/);
    expect(check({ prompt: "", other: 1 })).toMatch(/only settings/);
  });

  it("is Script for a new step", () => {
    expect(NODE_SPECS["describe-game"].defaultParams()).toEqual({ prompt: "", makeGame: "script" });
  });
});

describe("Describe Game in script mode", () => {
  it("gives the script on the game port and no palette or feel, and reports what it made", async () => {
    const { service, calls } = scripts();
    const done = await describeGame({}, { prompt: "a bird that flies through pipes", makeGame: "script" }, ctxWith(service));
    expect(done.outputs?.game).toMatchObject({ type: "game", script: SCRIPT, palette: PALETTE, leftOut: "no sound", assets: [], entityFiles: [] });
    expect(done.outputs?.palette).toBeUndefined();
    expect(done.outputs?.feel).toBeUndefined();
    expect(done.result).toMatchObject({ script: true, lines: SCRIPT.split("\n").length, leftOut: "no sound", palette: PALETTE, models: 0, plainShapes: [], reused: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toMatchObject({ description: "a bird that flies through pipes", picture: null, models: [], attempt: 0 });
  });

  it("passes the attempt on, and the clock", async () => {
    const { service, calls } = scripts();
    await describeGame({}, { prompt: "x", makeGame: "script", attempt: 3 }, ctxWith(service));
    expect(calls[0].input.attempt).toBe(3);
    expect(calls[0].job).toMatchObject({ user, deadline: 123 });
  });

  it("passes the picture's bytes and hash when one is wired in", async () => {
    const { service, calls } = scripts();
    const bytes = new Uint8Array([1, 2, 3]);
    const ctx = ctxWith(service, { readAsset: async () => bytes });
    await describeGame({ image: { type: "image", sha256: SHA, name: "p.png", width: 1, height: 1 } }, { prompt: "x", makeGame: "script" }, ctx);
    expect(calls[0].input.picture).toEqual({ sha256: SHA, bytes });
  });

  it("builds the models Claude asked for, puts their files on the wire, and lets a failed one be a plain shape", async () => {
    const assets = [
      { entity: "hero", role: "hero" as const, kind: "biped" as const, description: "a fox" },
      { entity: "coin", role: "collectible" as const, kind: "prop" as const, description: "a gem" },
    ];
    const builder = {
      buildModel: async (_job: unknown, input: { description: string }) => {
        if (input.description === "a gem") throw new NodeError("Build Model: The Blender service did not answer. Try again.");
        return { sha256: SHA, size: 1, kind: "biped", parts: 1, triangles: 1, clips: [], summary: "", skipped: [], reused: false };
      },
    };
    const ctx = ctxWith(scripts({ assets }).service, { builder, graphId: "g", derived: {}, deadline: Date.now() + 120_000 });
    const done = await describeGame({}, { prompt: "x", makeGame: "script" }, ctx);
    expect(done.outputs?.game).toMatchObject({ entityFiles: [{ file: entityFile("hero"), sha256: SHA }] });
    expect(done.result).toMatchObject({ models: 1, plainShapes: [{ entity: "coin", message: "The Blender service did not answer. Try again." }] });
  });

  it("says a script from the cache was reused", async () => {
    const done = await describeGame({}, { prompt: "x", makeGame: "script" }, ctxWith(scripts({}, false).service));
    expect(done.result).toMatchObject({ reused: true });
  });

  it("says plainly when it is not set up on the site", async () => {
    await expect(describeGame({}, { prompt: "x", makeGame: "script" }, ctxWith())).rejects.toThrow(new NodeError("Describe Game: making a whole game is not set up on this site yet."));
  });

  it("lets the script service's own sentence through", async () => {
    const service: ScriptService = {
      async create() {
        throw new NodeError("Describe Game: The AI could not build this game. Try different words.");
      },
    };
    await expect(describeGame({}, { prompt: "x", makeGame: "script" }, ctxWith(service))).rejects.toThrow("The AI could not build this game");
  });

  it("does not call the script service for rules or off, and a saved true is rules", async () => {
    const { service, calls } = scripts();
    const ai = { describe: async () => ({ answer: { palette: PALETTE, tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 }, summary: "s" }, reused: false }) };
    for (const makeGame of ["off", false, undefined]) {
      const done = await describeGame({}, { prompt: "x", makeGame }, ctxWith(service, { ai }));
      expect(Object.keys(done.outputs ?? {})).toEqual(["palette", "feel"]);
    }
    expect(calls).toHaveLength(0);
    // a saved true plays as rules: it asks for the rules game, which this context does not have
    await expect(describeGame({}, { prompt: "x", makeGame: true }, ctxWith(service, { games: undefined, ai }))).rejects.toThrow("not set up");
    expect(calls).toHaveLength(0);
  });
});

describe("Game Template with a script wired in", () => {
  const tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };

  it("makes settings that name game.lua, check as settings, carry the script, and need no role files", async () => {
    const done = await gameTemplate({ game: scriptWire() }, { tuning }, {} as ExecutorContext);
    if (done.output?.type !== "settings") throw new Error("expected settings");
    const checked = validateSettings(done.output.settingsText);
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.settings.script).toEqual({ file: "game.lua", models: [] });
    expect(checked.settings.palette).toEqual(PALETTE);
    expect(checked.settings.game).toBeUndefined();
    expect(filesNeeded(checked.settings)).toEqual(["game.lua"]);
    expect(done.output.script).toBe(SCRIPT);
    expect(done.output.entityFiles).toEqual([]);
  });

  it("lists only the models that have a built file, in the order Claude asked, and keeps their files", async () => {
    const wire = scriptWire([{ file: entityFile("hero"), sha256: SHA }], {
      assets: [
        { entity: "coin", role: "collectible", kind: "prop", description: "x" }, // not built
        { entity: "hero", role: "hero", kind: "biped", description: "x" },
      ],
    });
    const done = await gameTemplate({ game: wire }, { tuning }, {} as ExecutorContext);
    if (done.output?.type !== "settings") throw new Error("expected settings");
    const checked = validateSettings(done.output.settingsText);
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.settings.script).toEqual({ file: "game.lua", models: ["hero"] });
    expect(filesNeeded(checked.settings)).toEqual(["game.lua", entityFile("hero")]);
    expect(done.output.entityFiles).toEqual([{ file: entityFile("hero"), sha256: SHA }]);
  });

  it("refuses a script that does not pass the check, with the reason", async () => {
    await expect(gameTemplate({ game: scriptWire([], { script: "function update(dt) os.exit() end" }) }, { tuning }, {} as ExecutorContext)).rejects.toThrow(/Game Template: .*`os`/);
  });

  it("leaves a game of rules and the runner as they were", async () => {
    const done = await gameTemplate({}, { tuning }, {} as ExecutorContext);
    if (done.output?.type !== "settings") throw new Error("expected settings");
    expect(done.output.settingsText).not.toContain('"script"');
    expect(done.output.script).toBeUndefined();
  });
});

describe("Preview with a script", () => {
  it("stores the settings, game.lua and the models' files as the run, and it is ready", async () => {
    let n = 0;
    const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: Date.now, newId: () => `run${++n}` });
    let last: string | null = null;
    const bytes = makeGlb({ asset: { version: "2.0" } });
    const ctx = {
      user,
      runs,
      lastRun: { get: () => last, set: (id: string | null) => void (last = id) },
      readAsset: async (sha: string) => (sha === SHA ? bytes : null),
    } as unknown as ExecutorContext;

    const made = await gameTemplate({ game: scriptWire([{ file: entityFile("hero"), sha256: SHA }]) }, {}, ctx);
    const done = await preview({ settings: made.output }, {}, ctx);
    const runId = (done.result as { runId: string }).runId;
    const run = (await runs.listRuns(user)).find((r) => r.id === runId)!;
    expect(run.needed).toEqual(["game.lua", entityFile("hero")]);
    expect(run.status).toBe("ready");
    expect(Object.keys(run.files).sort()).toEqual(["game.lua", entityFile("hero"), "settings.json"].sort());
    const stored = await runs.readFile(user, runId, "game.lua");
    expect(new TextDecoder().decode(stored.bytes)).toBe(SCRIPT);
  });

  it("replaces the earlier run, and a script game with no models has just two files", async () => {
    let n = 0;
    const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: Date.now, newId: () => `run${++n}` });
    let last: string | null = null;
    const ctx = { user, runs, lastRun: { get: () => last, set: (id: string | null) => void (last = id) }, readAsset: async () => null } as unknown as ExecutorContext;
    const made = await gameTemplate({ game: scriptWire() }, {}, ctx);
    await preview({ settings: made.output }, {}, ctx);
    await preview({ settings: made.output }, {}, ctx);
    const all = await runs.listRuns(user);
    expect(all).toHaveLength(1);
    expect(Object.keys(all[0].files).sort()).toEqual(["game.lua", "settings.json"]);
  });
});

describe("Describe Game, Game Template and Preview together, as Play runs them", () => {
  it("turns words into a ready run with the script, one model and the settings", async () => {
    let n = 0;
    const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: Date.now, newId: () => `run${++n}` });
    let last: string | null = null;
    const bytes = makeGlb({ asset: { version: "2.0" } });
    const assets = [{ entity: "hero", role: "hero" as const, kind: "biped" as const, description: "a fox" }];
    const builder = { buildModel: async () => ({ sha256: SHA, size: 1, kind: "biped", parts: 1, triangles: 1, clips: [], summary: "", skipped: [], reused: false }) };
    const ctx = {
      user,
      deadline: Date.now() + 120_000,
      graphId: "g",
      derived: {},
      builder,
      scripts: scripts({ assets }).service,
      runs,
      lastRun: { get: () => last, set: (id: string | null) => void (last = id) },
      readAsset: async (sha: string) => (sha === SHA ? bytes : null),
    } as unknown as ExecutorContext;

    const described = await describeGame({}, { prompt: "a fox that flies", makeGame: "script" }, ctx);
    const made = await gameTemplate({ game: described.outputs!.game }, { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, ctx);
    const done = await preview({ settings: made.output }, {}, ctx);
    const run = (await runs.listRuns(user)).find((r) => r.id === (done.result as { runId: string }).runId)!;
    expect(run.status).toBe("ready");
    expect(run.needed).toEqual(["game.lua", entityFile("hero")]);
  });
});
