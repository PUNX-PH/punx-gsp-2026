import { describe, expect, it } from "vitest";
import { setAsset, setTuning } from "@/lib/graph/edits";
import { starterGraph } from "@/lib/graph/starter";

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
