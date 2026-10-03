// What Play said, laid over the graph. The run view is what the cards show as results: the outcome of each step that ran,
// the problems of an unfinished graph, the link to the game, and which results an edit has made out of date. Pure.
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { NodeOutcome } from "@/lib/graph/runner";
import type { Graph, Problem } from "@/lib/graph/types";
import { stepNumbers, staleAfter } from "@/lib/canvas/stepNumbers";

export type PlayResponse =
  | { kind: "ran"; state: "done" | "failed"; order: string[]; nodes: Record<string, NodeOutcome>; runId?: string }
  | { kind: "invalid"; problems: Problem[] };

export interface RunView {
  /** The run the game view shows, or null when there is none (never played, or its Preview failed). */
  runId: string | null;
  order: string[];
  outcomes: Record<string, NodeOutcome>;
  problems: Problem[];
  /** Steps whose results an edit has made out of date. */
  stale: string[];
  ranOnce: boolean;
}

const MAX_REVEAL_MS = 1500;

export const emptyRunView = (runId: string | null): RunView => ({ runId, order: [], outcomes: {}, problems: [], stale: [], ranOnce: false });

/** The Preview: the step the graph runs towards. */
export function finalNodeId(graph: Graph, specs: Record<string, NodeSpec> = NODE_SPECS): string | null {
  return graph.nodes.find((n) => Object.hasOwn(specs, n.type) && specs[n.type].final)?.id ?? null;
}

/** The view after Play answered. */
export function applyPlay(view: RunView, graph: Graph, response: PlayResponse): RunView {
  if (response.kind === "invalid") return { ...view, outcomes: {}, order: [], problems: response.problems };

  // The Preview deletes the graph's earlier run before it stores a new one. If it failed, that run is gone; if it never
  // ran (an earlier step failed), the earlier run is still there.
  const final = finalNodeId(graph);
  const previewFailed = final !== null && response.nodes[final]?.state === "failed";
  return {
    runId: response.runId ?? (previewFailed ? null : view.runId),
    order: response.order,
    outcomes: response.nodes,
    problems: [],
    stale: [],
    ranOnce: true,
  };
}

/** Clears the results and problems of the touched steps and everything downstream of them (the new graph decides what is downstream). */
export function markStale(view: RunView, graph: Graph, touched: string[]): RunView {
  if (touched.length === 0) return view;
  const stale = staleAfter(graph, touched);
  if (stale.size === 0) return view;
  return {
    ...view,
    outcomes: Object.fromEntries(Object.entries(view.outcomes).filter(([id]) => !stale.has(id))),
    problems: view.problems.filter((p) => p.node === null || !stale.has(p.node)),
    stale: [...new Set([...view.stale, ...stale])],
  };
}

/** True when a step that leads to the Preview has changed since the game was made. */
export function isOutOfDate(view: RunView, graph: Graph): boolean {
  const leading = stepNumbers(graph);
  return view.stale.some((id) => leading.has(id));
}

/** When each step's result appears after Play: one at a time, but a long graph still finishes within 1.5 seconds. */
export function revealSchedule(order: string[], delayMs: number, reducedMotion: boolean): { node: string; atMs: number }[] {
  if (order.length === 0) return [];
  const gap = reducedMotion ? 0 : Math.min(delayMs, MAX_REVEAL_MS / order.length);
  return order.map((node, i) => ({ node, atMs: Math.round(i * gap) }));
}
