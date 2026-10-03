// What stops a graph from running, found before any node executes and reported all at once, each on its node. Only
// nodes that lead to the Preview are looked at: a half-built corner that feeds nothing is not an error.
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { Assets, Graph, Problem } from "@/lib/graph/types";
import { ancestors, orderNodes } from "@/lib/graph/walk";

export function checkGraph(graph: Graph, assets: Assets, specs: Record<string, NodeSpec> = NODE_SPECS): Problem[] {
  const finals = graph.nodes.filter((n) => Object.hasOwn(specs, n.type) && specs[n.type].final);
  if (finals.length === 0) return [{ node: null, message: "Add a Preview node to see your game." }];

  const problems: Problem[] = [];
  if (finals.length > 1) problems.push({ node: null, message: "A graph can have only one Preview." });

  const leading = ancestors(graph, finals.map((n) => n.id));
  const order = orderNodes(graph, leading);
  if (!order.ok) {
    const labels = order.cycle.map((id) => specs[graph.nodes.find((n) => n.id === id)!.type].label);
    problems.push({ node: order.cycle[0], message: `These steps loop back on themselves: ${labels.join(", ")}.` });
  }

  const connected = new Set(graph.edges.map((e) => `${e.to.node}\u0000${e.to.port}`));
  for (const node of graph.nodes) {
    if (!leading.has(node.id)) continue;
    const spec = specs[node.type];

    for (const input of spec.inputs) {
      if (input.required && !connected.has(`${node.id}\u0000${input.name}`)) {
        problems.push({ node: node.id, message: input.missing ?? `${spec.label} needs its ${input.label}.` });
      }
    }

    const unfinished = spec.incompleteProblem(node.params);
    if (unfinished) {
      problems.push({ node: node.id, message: `${spec.label}: ${unfinished}` });
    } else if (typeof node.params.asset === "string" && !Object.hasOwn(assets, node.params.asset)) {
      problems.push({ node: node.id, message: `${spec.label}: the file is gone. Choose it again.` });
    }
  }
  return problems;
}
