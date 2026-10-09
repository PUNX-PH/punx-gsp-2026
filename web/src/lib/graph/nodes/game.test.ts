import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entityFile } from "@/lib/engine/files";
import type { GameService, StoredGame } from "@/lib/engine/service";
import type { GameSpec } from "@/lib/engine/spec";
import { describeGame, padPalette } from "@/lib/graph/nodes/describeGame";
import { gameTemplate } from "@/lib/graph/nodes/gameTemplate";
import { preview } from "@/lib/graph/nodes/preview";
import { NODE_SPECS } from "@/lib/graph/registry";
import { type ExecutorContext, NodeError, type WireValue } from "@/lib/graph/types";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { makeGlb } from "@/lib/testing/glb";
import { filesNeeded, validateSettings } from "@/lib/settings";

const spec = (name = "runner"): GameSpec => JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "engine", "fixtures", "specs", `${name}.json`), "utf8"));
const user = { uid: "alice", email: "alice@punx.ai" };
const SHA = "a".repeat(64);

function games(over: Partial<StoredGame> = {}, asked = true) {
  const calls: unknown[] = [];
  const service: GameService = {
    async create(job, input) {
      calls.push({ job, input });
      return { spec: spec(), leftOut: "no 3D worlds", assets: [], notes: [], ...over, asked };
    },
  };
  return { service, calls };
}
const describeCtx = (service?: GameService) => ({ user, deadline: 123, games: service, readAsset: async () => null }) as unknown as ExecutorContext;

describe("Describe Game with Make a game on", () => {
  it("gives the game on its own port and the game's colors as a palette, and reports what it made", async () => {
    const { service, calls } = games();
    const done = await describeGame({}, { prompt: "a runner over spikes", makeGame: true }, describeCtx(service));
    const game = done.outputs?.game;
    expect(game).toMatchObject({ type: "game", leftOut: "no 3D worlds", assets: [], entityFiles: [] });
    expect(done.outputs?.palette).toEqual({ type: "palette", colors: padPalette(spec().look.palette) });
    expect(done.outputs?.feel).toBeUndefined();
    expect(done.result).toMatchObject({ game: true, entities: 5, rules: 2, leftOut: "no 3D worlds", models: 0, plainShapes: [], reused: false });
    expect(calls).toHaveLength(1);
  });

  it("builds the models Claude asked for, puts their files on the game wire, and lets a failed one be a plain shape", async () => {
    const assets = [
      { entity: "hero", role: "hero" as const, kind: "biped" as const, description: "a fox" },
      { entity: "coin", role: "collectible" as const, kind: "prop" as const, description: "a gem" },
    ];
    const built: string[] = [];
    const builder = {
      buildModel: async (_job: unknown, input: { description: string }) => {
        if (input.description === "a gem") throw new NodeError("Build Model: The Blender service did not answer. Try again.");
        built.push(input.description);
        return { sha256: SHA, size: 1, kind: "biped", parts: 1, triangles: 1, clips: [], summary: "", skipped: [], reused: false };
      },
    };
    const ctx = { ...describeCtx(games({ assets }).service), builder, graphId: "g", derived: {}, deadline: Date.now() + 120_000 } as unknown as ExecutorContext;
    const done = await describeGame({}, { prompt: "x", makeGame: true }, ctx);
    expect(done.outputs?.game).toMatchObject({ entityFiles: [{ file: entityFile("hero"), sha256: SHA }] });
    expect(done.result).toMatchObject({ models: 1, plainShapes: [{ entity: "coin", message: "The Blender service did not answer. Try again." }] });
    expect(built).toEqual(["a fox"]);
  });

  it("says a game from the cache was reused", async () => {
    const done = await describeGame({}, { prompt: "x", makeGame: true }, describeCtx(games({}, false).service));
    expect(done.result).toMatchObject({ reused: true });
  });

  it("says plainly when making games is not set up on the site", async () => {
    await expect(describeGame({}, { prompt: "x", makeGame: true }, describeCtx())).rejects.toThrow(new NodeError("Describe Game: making a whole game is not set up on this site yet."));
  });

  it("leaves a step saved without the setting, or with it off, exactly as it was (no game call)", async () => {
    const { service, calls } = games();
    const ai = { describe: async () => ({ answer: { palette: ["#000000", "#111111", "#222222", "#333333", "#444444"], tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 }, summary: "s" }, reused: false }) };
    const ctx = { ...describeCtx(service), ai } as unknown as ExecutorContext;
    for (const params of [{ prompt: "x" }, { prompt: "x", makeGame: false }]) {
      const done = await describeGame({}, params, ctx);
      expect(Object.keys(done.outputs ?? {})).toEqual(["palette", "feel"]);
    }
    expect(calls).toHaveLength(0);
  });

  it("pads one to five colors to five by repeating the last", () => {
    expect(padPalette(["#111111"])).toEqual(Array(5).fill("#111111"));
    expect(padPalette(["#111111", "#222222", "#333333"])).toEqual(["#111111", "#222222", "#333333", "#333333", "#333333"]);
  });

  it("is a setting a saved step may have or not, and nothing else", () => {
    const check = NODE_SPECS["describe-game"].shapeProblem;
    expect(check({ prompt: "" })).toBeNull();
    expect(check({ prompt: "", makeGame: true })).toBeNull();
    expect(check({ prompt: "", makeGame: "yes" })).toMatch(/script, rules or off/);
    expect(check({ prompt: "", other: 1 })).toMatch(/only settings/);
    expect(NODE_SPECS["describe-game"].defaultParams()).toEqual({ prompt: "", makeGame: "script" });
  });
});

