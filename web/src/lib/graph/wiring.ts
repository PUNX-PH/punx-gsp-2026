// The one rule for "may this wire exist", in sentences written for people. The server's graph parser and the canvas both
// use it, so a wire is refused in the same words wherever it is tried. Pure: it only reads what it is given.
import { NODE_SPECS, type NodeSpec, WIRE_WORDS } from "@/lib/graph/registry";
import type { GraphEdge, GraphNode } from "@/lib/graph/types";

// "a picture", "an environment": the article follows the word's first letter.
const article = (word: string, capital: boolean): string => {
  const text = /^[aeiou]/i.test(word) ? "an" : "a";
  return capital ? text[0].toUpperCase() + text.slice(1) : text;
};

/**
 * Why `edge` may not be added to a graph with these `nodes` and the wires already there (`existing`), or null if it may.
 * The checks run in this order: both nodes exist, not the same step, the ports exist and point the right way, the types
 * match, and the input has no wire yet.
 */
export function wiringProblem(
  nodes: GraphNode[],
  existing: GraphEdge[],
  edge: GraphEdge,
  specs: Record<string, NodeSpec> = NODE_SPECS,
): string | null {
  const from = nodes.find((n) => n.id === edge.from.node);
  const to = nodes.find((n) => n.id === edge.to.node);
  if (!from) return `A wire refers to a node that does not exist ("${edge.from.node}").`;
  if (!to) return `A wire refers to a node that does not exist ("${edge.to.node}").`;
  if (from.id === to.id) return "A step can't connect to itself.";
  const fromSpec = specs[from.type];
  const toSpec = specs[to.type];

  const output = fromSpec.outputs.find((p) => p.name === edge.from.port);
  if (!output) {
    if (fromSpec.inputs.some((p) => p.name === edge.from.port)) return `"${edge.from.port}" on ${fromSpec.label} is an input, not an output.`;
    return `Node ${from.id} (${fromSpec.label}) has no port "${edge.from.port}".`;
  }
  const input = toSpec.inputs.find((p) => p.name === edge.to.port);
  if (!input) {
    if (toSpec.outputs.some((p) => p.name === edge.to.port)) return `"${edge.to.port}" on ${toSpec.label} is an output, not an input.`;
    return `Node ${to.id} (${toSpec.label}) has no port "${edge.to.port}".`;
  }

  if (output.type !== input.type) return `${article(WIRE_WORDS[output.type], true)} ${WIRE_WORDS[output.type]} can't go into ${article(WIRE_WORDS[input.type], false)} ${WIRE_WORDS[input.type]} input.`;
  if (existing.some((e) => e.to.node === edge.to.node && e.to.port === edge.to.port)) {
    return `${toSpec.label}'s ${input.label} input already has a wire. Remove it first.`;
  }
  return null;
}
