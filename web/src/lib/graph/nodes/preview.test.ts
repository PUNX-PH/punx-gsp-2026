import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtinModel } from "@/lib/graph/builtin";
import { EXECUTORS } from "@/lib/graph/nodes";
import { gameTemplate } from "@/lib/graph/nodes/gameTemplate";
import { preview } from "@/lib/graph/nodes/preview";
import { type ExecutorContext, NodeError, type Tuning, type WireValue } from "@/lib/graph/types";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import type { RunService } from "@/lib/runs/types";
import { makeGlb } from "@/lib/testing/glb";

const FIXTURES = fileURLToPath(new URL("../../../../../fixtures/settings/", import.meta.url));
const validSettings = readFileSync(FIXTURES + "valid.json", "utf8");

const alice = { uid: "alice", email: "alice@punx.ai" };
const tuning: Tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };
const HERO_SHA = "d".repeat(64);
const heroGlb = makeGlb({ asset: { version: "2.0" }, extras: { mine: true } });

function setup(wrap: (runs: RunService) => Pick<RunService, "createRun" | "putFile" | "deleteRun"> = (runs) => runs) {
  let n = 0;
  const records = new MemoryRunRecords();
  const files = new MemoryFileStore();
  const runs = makeRunService({ records, files, now: Date.now, newId: () => `run${++n}` });
  let last: string | null = null;
  const lastRun = { get: () => last, set: (id: string | null) => void (last = id) };
  const ctx = {
    user: alice,
    assets: {},
    readAsset: async (sha: string) => (sha === HERO_SHA ? heroGlb : null),
    runs: wrap(runs),
    lastRun,
  } as unknown as ExecutorContext;
  return { records, files, runs, lastRun, ctx };
}

async function game(ctx: ExecutorContext, hero?: string): Promise<WireValue> {
  const inputs = hero ? { hero: { type: "model" as const, sha256: hero, name: "hero.glb", size: heroGlb.length, format: "glb" as const } } : {};
  const { output } = await gameTemplate(inputs, { tuning }, ctx);
  return output!;
}

describe("the Preview node", () => {
  it("is registered", () => {
    expect(EXECUTORS.preview).toBe(preview);
  });

  it("stores the game as one ready run, and remembers it", async () => {
    const { records, files, lastRun, ctx } = setup();

    const done = await preview({ settings: await game(ctx) }, {}, ctx);

    expect(done.output).toBeUndefined();
    expect(done.result).toEqual({ runId: "run1" });
    expect(lastRun.get()).toBe("run1");
    expect(records.runs.size).toBe(1);
    expect(records.runs.get("run1")?.status).toBe("ready");
    expect([...files.files.keys()].sort()).toEqual(["run1/collectible.glb", "run1/hero.glb", "run1/obstacle.glb", "run1/settings.json"]);
    expect(files.files.get("run1/hero.glb")?.bytes).toEqual(builtinModel("hero"));
  });

  it("stores a model the person brought in place of the built-in one", async () => {
    const { files, ctx } = setup();
    await preview({ settings: await game(ctx, HERO_SHA) }, {}, ctx);
    expect(files.files.get("run1/hero.glb")?.bytes).toEqual(heroGlb);
    expect(files.files.get("run1/obstacle.glb")?.bytes).toEqual(builtinModel("obstacle"));
  });

  it("replaces the graph's earlier run, so there is always exactly one", async () => {
    const { records, files, lastRun, ctx } = setup();
    await preview({ settings: await game(ctx) }, {}, ctx);

    const second = await preview({ settings: await game(ctx) }, {}, ctx);

    expect(second.result).toEqual({ runId: "run2" });
    expect([...records.runs.keys()]).toEqual(["run2"]);
    expect([...files.files.keys()].some((k) => k.startsWith("run1/"))).toBe(false);
    expect(lastRun.get()).toBe("run2");
  });

  it("still works when the person already deleted the earlier run (Review Focus 4)", async () => {
    const { records, runs, ctx } = setup();
    await preview({ settings: await game(ctx) }, {}, ctx);
    await runs.deleteRun(alice, "run1"); // from the home page

    const again = await preview({ settings: await game(ctx) }, {}, ctx);

    expect(again.result).toEqual({ runId: "run2" });
    expect([...records.runs.keys()]).toEqual(["run2"]);
  });

  it("makes room for the new run by deleting the old one first, even with 19 other runs", async () => {
    const { records, runs, ctx } = setup();
    await preview({ settings: await game(ctx) }, {}, ctx);
    for (let i = 0; i < 19; i++) await runs.createRun(alice, validSettings);
    expect(records.runs.size).toBe(20);

    const again = await preview({ settings: await game(ctx) }, {}, ctx);

    expect(again.result).toEqual({ runId: "run21" });
    expect(records.runs.size).toBe(20);
  });

  it("says so when the person has 20 other runs, and forgets the run it deleted", async () => {
    const { runs, lastRun, ctx } = setup();
    for (let i = 0; i < 20; i++) await runs.createRun(alice, validSettings);
    lastRun.set("not-there"); // an earlier run that is already gone

    const error = await preview({ settings: await game(ctx) }, {}, ctx).catch((e) => e);

    expect(error).toBeInstanceOf(NodeError);
    expect(error.message).toContain("You have 20 runs. Delete one first.");
    expect(lastRun.get()).toBeNull();
  });

  it("says a model file is missing, before touching anything", async () => {
    const { records, lastRun, ctx } = setup();
    await preview({ settings: await game(ctx) }, {}, ctx);
    const settings = await game(ctx, "e".repeat(64)); // its bytes are not available

    const error = await preview({ settings }, {}, ctx).catch((e) => e);

    expect(error).toBeInstanceOf(NodeError);
    expect(error.message).toBe("Preview: a model file is missing. Choose it again.");
    expect([...records.runs.keys()]).toEqual(["run1"]); // the earlier run is still there
    expect(lastRun.get()).toBe("run1");
  });

  it("leaves no run behind when storing a file fails, and passes the failure on", async () => {
    const { records, ctx } = setup((runs) => ({
      createRun: runs.createRun,
      deleteRun: runs.deleteRun,
      putFile: async () => {
        throw new Error("storage is down");
      },
    }));

    const error = await preview({ settings: await game(ctx) }, {}, ctx).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NodeError);
    expect(records.runs.size).toBe(0);
  });
});
