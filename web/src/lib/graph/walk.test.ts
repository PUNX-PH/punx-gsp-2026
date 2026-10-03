import { describe, expect, it } from "vitest";
import type { Graph } from "@/lib/graph/types";
import { descendants } from "@/lib/graph/walk";

const bare = (ids: string[], edges: [string, string][]): Graph => ({
  schemaVersion: 1,
  nodes: ids.map((id) => ({ id, type: "x", params: {}, position: { x: 0, y: 0 } })),
  edges: edges.map(([a, b]) => ({ from: { node: a, port: "out" }, to: { node: b, port: "in" } })),
});

describe("descendants", () => {
  it("is the roots and everything downstream of them, and nothing else", () => {
    const g = bare(["a", "b", "c", "d", "e"], [["a", "b"], ["b", "c"], ["d", "b"]]); // e is unrelated, d feeds b
    expect([...descendants(g, ["b"])].sort()).toEqual(["b", "c"]);
    expect([...descendants(g, ["a"])].sort()).toEqual(["a", "b", "c"]);
    expect([...descendants(g, ["c", "e"])].sort()).toEqual(["c", "e"]);
  });

  it("follows every branch of a fan-out", () => {
    const g = bare(["a", "b", "c", "d"], [["a", "b"], ["a", "c"], ["c", "d"]]);
    expect([...descendants(g, ["a"])].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("stops at a loop instead of running forever", () => {
    const g = bare(["a", "b"], [["a", "b"], ["b", "a"]]);
    expect([...descendants(g, ["a"])].sort()).toEqual(["a", "b"]);
  });
});
