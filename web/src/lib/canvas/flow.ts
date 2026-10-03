// The two-way mapping between our graph and React Flow. Our Graph stays the single source of truth: React Flow's nodes
// and edges are derived from it for drawing, and what React Flow reports (a drag, a delete, a click) is turned back into
// the graph's own edits. Only types are imported from React Flow, so this stays pure.
import type { EdgeChange, NodeChange } from "@xyflow/react";
import type { Selection } from "@/lib/canvas/editorState";
import { type StepData, type StepDataArgs, stepData } from "@/lib/canvas/cardView";
import { moveNode, removeEdge, removeNode } from "@/lib/graph/edits";
import { NODE_SPECS, WIRE_WORDS } from "@/lib/graph/registry";
import type { Graph, GraphEdge, WireType } from "@/lib/graph/types";

export interface FlowNode {
  id: string;
  type: "step";
  position: { x: number; y: number };
  data: StepData;
  selected: boolean;
}

export interface FlowEdge {
  id: string;
  type: "wire";
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  selected: boolean;
  data: { word: string; wire: WireType };
}

/** A name for a wire that is the same every time. */
export const edgeId = (edge: GraphEdge): string => `${edge.from.node}.${edge.from.port}->${edge.to.node}.${edge.to.port}`;

const sameWire = (a: GraphEdge, b: GraphEdge) => edgeId(a) === edgeId(b);

export function toFlow(args: Omit<StepDataArgs, "node"> & { selection: Selection }): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const { graph, selection } = args;
  const specs = args.specs ?? NODE_SPECS;

  const nodes: FlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "step",
    position: node.position,
    data: stepData({ ...args, node }),
    selected: selection.kind === "node" && selection.id === node.id,
  }));

  const edges: FlowEdge[] = graph.edges.map((edge) => {
    const from = graph.nodes.find((n) => n.id === edge.from.node);
    const wire = (from && specs[from.type]?.outputs.find((p) => p.name === edge.from.port)?.type) ?? "image";
    return {
      id: edgeId(edge),
      type: "wire",
      source: edge.from.node,
      target: edge.to.node,
      sourceHandle: edge.from.port,
      targetHandle: edge.to.port,
      selected: selection.kind === "edge" && sameWire(selection.edge, edge),
      data: { word: WIRE_WORDS[wire], wire },
    };
  });

  return { nodes, edges };
}

/** A wire from what React Flow reports when a connection is made, or null when it is not finished. */
export function connectionToEdge(c: { source: string | null; sourceHandle?: string | null; target: string | null; targetHandle?: string | null }): GraphEdge | null {
  if (!c.source || !c.sourceHandle || !c.target || !c.targetHandle) return null;
  return { from: { node: c.source, port: c.sourceHandle }, to: { node: c.target, port: c.targetHandle } };
}

/**
 * The graph after React Flow's changes to its nodes: drags move steps, deletes remove them. `touched` is the steps whose
 * results that makes out of date. `selected` is the newly selected step, null when the selection was cleared, undefined
 * when the changes did not involve selection. Sizes and other bookkeeping are ignored.
 */
export function graphFromNodeChanges(graph: Graph, changes: NodeChange[]): { graph: Graph; touched: string[]; selected: string | null | undefined } {
  let current = graph;
  const touched = new Set<string>();
  let selected: string | null | undefined;

  for (const change of changes) {
    if (change.type === "position" && change.position) {
      current = moveNode(current, change.id, change.position).graph;
    } else if (change.type === "remove") {
      const edit = removeNode(current, change.id);
      current = edit.graph;
      for (const id of edit.touched) touched.add(id);
    } else if (change.type === "select") {
      if (change.selected) selected = change.id;
      else if (selected === undefined) selected = null;
    }
  }

  const exists = new Set(current.nodes.map((n) => n.id));
  return { graph: current, touched: [...touched].filter((id) => exists.has(id)), selected };
}

/** The same for React Flow's changes to its edges: deletes remove wires, selection reports the wire. */
export function graphFromEdgeChanges(graph: Graph, changes: EdgeChange[]): { graph: Graph; touched: string[]; selected: GraphEdge | null | undefined } {
  let current = graph;
  const touched = new Set<string>();
  let selected: GraphEdge | null | undefined;

  for (const change of changes) {
    if (change.type !== "remove" && change.type !== "select") continue;
    const edge = current.edges.find((e) => edgeId(e) === change.id);
    if (!edge) continue;
    if (change.type === "remove") {
      const edit = removeEdge(current, edge);
      current = edit.graph;
      for (const id of edit.touched) touched.add(id);
    } else if (change.selected) {
      selected = edge;
    } else if (selected === undefined) {
      selected = null;
    }
  }
  return { graph: current, touched: [...touched], selected };
}
