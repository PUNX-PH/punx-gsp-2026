// The graph the site makes from one description: Describe Game (the person's words), a Build Model step for each model the AI asked for, the Game Template and
// the Preview, already wired. Pure: the AI's answer goes in, a graph comes out; the person never wires anything. Every model step is `soft`, so one that cannot
// be built leaves a plain shape in the game instead of stopping it.
import type { AssetRequest } from "@/lib/engine/service";
import { MAX_DESCRIPTION_CHARACTERS, MAX_PROMPT_CHARACTERS, SCRIPT_MODEL_PORTS } from "@/lib/graph/registry";
import type { Graph } from "@/lib/graph/types";

const COLUMN = 280;
const ROW = 190;

export function generatedGraph(input: { words: string; assets: AssetRequest[] }): Graph {
  const assets = input.assets.slice(0, SCRIPT_MODEL_PORTS);
  // The steps are laid out in columns, left to right: the words, the models (one under another), the template, the preview.
  const middle = ((assets.length - 1) * ROW) / 2;
  const nodes: Graph["nodes"] = [
    { id: "n1", type: "describe-game", params: { prompt: Array.from(input.words).slice(0, MAX_PROMPT_CHARACTERS).join(""), makeGame: "script" }, position: { x: 0, y: Math.max(0, middle) } },
  ];
  const edges: Graph["edges"] = [];

  assets.forEach((asset, i) => {
    const id = `n${i + 2}`;
    nodes.push({
      id,
      type: "build-model",
      params: {
        role: asset.role,
        kind: asset.kind,
        description: Array.from(asset.description).slice(0, MAX_DESCRIPTION_CHARACTERS).join(""),
        run: "",
        jump: "",
        loop: "",
        quality: "standard",
        soft: true,
      },
      position: { x: COLUMN, y: i * ROW },
    });
    edges.push({ from: { node: "n1", port: "palette" }, to: { node: id, port: "palette" } });
    edges.push({ from: { node: id, port: "model" }, to: { node: "template", port: `model${i + 1}` } });
  });

  nodes.push({ id: "template", type: "game-template", params: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, position: { x: COLUMN * 2, y: Math.max(0, middle) } });
  nodes.push({ id: "preview", type: "preview", params: {}, position: { x: COLUMN * 3, y: Math.max(0, middle) } });
  edges.push({ from: { node: "n1", port: "game" }, to: { node: "template", port: "game" } });
  edges.push({ from: { node: "template", port: "settings" }, to: { node: "preview", port: "settings" } });

  return { schemaVersion: 1, nodes, edges };
}
