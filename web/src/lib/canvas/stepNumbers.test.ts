import { describe, expect, it } from "vitest";
import { addEdge } from "@/lib/graph/edits";
import { starterGraph } from "@/lib/graph/starter";
import type { Graph } from "@/lib/graph/types";
import { staleAfter, stepNumbers } from "@/lib/canvas/stepNumbers";

describe("stepNumbers", () => {
  it("numbers the steps that lead to the Preview, in the order they run, and leaves the rest out", () => {
    const numbers = stepNumbers(starterGraph());
    expect([...numbers.entries()]).toEqual([["n1", 1], ["n2", 2], ["n3", 3], ["n4", 4]]);
    expect(numbers.has("n5")).toBe(false);
  });

  it("renumbers when a step is wired in", () => {
    const wired = addEdge(starterGraph(), { from: { node: "n5", port: "model" }, to: { node: "n3", port: "hero" } });
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;
    const numbers = stepNumbers(wired.graph);
    expect(numbers.get("n5")).toBe(3);
    expect(numbers.get("n3")).toBe(4);
    expect(numbers.get("n4")).toBe(5);
  });

  it("is empty when there is no Preview", () => {
    const noPreview: Graph = { ...starterGraph(), nodes: starterGraph().nodes.filter((n) => n.id !== "n4"), edges: starterGraph().edges.slice(0, 2) };
    expect(stepNumbers(noPreview).size).toBe(0);
  });
});

describe("staleAfter", () => {
  it("is the touched steps and everything downstream of them", () => {
    expect([...staleAfter(starterGraph(), ["n2"])].sort()).toEqual(["n2", "n3", "n4"]);
    expect([...staleAfter(starterGraph(), ["n1"])].sort()).toEqual(["n1", "n2", "n3", "n4"]);
    expect([...staleAfter(starterGraph(), ["n5"])]).toEqual(["n5"]);
  });

  it("ignores steps that are not in the graph", () => {
    expect(staleAfter(starterGraph(), ["nope"]).size).toBe(0);
    expect([...staleAfter(starterGraph(), ["nope", "n4"])]).toEqual(["n4"]);
  });

  it("is empty when nothing was touched", () => {
    expect(staleAfter(starterGraph(), []).size).toBe(0);
  });
});
