import { describe, expect, it } from "vitest";
import { checkGraph } from "@/lib/graph/checks";
import { parseGraph } from "@/lib/graph/schema";
import { builtStarterGraph, describedStarterGraph, starterGraph } from "@/lib/graph/starter";

describe("describedStarterGraph", () => {
  it("is a graph the parser accepts: a picture, Describe Game, the Assemble Game and the Preview, wired with the whole game", () => {
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
      "n2.game->n3.game",
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
    expect(describedStarterGraph().nodes[1].params).toEqual({ prompt: "", makeGame: "script" });
  });

  it("is not the same graph as the original starter, which keeps working with no AI", () => {
    expect(describedStarterGraph()).not.toEqual(starterGraph());
    expect(starterGraph().nodes.some((n) => n.type === "describe-game")).toBe(false);
  });
});

describe("builtStarterGraph", () => {
  it("is a graph the parser accepts: Build Model into the game's hero and Build Environment into its world, then the Template and the Preview", () => {
    const graph = builtStarterGraph();
    expect(parseGraph(graph).ok).toBe(true);
    expect(graph.nodes.map((n) => [n.id, n.type])).toEqual([
      ["n1", "build-model"],
      ["n2", "game-template"],
      ["n3", "preview"],
      ["n4", "build-environment"],
    ]);
    expect(graph.nodes[0].params).toEqual({ role: "hero", kind: "biped", description: "", run: "", jump: "", loop: "" });
    expect(graph.nodes[1].params).toEqual({ tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } });
    expect(graph.nodes[3].params).toEqual({ theme: "", density: "some" });
    expect(graph.edges.map((e) => `${e.from.node}.${e.from.port}->${e.to.node}.${e.to.port}`)).toEqual([
      "n1.model->n2.hero",
      "n4.environment->n2.environment",
      "n2.settings->n3.settings",
    ]);
  });

  it("plays as it is: with a kind chosen, an empty theme and every box empty, nothing is missing", () => {
    expect(checkGraph(builtStarterGraph(), {})).toEqual([]);
  });

  it("lays the steps out left to right, 260 px apart, and is a new graph every time", () => {
    expect(builtStarterGraph().nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 260, y: 0 },
      { x: 520, y: 0 },
      { x: 0, y: 280 },
    ]);
    const a = builtStarterGraph();
    a.nodes[0].params = { role: "obstacle" };
    expect(builtStarterGraph().nodes[0].params).toMatchObject({ role: "hero" });
  });

  it("is not either of the other starters", () => {
    expect(builtStarterGraph()).not.toEqual(starterGraph());
    expect(builtStarterGraph()).not.toEqual(describedStarterGraph());
  });
});
