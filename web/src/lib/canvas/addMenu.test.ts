import { describe, expect, it } from "vitest";
import { addChoices } from "@/lib/canvas/addMenu";
import { removeNode } from "@/lib/graph/edits";
import { NODE_SPECS } from "@/lib/graph/registry";
import { starterGraph } from "@/lib/graph/starter";
import type { Graph } from "@/lib/graph/types";

const withoutPreview = (): Graph => removeNode(starterGraph(), "n4").graph;

describe("addChoices", () => {
  it("lists every step type with its plain name and help", () => {
    const choices = addChoices(withoutPreview());
    expect(choices.map((c) => c.type)).toEqual(["reference-image", "model", "prepare-model", "make-shape", "build-model", "palette-from-image", "describe-game", "game-template", "preview"]);
    for (const choice of choices) {
      expect(choice.label).toBe(NODE_SPECS[choice.type].label);
      expect(choice.help).toBe(NODE_SPECS[choice.type].help);
      expect(choice.disabledReason).toBeUndefined();
      expect(choice.wireInto).toBeUndefined();
    }
  });

  it("greys the Preview once the graph has one", () => {
    const choices = addChoices(starterGraph());
    expect(choices.find((c) => c.type === "preview")?.disabledReason).toBe("A graph has one Preview.");
    expect(choices.filter((c) => c.disabledReason)).toHaveLength(1);
  });

  it("greys everything at 50 steps", () => {
    const full: Graph = {
      ...starterGraph(),
      nodes: Array.from({ length: 50 }, (_, i) => ({ id: `n${i + 1}`, type: "model", params: { asset: null }, position: { x: 0, y: 0 } })),
      edges: [],
    };
    const choices = addChoices(full);
    expect(choices).toHaveLength(9);
    for (const choice of choices) expect(choice.disabledReason).toBe("A graph can have at most 50 steps.");
  });

  it("from an open output, offers only the steps that accept that wire type, and says which input to use", () => {
    const graph = withoutPreview();
    expect(addChoices(graph, { node: "n1", port: "image" }).map((c) => [c.type, c.wireInto])).toEqual([["build-model", "image"], ["palette-from-image", "image"], ["describe-game", "image"]]);
    expect(addChoices(graph, { node: "n2", port: "palette" }).map((c) => [c.type, c.wireInto])).toEqual([["prepare-model", "palette"], ["make-shape", "palette"], ["build-model", "palette"], ["game-template", "palette"]]);
    expect(addChoices(graph, { node: "n5", port: "model" }).map((c) => [c.type, c.wireInto])).toEqual([["prepare-model", "model"], ["game-template", "hero"]]);
    expect(addChoices(graph, { node: "n3", port: "settings" }).map((c) => [c.type, c.wireInto, c.disabledReason])).toEqual([["preview", "settings", undefined]]);
  });

  it("still lists a step that accepts the wire but cannot be added, greyed", () => {
    const choices = addChoices(starterGraph(), { node: "n3", port: "settings" });
    expect(choices).toEqual([expect.objectContaining({ type: "preview", wireInto: "settings", disabledReason: "A graph has one Preview." })]);
  });

  it("offers nothing for an output that does not exist", () => {
    expect(addChoices(starterGraph(), { node: "n1", port: "nope" })).toEqual([]);
    expect(addChoices(starterGraph(), { node: "zz", port: "image" })).toEqual([]);
  });
});

describe("addChoices and Build Model", () => {
  const withBuilt = (): Graph => {
    const base = withoutPreview();
    return { ...base, nodes: [...base.nodes, { id: "n9", type: "build-model", params: NODE_SPECS["build-model"].defaultParams(), position: { x: 0, y: 400 } }] };
  };

  it("offers Build Model with its plain name and help", () => {
    expect(addChoices(withoutPreview()).find((c) => c.type === "build-model")).toMatchObject({ label: "Build Model", help: NODE_SPECS["build-model"].help });
  });

  it("offers Build Model from a palette output into its palette, and from a picture output into its picture", () => {
    const graph = withoutPreview();
    expect(addChoices(graph, { node: "n2", port: "palette" }).find((c) => c.type === "build-model")?.wireInto).toBe("palette");
    expect(addChoices(graph, { node: "n1", port: "image" }).find((c) => c.type === "build-model")?.wireInto).toBe("image");
  });

  it("offers the Game Template from Build Model's model output, into its hero input", () => {
    expect(addChoices(withBuilt(), { node: "n9", port: "model" }).map((c) => [c.type, c.wireInto])).toEqual([["prepare-model", "model"], ["game-template", "hero"]]);
  });
});

describe("addChoices and Describe Game", () => {
  it("offers Describe Game with its plain name and help", () => {
    const choice = addChoices(withoutPreview()).find((c) => c.type === "describe-game");
    expect(choice).toMatchObject({ label: "Describe Game", help: NODE_SPECS["describe-game"].help });
  });

  it("offers the Game Template from an open feel output, into its feel input", () => {
    const graph: Graph = { ...withoutPreview(), nodes: [...withoutPreview().nodes, { id: "n9", type: "describe-game", params: { prompt: "" }, position: { x: 0, y: 400 } }] };
    expect(addChoices(graph, { node: "n9", port: "feel" }).map((c) => [c.type, c.wireInto])).toEqual([["game-template", "feel"]]);
    expect(addChoices(graph, { node: "n9", port: "palette" }).map((c) => [c.type, c.wireInto])).toEqual([["prepare-model", "palette"], ["make-shape", "palette"], ["build-model", "palette"], ["game-template", "palette"]]);
  });
});

describe("addChoices and the Blender steps", () => {
  it("offers Prepare Model and Make Shape with their plain names and help", () => {
    const choices = addChoices(withoutPreview());
    expect(choices.find((c) => c.type === "prepare-model")).toMatchObject({ label: "Prepare Model", help: NODE_SPECS["prepare-model"].help });
    expect(choices.find((c) => c.type === "make-shape")).toMatchObject({ label: "Make Shape", help: NODE_SPECS["make-shape"].help });
  });

  it("offers Prepare Model from a 3D model output (into its model input), and both from a palette output", () => {
    const graph = withoutPreview();
    expect(addChoices(graph, { node: "n5", port: "model" }).find((c) => c.type === "prepare-model")?.wireInto).toBe("model");
    expect(addChoices(graph, { node: "n2", port: "palette" }).filter((c) => c.wireInto === "palette").map((c) => c.type)).toEqual(["prepare-model", "make-shape", "build-model", "game-template"]);
  });
});
