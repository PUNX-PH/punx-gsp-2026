// The graph a person starts from: a picture gives the palette, the template makes the game, the Preview plays it. A
// 3D Model node sits unconnected beside them (it shows as "not used") so it is clear where a model of one's own goes.
import type { Graph } from "@/lib/graph/types";

/** The other starter: the person's words (and a picture, if they like) give the palette and the feel. No Palette from Image, no sliders to set. */
export function describedStarterGraph(): Graph {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "n1", type: "reference-image", params: { asset: null }, position: { x: 0, y: 0 } },
      { id: "n2", type: "describe-game", params: { prompt: "" }, position: { x: 260, y: 0 } },
      { id: "n3", type: "game-template", params: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, position: { x: 520, y: 0 } },
      { id: "n4", type: "preview", params: {}, position: { x: 780, y: 0 } },
    ],
    edges: [
      { from: { node: "n1", port: "image" }, to: { node: "n2", port: "image" } },
      { from: { node: "n2", port: "palette" }, to: { node: "n3", port: "palette" } },
      { from: { node: "n2", port: "feel" }, to: { node: "n3", port: "feel" } },
      { from: { node: "n3", port: "settings" }, to: { node: "n4", port: "settings" } },
    ],
  };
}

/**
 * The third starter: a character built from the kit and a meadow around the track, with no words and no AI. It plays as it is, and the
 * person can describe either later.
 */
export function builtStarterGraph(): Graph {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "n1", type: "build-model", params: { role: "hero", kind: "biped", description: "", run: "", jump: "", loop: "" }, position: { x: 0, y: 0 } },
      { id: "n2", type: "game-template", params: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, position: { x: 260, y: 0 } },
      { id: "n3", type: "preview", params: {}, position: { x: 520, y: 0 } },
      { id: "n4", type: "build-environment", params: { theme: "", density: "some" }, position: { x: 0, y: 280 } },
    ],
    edges: [
      { from: { node: "n1", port: "model" }, to: { node: "n2", port: "hero" } },
      { from: { node: "n4", port: "environment" }, to: { node: "n2", port: "environment" } },
      { from: { node: "n2", port: "settings" }, to: { node: "n3", port: "settings" } },
    ],
  };
}

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
