import { describe, expect, it } from "vitest";
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { GraphEdge, GraphNode } from "@/lib/graph/types";
import { wiringProblem } from "@/lib/graph/wiring";

const node = (id: string, type: string, params: Record<string, unknown> = {}): GraphNode => ({ id, type, params, position: { x: 0, y: 0 } });
const wire = (from: string, fromPort: string, to: string, toPort: string): GraphEdge => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

const nodes: GraphNode[] = [
  node("n1", "reference-image", { asset: null }),
  node("n2", "palette-from-image"),
  node("n3", "game-template", { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }),
  node("n4", "preview"),
  node("n5", "model", { asset: null }),
  node("n6", "palette-from-image"),
];

describe("wiringProblem", () => {
  it("accepts a wire of the right type into a free input", () => {
    expect(wiringProblem(nodes, [], wire("n1", "image", "n2", "image"))).toBeNull();
    expect(wiringProblem(nodes, [], wire("n5", "model", "n3", "hero"))).toBeNull();
    expect(wiringProblem(nodes, [], wire("n3", "settings", "n4", "settings"))).toBeNull();
  });

  it("says when a node does not exist", () => {
    expect(wiringProblem(nodes, [], wire("zz", "image", "n2", "image"))).toBe('A wire refers to a node that does not exist ("zz").');
    expect(wiringProblem(nodes, [], wire("n1", "image", "zz", "image"))).toBe('A wire refers to a node that does not exist ("zz").');
  });

  it("says when a port does not exist, or points the wrong way", () => {
    expect(wiringProblem(nodes, [], wire("n1", "image", "n2", "nope"))).toBe('Node n2 (Palette from Image) has no port "nope".');
    expect(wiringProblem(nodes, [], wire("n1", "nope", "n2", "image"))).toBe('Node n1 (Reference Image) has no port "nope".');
    expect(wiringProblem(nodes, [], wire("n2", "image", "n6", "image"))).toBe('"image" on Palette from Image is an input, not an output.');
    expect(wiringProblem(nodes, [], wire("n1", "image", "n2", "palette"))).toBe('"palette" on Palette from Image is an output, not an input.');
  });

  it.each([
    ["a palette into a picture input", wire("n2", "palette", "n6", "image"), "A palette can't go into a picture input."],
    ["a 3D model into a picture input", wire("n5", "model", "n2", "image"), "A 3D model can't go into a picture input."],
    ["a picture into a palette input", wire("n1", "image", "n3", "palette"), "A picture can't go into a palette input."],
    ["a game into a picture input", wire("n3", "settings", "n2", "image"), "A game can't go into a picture input."],
    ["a palette into a 3D model input", wire("n2", "palette", "n3", "hero"), "A palette can't go into a 3D model input."],
  ])("refuses %s, in plain words", (_label, edge, sentence) => {
    expect(wiringProblem(nodes, [], edge)).toBe(sentence);
  });

  it("refuses a second wire into an input that already has one", () => {
    const existing = [wire("n3", "settings", "n4", "settings")];
    expect(wiringProblem(nodes, existing, wire("n3", "settings", "n4", "settings"))).toBe(
      "Preview's game input already has a wire. Remove it first.",
    );
    expect(wiringProblem(nodes, [wire("n1", "image", "n2", "image")], wire("n1", "image", "n2", "image"))).toBe(
      "Palette from Image's picture input already has a wire. Remove it first.",
    );
  });

  it("refuses a wire from a step to itself", () => {
    const palette = (name: string) => ({ name, label: name, help: name, type: "palette" as const, required: false });
    const loopy: NodeSpec = {
      type: "loopy",
      label: "Loopy",
      help: "Loopy",
      final: false,
      inputs: [palette("in")],
      outputs: [palette("out")],
      defaultParams: () => ({}),
      shapeProblem: () => null,
      incompleteProblem: () => null,
    };
    expect(wiringProblem([node("x", "loopy")], [], wire("x", "out", "x", "in"), { ...NODE_SPECS, loopy })).toBe("A step can't connect to itself.");
  });

  it("does not change the wires it is given", () => {
    const existing = Object.freeze([wire("n1", "image", "n2", "image")]) as GraphEdge[];
    expect(() => wiringProblem(nodes, existing, wire("n5", "model", "n3", "hero"))).not.toThrow();
    expect(existing).toHaveLength(1);
  });
});

describe("wiringProblem and the feel wire", () => {
  // A step that gives a feel, and one that takes one: enough to try the wire type before any real step uses it.
  const base = NODE_SPECS["palette-from-image"];
  const feelSource: NodeSpec = { ...base, type: "feel-source", inputs: [], outputs: [{ name: "feel", label: "feel", help: "", type: "feel", required: false }] };
  const feelSink: NodeSpec = { ...base, type: "feel-sink", inputs: [{ name: "feel", label: "feel", help: "", type: "feel", required: false }], outputs: [] };
  const specs = { ...NODE_SPECS, "feel-source": feelSource, "feel-sink": feelSink };
  const pair = [node("a", "feel-source"), node("b", "feel-sink"), node("c", "game-template", { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } })];

  it("refuses a feel in a palette input, in the same words as every other wire type", () => {
    expect(wiringProblem(pair, [], wire("a", "feel", "c", "palette"), specs)).toBe("A feel can't go into a palette input.");
  });

  it("accepts a feel into a feel input", () => {
    expect(wiringProblem(pair, [], wire("a", "feel", "b", "feel"), specs)).toBeNull();
  });
});

describe("wiringProblem and the Describe Game step", () => {
  const graph = [
    node("n1", "reference-image", { asset: null }),
    node("n2", "describe-game", { prompt: "" }),
    node("n3", "game-template", { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }),
    node("n4", "palette-from-image"),
  ];

  it("accepts a picture in, and a palette and a feel out to the Game Template", () => {
    expect(wiringProblem(graph, [], wire("n1", "image", "n2", "image"))).toBeNull();
    expect(wiringProblem(graph, [], wire("n2", "palette", "n3", "palette"))).toBeNull();
    expect(wiringProblem(graph, [], wire("n2", "feel", "n3", "feel"))).toBeNull();
  });

  it("refuses its feel into the palette input, and its palette into the feel input, in plain words", () => {
    expect(wiringProblem(graph, [], wire("n2", "feel", "n3", "palette"))).toBe("A feel can't go into a palette input.");
    expect(wiringProblem(graph, [], wire("n2", "palette", "n3", "feel"))).toBe("A palette can't go into a feel input.");
  });
});
