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
