import { describe, expect, it } from "vitest";
import {
  addEdge,
  addNode,
  addProblem,
  applyToWorkingCopy,
  editAsset,
  editTuning,
  moveNode,
  removeEdge,
  removeNode,
  setAsset,
  setTuning,
} from "@/lib/graph/edits";
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

const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const empty = (): Graph => ({ schemaVersion: 1, nodes: [], edges: [] });
const node = (id: string, type = "model", x = 0, y = 0) => ({ id, type, params: { asset: null }, position: { x, y } });

describe("addProblem", () => {
  it("is null for a step that may be added", () => {
    expect(addProblem(starterGraph(), "model")).toBeNull();
    expect(addProblem(empty(), "preview")).toBeNull();
  });

  it("says a graph has one Preview", () => {
    expect(addProblem(starterGraph(), "preview")).toBe("A graph has one Preview.");
  });

  it("says a graph can have at most 50 steps", () => {
    const full: Graph = { ...empty(), nodes: Array.from({ length: 50 }, (_, i) => node(`n${i + 1}`)) };
    expect(addProblem(full, "model")).toBe("A graph can have at most 50 steps.");
  });

  it("refuses an unknown type", () => {
    expect(addProblem(empty(), "teleporter")).toBe("Unknown step type.");
  });
});

describe("addNode", () => {
  it("adds a step with the lowest unused id and its type's default settings, and touches nothing", () => {
    const graph: Graph = { ...empty(), nodes: [node("n1"), node("n2"), node("n4")] };
    const before = structuredClone(graph);

    const added = addNode(graph, "game-template", { x: 600, y: 40 });

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.id).toBe("n3");
    expect(added.touched).toEqual([]);
    expect(added.graph.nodes.at(-1)).toEqual({ id: "n3", type: "game-template", params: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, position: { x: 600, y: 40 } });
    expect(graph).toEqual(before);
  });

  it("refuses with the reason addProblem gives", () => {
    expect(addNode(starterGraph(), "preview", { x: 0, y: 0 })).toEqual({ ok: false, reason: "A graph has one Preview." });
  });

  it("reuses a deleted step's id without bringing its wires back (Review Focus 1)", () => {
    const removed = removeNode(starterGraph(), "n3");
    const added = addNode(removed.graph, "game-template", { x: 520, y: 0 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.id).toBe("n3");
    expect(added.graph.edges.some((e) => e.from.node === "n3" || e.to.node === "n3")).toBe(false);
  });

  it("never stacks new steps on top of each other (Review Focus 3)", () => {
    let graph = empty();
    for (let i = 0; i < 5; i++) {
      const added = addNode(graph, "model", { x: 100, y: 100 });
      expect(added.ok).toBe(true);
      if (added.ok) graph = added.graph;
    }
    const spots = graph.nodes.map((n) => n.position);
    expect(new Set(spots.map((p) => `${p.x},${p.y}`)).size).toBe(5);
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        expect(Math.abs(spots[a].x - spots[b].x) >= 200 || Math.abs(spots[a].y - spots[b].y) >= 140).toBe(true);
      }
    }
  });
});

describe("removeNode", () => {
  it("removes the step and every wire touching it, and touches the steps it fed", () => {
    const edit = removeNode(starterGraph(), "n2");
    expect(edit.graph.nodes.map((n) => n.id)).toEqual(["n1", "n3", "n4", "n5"]);
    expect(edit.graph.edges).toEqual([wire("n3", "settings", "n4", "settings")]);
    expect(edit.touched).toEqual(["n3"]);
  });

  it("returns an equal graph, touching nothing, for a step that is not there", () => {
    expect(removeNode(starterGraph(), "nope")).toEqual({ graph: starterGraph(), touched: [] });
  });
});

describe("addEdge and removeEdge", () => {
  const withoutFirstWire = (): Graph => removeEdge(starterGraph(), wire("n1", "image", "n2", "image")).graph;

  it("adds an accepted wire and touches the step it ends at", () => {
    const edit = addEdge(withoutFirstWire(), wire("n1", "image", "n2", "image"));
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.touched).toEqual(["n2"]);
    expect(edit.graph.edges).toHaveLength(3);
  });

  it("refuses with the wire rule's sentence", () => {
    expect(addEdge(starterGraph(), wire("n2", "palette", "n2", "image"))).toEqual({ ok: false, reason: "A step can't connect to itself." });
    expect(addEdge(starterGraph(), wire("n1", "image", "n2", "image"))).toEqual({
      ok: false,
      reason: "Palette from Image's picture input already has a wire. Remove it first.",
    });
  });

  it("refuses a 201st wire", () => {
    const full: Graph = { ...starterGraph(), edges: Array.from({ length: 200 }, () => wire("n1", "image", "n2", "image")) };
    expect(addEdge(full, wire("n5", "model", "n3", "hero"))).toEqual({ ok: false, reason: "A graph can have at most 200 wires." });
  });

  it("removes a wire and touches the step it ended at; one that is not there changes nothing", () => {
    const edit = removeEdge(starterGraph(), wire("n2", "palette", "n3", "palette"));
    expect(edit.graph.edges).toHaveLength(2);
    expect(edit.touched).toEqual(["n3"]);
    expect(removeEdge(starterGraph(), wire("n5", "model", "n3", "hero"))).toEqual({ graph: starterGraph(), touched: [] });
  });
});

describe("moveNode, editAsset and editTuning", () => {
  it("moves a step and touches nothing; an unknown id changes nothing", () => {
    const edit = moveNode(starterGraph(), "n1", { x: 40, y: 50 });
    expect(edit.graph.nodes[0].position).toEqual({ x: 40, y: 50 });
    expect(edit.touched).toEqual([]);
    expect(moveNode(starterGraph(), "nope", { x: 1, y: 1 })).toEqual({ graph: starterGraph(), touched: [] });
  });

  it("chooses a file and touches that step", () => {
    const edit = editAsset(starterGraph(), "n1", SHA);
    expect(edit.graph.nodes[0].params).toEqual({ asset: SHA });
    expect(edit.touched).toEqual(["n1"]);
  });

  it("stores a tuning without slider float noise (Review Focus 2)", () => {
    const edit = editTuning(starterGraph(), "n3", { speed: 2.3000000000000003, jumpHeight: 1.5, obstacleSpacing: 12.004 });
    expect(edit.graph.nodes[2].params).toEqual({ tuning: { speed: 2.3, jumpHeight: 1.5, obstacleSpacing: 12 } });
    expect(edit.touched).toEqual(["n3"]);
  });
});
