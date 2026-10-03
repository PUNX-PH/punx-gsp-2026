// The two edits the plain page makes to a graph. Each returns a new graph and leaves the one it was given alone.
import type { Graph, Tuning } from "@/lib/graph/types";

function withParams(graph: Graph, nodeId: string, change: Record<string, unknown>): Graph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, params: { ...n.params, ...change } } : n)) };
}

/** Chooses the uploaded file (by hash) a node uses, or clears the choice. */
export const setAsset = (graph: Graph, nodeId: string, sha256: string | null): Graph => withParams(graph, nodeId, { asset: sha256 });

/** Sets a Game Template's tuning. */
export const setTuning = (graph: Graph, nodeId: string, tuning: Tuning): Graph =>
  withParams(graph, nodeId, { tuning: { speed: tuning.speed, jumpHeight: tuning.jumpHeight, obstacleSpacing: tuning.obstacleSpacing } });

export type WorkingCopy = { ok: true; graph: Graph } | { ok: false; error: string };

/**
 * Makes an edit to the graph that is in the JSON box (the working copy), not to the last saved one, so that what the
 * person typed there is kept. When the box does not hold a graph yet, nothing is changed and the reason is returned.
 */
export function applyToWorkingCopy(text: string, edit: (graph: Graph) => Graph): WorkingCopy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Fix the graph JSON first (it is not valid JSON), then try again." };
  }
  const shape = parsed as { nodes?: unknown; edges?: unknown } | null;
  if (typeof parsed !== "object" || shape === null || Array.isArray(parsed) || !Array.isArray(shape.nodes) || !Array.isArray(shape.edges)) {
    return { ok: false, error: "Fix the graph JSON first (it is not a graph yet), then try again." };
  }
  return { ok: true, graph: edit(parsed as Graph) };
}
