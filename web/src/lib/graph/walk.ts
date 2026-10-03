// Walking a graph: which nodes lead somewhere, and in what order to run them. Pure; ids are looked up in Maps only.
import type { Graph } from "@/lib/graph/types";

/** The roots and every node upstream of them. */
export function ancestors(graph: Graph, roots: string[]): Set<string> {
  const feeders = new Map<string, string[]>();
  for (const edge of graph.edges) feeders.set(edge.to.node, [...(feeders.get(edge.to.node) ?? []), edge.from.node]);

  const seen = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(feeders.get(id) ?? []));
  }
  return seen;
}

export type Order = { ok: true; order: string[] } | { ok: false; cycle: string[] };

/**
 * The nodes of `among` in an order where every node comes after the nodes that feed it (wires to or from other nodes
 * are ignored). Of the nodes that are ready the lowest id goes first, so the order is always the same. A loop gives
 * the ids of the nodes on it.
 */
export function orderNodes(graph: Graph, among: Set<string>): Order {
  const waiting = new Map<string, number>(); // wires still to be satisfied
  const feeds = new Map<string, string[]>();
  for (const id of among) {
    waiting.set(id, 0);
    feeds.set(id, []);
  }
  for (const edge of graph.edges) {
    if (!among.has(edge.from.node) || !among.has(edge.to.node)) continue;
    waiting.set(edge.to.node, waiting.get(edge.to.node)! + 1);
    feeds.get(edge.from.node)!.push(edge.to.node);
  }

  const ready = [...among].filter((id) => waiting.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of feeds.get(id)!) {
      const left = waiting.get(next)! - 1;
      waiting.set(next, left);
      if (left === 0) ready.push(next);
    }
    ready.sort();
  }
  if (order.length === among.size) return { ok: true, order };

  // What is left is the loops and whatever hangs off them; peel off the nodes that feed nothing that is left.
  const left = new Set([...among].filter((id) => !order.includes(id)));
  for (let peeled = true; peeled; ) {
    peeled = false;
    for (const id of left) {
      if (feeds.get(id)!.some((next) => left.has(next))) continue;
      left.delete(id);
      peeled = true;
    }
  }
  return { ok: false, cycle: [...left].sort() };
}
