// Build Model played end to end through the real graph service, with in-memory stores and a fake Blender service whose builds are real
// build.py output: what Play lends the step, what reaches the game, and what happens with no worker wired.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BlenderService } from "@/lib/blender/types";
import { makeGraphService } from "@/lib/graph/service";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import type { Graph, GraphNode } from "@/lib/graph/types";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";

const alice = { uid: "alice", email: "alice@punx.ai" };
const NOW = 5_000_000;
const BUILT = new Uint8Array(readFileSync(new URL("../blender/fixtures/built-biped.glb", import.meta.url)));
const tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };

function setup(blender?: BlenderService) {
  let graphs = 0;
  const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: () => NOW, newId: () => "run1" });
  const service = makeGraphService({ records: new MemoryGraphRecords(), files: new MemoryGraphFiles(), runs, now: () => NOW, newId: () => `g${++graphs}`, blender });
  return { service, runs };
}

/** A fake Blender service whose build stores the real built biped through the step's own store, and remembers what it was asked. */
function fakeBlender() {
  const asked: { label: string; recipeKind: string; clips: string[] }[] = [];
  const blender: BlenderService = {
    async prepare() {
      throw new Error("not used");
    },
    async shape() {
      throw new Error("not used");
    },
    async build(job, input) {
      asked.push({ label: input.label, recipeKind: input.body.recipe.kind, clips: Object.keys(input.body.motions.motions) });
      const sha256 = await job.derived.put(BUILT);
      return { sha256, size: BUILT.length, triangles: 180, parts: 15, clips: ["Run", "Jump"], reused: false };
    },
  };
  return { blender, asked };
}

const node = (id: string, type: string, params: Record<string, unknown> = {}): GraphNode => ({ id, type, params, position: { x: 0, y: 0 } });
const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

/** Build Model into the game's hero (or another role), then the Preview. */
const builtGraph = (params: Record<string, unknown> = {}, into = "hero"): Graph => ({
  schemaVersion: 1,
  nodes: [
    node("n1", "build-model", { role: "hero", kind: "biped", description: "", run: "", jump: "", loop: "", ...params }),
    node("n2", "game-template", { tuning }),
    node("n3", "preview"),
  ],
  edges: [wire("n1", "model", "n2", into), wire("n2", "settings", "n3", "settings")],
});

describe("Build Model played through the graph service", () => {
  it("builds a hero, hands it to the game, and the run holds the built file", async () => {
    const { blender, asked } = fakeBlender();
    const { service, runs } = setup(blender);
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: builtGraph() });

    const played = await service.play(alice, made.id);

    expect(played.kind).toBe("ran");
    if (played.kind !== "ran") return;
    expect(played.result.state).toBe("done");
    expect(asked).toEqual([{ label: "Build Model", recipeKind: "biped", clips: ["run", "jump"] }]);
    expect(played.result.nodes.n1.result).toMatchObject({ role: "hero", kind: "biped", parts: 15, triangles: 180, clips: ["Run", "Jump"], skipped: [], reused: false });
    expect((await runs.readFile(alice, played.runId!, "hero.glb")).bytes).toEqual(BUILT);
  });

  it("stops at the Game Template, with the role sentence, when the model was built for another role", async () => {
    const { blender } = fakeBlender();
    const { service } = setup(blender);
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: builtGraph({ role: "obstacle", kind: "vehicle" }) });

    const played = await service.play(alice, made.id);

    expect(played.kind).toBe("ran");
    if (played.kind !== "ran") return;
    expect(played.result.state).toBe("failed");
    expect(played.result.nodes.n1.state).toBe("done");
    expect(played.result.nodes.n2).toMatchObject({ state: "failed", error: "Game Template: the hero model was built as an obstacle. Set its role to hero." });
    expect(played.result.nodes.n3.state).toBe("skipped");
  });

  it("takes the model into the role it was built for", async () => {
    const { blender } = fakeBlender();
    const { service } = setup(blender);
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: builtGraph({ role: "obstacle", kind: "vehicle" }, "obstacle") });

    const played = await service.play(alice, made.id);

    expect(played.kind === "ran" && played.result.state).toBe("done");
  });

  it("says the Blender service did not answer, with no worker wired, while a graph without it plays", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: builtGraph() });

    const played = await service.play(alice, made.id);

    expect(played.kind).toBe("ran");
    if (played.kind !== "ran") return;
    expect(played.result.state).toBe("failed");
    expect(played.result.nodes.n1).toMatchObject({ state: "failed", error: "Build Model: The Blender service did not answer. Try again." });
    expect(played.result.nodes.n2.state).toBe("skipped");

    const plain = await service.createGraph(alice, { starter: false });
    await service.saveGraph(alice, plain.id, {
      graph: { schemaVersion: 1, nodes: [node("n1", "game-template", { tuning }), node("n2", "preview")], edges: [wire("n1", "settings", "n2", "settings")] },
    });
    const other = await service.play(alice, plain.id);
    expect(other.kind === "ran" && other.result.state).toBe("done");
  });

  it("stops before anything is built when Auto has no words", async () => {
    const { blender, asked } = fakeBlender();
    const { service } = setup(blender);
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: builtGraph({ kind: "auto" }) });

    const played = await service.play(alice, made.id);

    expect(played).toMatchObject({ kind: "invalid", problems: [{ node: "n1", message: "Build Model: describe it first, or pick a kind." }] });
    expect(asked).toHaveLength(0);
  });
});
