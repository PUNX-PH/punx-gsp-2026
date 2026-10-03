// Edits to a graph. Each returns a new graph and leaves the one it was given alone. The ones the canvas uses also say which
// steps they make out of date (`touched`: the steps whose results are no longer true), so the rule lives with the edit.
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import { MAX_EDGES, MAX_NODES } from "@/lib/graph/schema";
import type { Graph, GraphEdge, GraphNode, Tuning } from "@/lib/graph/types";
import { wiringProblem } from "@/lib/graph/wiring";

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

// ---- edits for the canvas ----

/** A new graph, and the ids of the steps whose results it makes out of date. */
export interface Edit {
  graph: Graph;
  touched: string[];
}

const STEP_GAP_X = 200;
const STEP_GAP_Y = 140;

/** Why a step of this type may not be added to the graph, or null if it may. */
export function addProblem(graph: Graph, type: string, specs: Record<string, NodeSpec> = NODE_SPECS): string | null {
  if (!Object.hasOwn(specs, type)) return "Unknown step type.";
  if (graph.nodes.length >= MAX_NODES) return `A graph can have at most ${MAX_NODES} steps.`;
  if (specs[type].final && graph.nodes.some((n) => specs[n.type]?.final)) return "A graph has one Preview.";
  return null;
}

// The first spot at or below `near` that is clear of every other step.
function freeSpot(nodes: GraphNode[], near: { x: number; y: number }): { x: number; y: number } {
  for (let k = 0; ; k++) {
    const spot = { x: near.x, y: near.y + k * STEP_GAP_Y };
    if (nodes.every((n) => Math.abs(n.position.x - spot.x) >= STEP_GAP_X || Math.abs(n.position.y - spot.y) >= STEP_GAP_Y)) return spot;
  }
}

/** Adds a step of this type with its default settings, under the lowest unused id (`n1`, `n2`, ...). */
export function addNode(
  graph: Graph,
  type: string,
  near: { x: number; y: number },
  specs: Record<string, NodeSpec> = NODE_SPECS,
): ({ ok: true; id: string } & Edit) | { ok: false; reason: string } {
  const problem = addProblem(graph, type, specs);
  if (problem) return { ok: false, reason: problem };

  const used = new Set(graph.nodes.map((n) => n.id));
  let k = 1;
  while (used.has(`n${k}`)) k++;
  const id = `n${k}`;
  const node: GraphNode = { id, type, params: specs[type].defaultParams(), position: freeSpot(graph.nodes, near) };
  return { ok: true, id, graph: { ...graph, nodes: [...graph.nodes, node] }, touched: [] };
}

/** Removes a step and every wire touching it. The steps it fed are touched. */
export function removeNode(graph: Graph, id: string): Edit {
  if (!graph.nodes.some((n) => n.id === id)) return { graph, touched: [] };
  const fed = [...new Set(graph.edges.filter((e) => e.from.node === id).map((e) => e.to.node))].filter((n) => n !== id);
  return {
    graph: { ...graph, nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter((e) => e.from.node !== id && e.to.node !== id) },
    touched: fed,
  };
}

/** Adds a wire if the wire rule and the limit allow it. The step it ends at is touched. */
export function addEdge(graph: Graph, edge: GraphEdge, specs: Record<string, NodeSpec> = NODE_SPECS): ({ ok: true } & Edit) | { ok: false; reason: string } {
  if (graph.edges.length >= MAX_EDGES) return { ok: false, reason: `A graph can have at most ${MAX_EDGES} wires.` };
  const problem = wiringProblem(graph.nodes, graph.edges, edge, specs);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, graph: { ...graph, edges: [...graph.edges, edge] }, touched: [edge.to.node] };
}

const sameWire = (a: GraphEdge, b: GraphEdge) =>
  a.from.node === b.from.node && a.from.port === b.from.port && a.to.node === b.to.node && a.to.port === b.to.port;

/** Removes a wire. The step it ended at is touched. A wire that is not there changes nothing. */
export function removeEdge(graph: Graph, edge: GraphEdge): Edit {
  const edges = graph.edges.filter((e) => !sameWire(e, edge));
  if (edges.length === graph.edges.length) return { graph, touched: [] };
  return { graph: { ...graph, edges }, touched: [edge.to.node] };
}

/** Moves a step. Results stay true, so nothing is touched. */
export function moveNode(graph: Graph, id: string, position: { x: number; y: number }): Edit {
  if (!graph.nodes.some((n) => n.id === id)) return { graph, touched: [] };
  return { graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position: { x: position.x, y: position.y } } : n)) }, touched: [] };
}

/** Chooses (or clears) the file a step uses. */
export const editAsset = (graph: Graph, nodeId: string, sha256: string | null): Edit => ({ graph: setAsset(graph, nodeId, sha256), touched: [nodeId] });

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sets a Game Template's tuning, rounded to two decimals so a slider's float noise is never stored. */
export const editTuning = (graph: Graph, nodeId: string, tuning: Tuning): Edit => ({
  graph: setTuning(graph, nodeId, { speed: round2(tuning.speed), jumpHeight: round2(tuning.jumpHeight), obstacleSpacing: round2(tuning.obstacleSpacing) }),
  touched: [nodeId],
});
