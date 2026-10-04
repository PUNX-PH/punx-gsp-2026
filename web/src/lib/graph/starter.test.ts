import { describe, expect, it } from "vitest";
import { checkGraph } from "@/lib/graph/checks";
import { parseGraph } from "@/lib/graph/schema";
import { describedStarterGraph, starterGraph } from "@/lib/graph/starter";

describe("describedStarterGraph", () => {
  it("is a graph the parser accepts: a picture, Describe Game, the Game Template and the Preview, wired with a palette and a feel", () => {
    const graph = describedStarterGraph();
    expect(parseGraph(graph).ok).toBe(true);
    expect(graph.nodes.map((n) => [n.id, n.type])).toEqual([
      ["n1", "reference-image"],
      ["n2", "describe-game"],
      ["n3", "game-template"],
      ["n4", "preview"],
    ]);
    expect(graph.edges.map((e) => `${e.from.node}.${e.from.port}->${e.to.node}.${e.to.port}`)).toEqual([
      "n1.image->n2.image",
      "n2.palette->n3.palette",
      "n2.feel->n3.feel",
      "n3.settings->n4.settings",
    ]);
  });

  it("starts with an empty prompt and no picture, so Play asks for exactly those two things, each on its own step", () => {
    expect(checkGraph(describedStarterGraph(), {})).toEqual([
      { node: "n1", message: "Reference Image: choose a picture." },
      { node: "n2", message: "Describe Game: describe your game first." },
    ]);
  });

  it("lays the steps out left to right, 260 px apart, and is a new graph every time", () => {
    expect(describedStarterGraph().nodes.map((n) => n.position)).toEqual([0, 260, 520, 780].map((x) => ({ x, y: 0 })));
    const a = describedStarterGraph();
    a.nodes[1].params = { prompt: "changed" };
    expect(describedStarterGraph().nodes[1].params).toEqual({ prompt: "" });
  });

  it("is not the same graph as the original starter, which keeps working with no AI", () => {
    expect(describedStarterGraph()).not.toEqual(starterGraph());
    expect(starterGraph().nodes.some((n) => n.type === "describe-game")).toBe(false);
  });
});
