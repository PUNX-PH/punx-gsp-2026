// The graph a person starts from: a picture gives the palette, the template makes the game, the Preview plays it. A
// 3D Model node sits unconnected beside them (it shows as "not used") so it is clear where a model of one's own goes.
import type { Graph } from "@/lib/graph/types";

export function starterGraph(): Graph {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "n1", type: "reference-image", params: { asset: null }, position: { x: 0, y: 0 } },
      { id: "n2", type: "palette-from-image", params: {}, position: { x: 260, y: 0 } },
      { id: "n3", type: "game-template", params: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, position: { x: 520, y: 0 } },
      { id: "n4", type: "preview", params: {}, position: { x: 780, y: 0 } },
      { id: "n5", type: "model", params: { asset: null }, position: { x: 260, y: 200 } },
    ],
    edges: [
      { from: { node: "n1", port: "image" }, to: { node: "n2", port: "image" } },
      { from: { node: "n2", port: "palette" }, to: { node: "n3", port: "palette" } },
      { from: { node: "n3", port: "settings" }, to: { node: "n4", port: "settings" } },
    ],
  };
}