const gameWire = (files: { file: string; sha256: string }[] = [], over: Partial<GameSpec> = {}): WireValue => ({
  type: "game", spec: { ...spec(), ...over }, leftOut: "", assets: [], entityFiles: files,
});

describe("Assemble Game with a game wired in", () => {
  it("makes settings that carry the game, check as settings, and need no role files", async () => {
    const done = await gameTemplate({ game: gameWire() }, { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, {} as ExecutorContext);
    expect(done.output?.type).toBe("settings");
    if (done.output?.type !== "settings") return;
    const checked = validateSettings(done.output.settingsText);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    // The runner fixture's spike names a model ("cone") that has no file, so it is drawn as a box; nothing else changes.
    expect(checked.settings.game).toEqual({ ...spec(), entities: { ...spec().entities, spike: { ...spec().entities.spike, model: "box" } } });
    expect(done.output.entityFiles).toEqual([]);
    expect(filesNeeded(checked.settings)).toEqual([]); // the runner's three files are not part of a game's run
  });

  it("draws an entity as a box when it names a model that has no file, and keeps the ones that have", async () => {
    const s = spec();
    s.entities.hero.model = "heroArt";
    s.entities.coin.model = "coinArt";
    const done = await gameTemplate({ game: gameWire([{ file: entityFile("hero"), sha256: SHA }], s) }, {}, {} as ExecutorContext);
    if (done.output?.type !== "settings") throw new Error("expected settings");
    const checked = validateSettings(done.output.settingsText);
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.settings.game!.entities.hero.model).toBe("heroArt");
    expect(checked.settings.game!.entities.coin.model).toBe("box");
    expect(filesNeeded(checked.settings)).toEqual([entityFile("hero")]);
    expect(done.output.entityFiles).toEqual([{ file: entityFile("hero"), sha256: SHA }]);
  });

  it("refuses a bad game in the settings with the engine's own sentence", () => {
    const text = JSON.stringify({ schemaVersion: 1, template: "runner", palette: padPalette(spec().look.palette), roles: { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb" }, tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 }, game: { ...spec(), engine: 2 } });
    const checked = validateSettings(text);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error).toBe("settings.game: engine: must be 1");
  });

  it("leaves the runner's settings exactly as they were when no game is wired", async () => {
    const done = await gameTemplate({}, { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, {} as ExecutorContext);
    if (done.output?.type !== "settings") throw new Error("expected settings");
    expect(done.output.settingsText).not.toContain('"game"');
    expect(done.output.entityFiles).toBeUndefined();
  });
});

describe("Preview with a game", () => {
  it("stores the settings and only the entities' files as the run", async () => {
    let n = 0;
    const records = new MemoryRunRecords();
    const files = new MemoryFileStore();
    const runs = makeRunService({ records, files, now: Date.now, newId: () => `run${++n}` });
    let last: string | null = null;
    const bytes = makeGlb({ asset: { version: "2.0" } });
    const ctx = {
      user, runs, lastRun: { get: () => last, set: (id: string | null) => void (last = id) },
      readAsset: async (sha: string) => (sha === SHA ? bytes : null),
    } as unknown as ExecutorContext;

    const s = spec();
    s.entities.hero.model = "heroArt";
    const made = await gameTemplate({ game: gameWire([{ file: entityFile("hero"), sha256: SHA }], s) }, {}, ctx);
    const done = await preview({ settings: made.output }, {}, ctx);
    const runId = (done.result as { runId: string }).runId;
    const run = (await runs.listRuns(user)).find((r) => r.id === runId)!;
    expect(run.needed).toEqual([entityFile("hero")]);
    expect(run.status).toBe("ready");
    expect(Object.keys(run.files).sort()).toEqual(["settings.json", entityFile("hero")].sort());
  });
});
