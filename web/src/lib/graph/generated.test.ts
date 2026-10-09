import { describe, expect, it } from "vitest";
import type { AssetRequest } from "@/lib/engine/service";
import { checkGraph } from "@/lib/graph/checks";
import { generatedGraph } from "@/lib/graph/generated";
import { parseGraph } from "@/lib/graph/schema";
import { runGraph } from "@/lib/graph/runner";
import { type Executor, type ExecutorContext, NodeError } from "@/lib/graph/types";

const asset = (entity: string, role: AssetRequest["role"] = "hero"): AssetRequest => ({ entity, role, kind: "biped", description: `a ${entity}` });

describe("the graph made from one description", () => {
  it.each([0, 1, 2, 6])("is a valid, complete graph with %i models, wired with no help", (n) => {
    const assets = Array.from({ length: n }, (_, i) => asset(`m${i}`, i % 2 ? "obstacle" : "hero"));
    const graph = generatedGraph({ words: "a fox that jumps", assets });
    expect(parseGraph(graph).ok).toBe(true);
    expect(checkGraph(graph, {})).toEqual([]);
    expect(graph.nodes.filter((node) => node.type === "build-model")).toHaveLength(n);
    // Describe Game feeds the template; each model step feeds the template's numbered input of the same order, and is painted with the game's colors
    expect(graph.edges).toContainEqual({ from: { node: "n1", port: "game" }, to: { node: "template", port: "game" } });
    assets.forEach((_, i) => {
      expect(graph.edges).toContainEqual({ from: { node: `n${i + 2}`, port: "model" }, to: { node: "template", port: `model${i + 1}` } });
      expect(graph.edges).toContainEqual({ from: { node: "n1", port: "palette" }, to: { node: `n${i + 2}`, port: "palette" } });
    });
  });

  it("carries the words and Claude's description of each model, and makes every model step soft", () => {
    const graph = generatedGraph({ words: "a fox that jumps", assets: [asset("fox")] });
    expect(graph.nodes[0].params).toEqual({ prompt: "a fox that jumps", makeGame: "script" });
    expect(graph.nodes[1].params).toMatchObject({ role: "hero", kind: "freeform", description: "a fox", soft: true });
  });

  it("keeps at most the six models the template has inputs for, and cuts overlong words and descriptions", () => {
    const graph = generatedGraph({ words: "w".repeat(900), assets: Array.from({ length: 9 }, (_, i) => ({ ...asset(`m${i}`), description: "d".repeat(900) })) });
    expect(graph.nodes.filter((node) => node.type === "build-model")).toHaveLength(6);
    expect(parseGraph(graph).ok).toBe(true);
  });
});

describe("a soft model step", () => {
  const executors: Record<string, Executor> = {
    "describe-game": async () => ({ outputs: { palette: { type: "palette", colors: ["#111111"] } }, result: {} }),
    "build-model": async () => {
      throw new NodeError("Build Model: The Blender service did not answer. Try again.");
    },
    "game-template": async (inputs) => ({ result: { sawModel: inputs.model1 !== undefined } }),
    preview: async () => ({ result: { played: true } }),
  };

  it("that fails does not stop the game: it is done, says why, and hands nothing on", async () => {
    const graph = generatedGraph({ words: "x", assets: [asset("fox")] });
    const run = await runGraph(graph, { executors, ctx: {} as ExecutorContext, log: () => {} });
    expect(run.state).toBe("done");
    expect(run.nodes.n2).toEqual({ state: "done", result: { notBuilt: "The Blender service did not answer. Try again." } });
    expect(run.nodes.template.result).toEqual({ sawModel: false });
    expect(run.nodes.preview.state).toBe("done");
  });

  it("is hard when the person made it themselves (no soft setting)", async () => {
    const graph = generatedGraph({ words: "x", assets: [asset("fox")] });
    delete graph.nodes[1].params.soft;
    const run = await runGraph(graph, { executors, ctx: {} as ExecutorContext, log: () => {} });
    expect(run.state).toBe("failed");
    expect(run.nodes.n2.state).toBe("failed");
    expect(run.nodes.preview.state).toBe("skipped");
  });
});
