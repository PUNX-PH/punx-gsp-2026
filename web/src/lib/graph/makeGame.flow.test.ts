// The whole path from one idea, through the real services with fakes for Claude and for Blender: Make it plans the game (the code, the models, the art style, the
// world), makes the graph, and Play builds each model and the world, assembles the game and stores it as a run. Nothing here is premade: the models and the scenery
// are whatever the designer answered for the words it was given.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryUsageLimits, ScriptedDesigner } from "@/lib/ai/memory";
import type { DesignReply } from "@/lib/ai/types";
import type { BlenderService } from "@/lib/blender/types";
import type { FreeformBody } from "@/lib/builder/freeform";
import { MemoryRecipeCache } from "@/lib/builder/memory";
import { makeBuilderService } from "@/lib/builder/service";
import { makeGraphService } from "@/lib/graph/service";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { EXAMPLE_GAMES } from "@/lib/script/examples";
import type { ScriptAuthor } from "@/lib/script/author";
import { type CachedScript, makeScriptService } from "@/lib/script/service";
import { validateSettings } from "@/lib/settings";

const alice = { uid: "alice", email: "alice@punx.ai" };
const NOW = 5_000_000;
const GLB = new Uint8Array(readFileSync(new URL("../blender/fixtures/built-biped.glb", import.meta.url)));
const usage = { inputTokens: 100, outputTokens: 200 };

// What Claude plans for "a frog crossing busy roads": the crosser's code (it spawns "frog" and "car" by name), two models, a style and a world.
const PLAN: DesignReply = {
  raw: {
    script: EXAMPLE_GAMES.crosser,
    palette: ["#1b1f3b", "#ff6b6b", "#ffd166", "#06d6a0", "#f1faee"],
    leftOut: "",
    assets: [
      { entity: "frog", role: "hero", description: "a round green frog on four short folded legs with big eyes" },
      { entity: "car", role: "obstacle", description: "a boxy red toy car with four round wheels" },
    ],
    style: "cartoon",
    world: { sky: 5, ground: 4, scenery: [{ description: "a leafy roadside tree" }, { description: "a striped traffic cone" }] },
  },
  usage,
};

const MODEL = JSON.stringify({ summary: "A thing.", materials: [{ color: 3, finish: "painted" }], parts: [{ shape: "ellipsoid", at: [0, 0.4, 0], size: [0.6, 0.6, 0.8] }] });

function setup() {
  const bodies: FreeformBody[] = [];
  const blender: BlenderService = {
    async prepare() {
      throw new Error("not used");
    },
    async shape() {
      throw new Error("not used");
    },
    async build(job, input) {
      if (!("role" in input.body)) throw new Error("a kit body in a freeform flow");
      bodies.push(input.body);
      const sha256 = await job.derived.put(GLB);
      return { sha256, size: GLB.length, triangles: 900, parts: 6, clips: input.body.clips, vertices: 600, reused: false };
    },
  };
  const designer = new ScriptedDesigner({ designFreeform: async () => ({ raw: { recipe: MODEL }, usage }) });
  const limits = new MemoryUsageLimits();
  const builder = makeBuilderService({
    blender,
    now: () => NOW,
    ai: { designer, designs: new MemoryRecipeCache(), motions: new MemoryRecipeCache(), environments: new MemoryRecipeCache(), limits, modelId: "claude-sonnet-5-5", perPerson: 50, total: 500 },
  });
  const planned: string[] = [];
  const author: ScriptAuthor = {
    async author(request) {
      planned.push(request.description);
      return PLAN;
    },
  };
  const scripts = makeScriptService({ author, cache: new MemoryRecipeCache<CachedScript>(), limits, modelId: "claude-sonnet-5-5", perPerson: 50, total: 500, now: () => NOW });
  const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: () => NOW, newId: () => "run1" });
  let graphs = 0;
  const service = makeGraphService({ records: new MemoryGraphRecords(), files: new MemoryGraphFiles(), runs, now: () => NOW, newId: () => `g${++graphs}`, blender, builder, scripts });
  return { service, runs, bodies, designer, planned };
}

describe("one idea makes the whole game", () => {
  it("plans it once, makes a model for each thing and a piece of scenery for each, and plays: the run holds the code, the models and the world", async () => {
    const { service, runs, bodies, designer, planned } = setup();
    const made = await service.createGraph(alice, { describe: "a frog crossing busy roads" });

    // the graph the site made from the plan: no template, no kit kind; a world step; the game's style on every model
    const types = made.graph.nodes.map((n) => n.type).sort();
    expect(types).toEqual(["build-model", "build-model", "build-world", "describe-game", "game-template", "preview"]);
    for (const n of made.graph.nodes.filter((n) => n.type === "build-model")) expect(n.params).toMatchObject({ kind: "freeform", style: "cartoon", soft: true });
    expect(made.graph.nodes.find((n) => n.type === "build-world")?.params).toMatchObject({ sky: 4, ground: 3, scenery: ["a leafy roadside tree", "a striped traffic cone"], style: "cartoon" });

    const played = await service.play(alice, made.id);
    expect(played.kind).toBe("ran");
    if (played.kind !== "ran") return;
    expect(played.result.state).toBe("done");
    expect(planned).toHaveLength(1); // the plan was made at creation and reused by Describe Game when played

    // every model and piece of scenery was designed from its own words, in the game's style
    const asked = designer.calls.map((c) => c.request as { description: string; role: string; style?: string });
    expect(asked.map((a) => [a.role, a.style])).toEqual([["hero", "cartoon"], ["obstacle", "cartoon"], ["scenery", "cartoon"], ["scenery", "cartoon"]]);
    expect(asked.map((a) => a.description)).toEqual(["a round green frog on four short folded legs with big eyes", "a boxy red toy car with four round wheels", "a leafy roadside tree", "a striped traffic cone"]);
    // built for the PC only (the phone is off for now), the hero with its Run and Jump, the rest standing still
    expect(bodies.map((b) => [b.role, b.target, b.clips])).toEqual([["hero", "pc", ["Run", "Jump"]], ["prop", "pc", []], ["scenery", "pc", []], ["scenery", "pc", []]]);

    // the run: the settings (the script, the models, the environment), the code, the models and the scenery
    const run = (await runs.listRuns(alice))[0];
    expect(run.status).toBe("ready");
    expect(Object.keys(run.files).sort()).toEqual(["entity-car.glb", "entity-frog.glb", "game.lua", "scenery1.glb", "scenery2.glb", "settings.json"]);
    const settings = validateSettings(new TextDecoder().decode((await runs.readFile(alice, run.id, "settings.json")).bytes));
    if (!settings.ok) throw new Error(settings.error);
    expect(settings.settings.script).toEqual({ file: "game.lua", models: ["frog", "car"] });
    expect(settings.settings.environment).toEqual({ sky: 4, field: 3, stripe: 3, density: "lots", scenery: ["scenery1.glb", "scenery2.glb"] });
    expect(new TextDecoder().decode((await runs.readFile(alice, run.id, "game.lua")).bytes)).toBe(EXAMPLE_GAMES.crosser);
  });

  it("a second Play asks Claude for nothing: the plan and every design are reused", async () => {
    const { service, designer, planned } = setup();
    const made = await service.createGraph(alice, { describe: "a frog crossing busy roads" });
    await service.play(alice, made.id);
    const designs = designer.calls.length;
    await service.play(alice, made.id);
    expect(designer.calls).toHaveLength(designs);
    expect(planned).toHaveLength(1);
  });
});
