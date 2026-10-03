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
    expect(choices.map((c) => c.type)).toEqual(["reference-image", "model", "palette-from-image", "game-template", "preview"]);
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
    expect(choices).toHaveLength(5);
    for (const choice of choices) expect(choice.disabledReason).toBe("A graph can have at most 50 steps.");
  });

  it("from an open output, offers only the steps that accept that wire type, and says which input to use", () => {
    const graph = withoutPreview();
    expect(addChoices(graph, { node: "n1", port: "image" }).map((c) => [c.type, c.wireInto])).toEqual([["palette-from-image", "image"]]);
    expect(addChoices(graph, { node: "n2", port: "palette" }).map((c) => [c.type, c.wireInto])).toEqual([["game-template", "palette"]]);
    expect(addChoices(graph, { node: "n5", port: "model" }).map((c) => [c.type, c.wireInto])).toEqual([["game-template", "hero"]]);
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
