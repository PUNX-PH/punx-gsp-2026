import { describe, expect, it } from "vitest";
import { applyToWorkingCopy, setAsset, setTuning } from "@/lib/graph/edits";
import { starterGraph } from "@/lib/graph/starter";
import type { Graph } from "@/lib/graph/types";

const SHA = "a".repeat(64);

describe("setAsset", () => {
  it("chooses a file for the named node and changes nothing else", () => {
    const graph = starterGraph();
    const next = setAsset(graph, "n1", SHA);

    expect(next.nodes[0].params).toEqual({ asset: SHA });
    expect(next.nodes.slice(1)).toEqual(graph.nodes.slice(1));
    expect(next.edges).toEqual(graph.edges);
  });

  it("can clear the choice", () => {
    expect(setAsset(setAsset(starterGraph(), "n1", SHA), "n1", null).nodes[0].params).toEqual({ asset: null });
  });

  it("does not change the graph it was given", () => {
    const graph = starterGraph();
    setAsset(graph, "n1", SHA);
    expect(graph).toEqual(starterGraph());
  });

  it("returns an equal graph for a node that is not there", () => {
    expect(setAsset(starterGraph(), "nope", SHA)).toEqual(starterGraph());
  });
});

describe("setTuning", () => {
  const tuning = { speed: 9, jumpHeight: 3, obstacleSpacing: 20 };

  it("sets the tuning of the named node and changes nothing else", () => {
    const graph = starterGraph();
    const next = setTuning(graph, "n3", tuning);

    expect(next.nodes[2].params).toEqual({ tuning });
    expect(next.nodes.filter((n) => n.id !== "n3")).toEqual(graph.nodes.filter((n) => n.id !== "n3"));
  });

  it("does not change the graph it was given, nor keep a reference to the tuning it was given", () => {
    const graph = starterGraph();
    const given = { ...tuning };
    const next = setTuning(graph, "n3", given);
    given.speed = 1;
    expect(graph).toEqual(starterGraph());
    expect(next.nodes[2].params).toEqual({ tuning });
  });

  it("returns an equal graph for a node that is not there", () => {
    expect(setTuning(starterGraph(), "nope", tuning)).toEqual(starterGraph());
  });
});

describe("applyToWorkingCopy", () => {
  const editPicture = (graph: Graph) => setAsset(graph, "n1", SHA);

  it("builds on what is in the JSON box, so hand edits are not thrown away", () => {
    const edited = starterGraph();
    edited.nodes[4].params = { asset: "b".repeat(64) };
    edited.edges.push({ from: { node: "n5", port: "model" }, to: { node: "n3", port: "hero" } }); // wired by hand
    const result = applyToWorkingCopy(JSON.stringify(edited), editPicture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.edges).toHaveLength(4); // the hand-made wire is still there
    expect(result.graph.nodes[0].params).toEqual({ asset: SHA }); // and the edit was made
    expect(result.graph.nodes[4].params).toEqual({ asset: "b".repeat(64) });
  });

  it("says so, and changes nothing, when the JSON box does not parse", () => {
    const result = applyToWorkingCopy("{ nope", editPicture);
    expect(result).toEqual({ ok: false, error: "Fix the graph JSON first (it is not valid JSON), then try again." });
  });

  it.each([
    ["a number", "5"],
    ["a list", "[]"],
    ["an object with no nodes", "{}"],
    ["nodes that are not a list", '{"nodes":{},"edges":[]}'],
  ])("says so when the JSON is %s and not yet a graph", (_label, text) => {
    const result = applyToWorkingCopy(text, editPicture);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a graph yet/);
  });
});
