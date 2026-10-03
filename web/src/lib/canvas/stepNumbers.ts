// Which steps lead to the Preview and in what order they run (the numbers on the cards), and which results an edit makes
// out of date. Pure, built on the engine's walking functions.
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { Graph } from "@/lib/graph/types";
import { ancestors, descendants, orderNodes } from "@/lib/graph/walk";

/** The steps that lead to the Preview, numbered from 1 in the order the runner takes them. Empty with no Preview or a loop. */
export function stepNumbers(graph: Graph, specs: Record<string, NodeSpec> = NODE_SPECS): Map<string, number> {
  const finals = graph.nodes.filter((n) => Object.hasOwn(specs, n.type) && specs[n.type].final).map((n) => n.id);
  if (finals.length === 0) return new Map();
  const planned = orderNodes(graph, ancestors(graph, finals));
  if (!planned.ok) return new Map();
  return new Map(planned.order.map((id, i) => [id, i + 1]));
}

/** The touched steps that exist, and everything downstream of them: their results are no longer true. */
export function staleAfter(graph: Graph, touched: string[]): Set<string> {
  const known = new Set(graph.nodes.map((n) => n.id));
  return descendants(graph, touched.filter((id) => known.has(id)));
}
