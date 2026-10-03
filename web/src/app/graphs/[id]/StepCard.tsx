"use client";

// The step card as a React Flow node: the card itself plus its connection handles, wired to what the editor can do
// through a context (so the card needs no props beyond the node's own).
import { Handle, type Node, type NodeProps, Position, useConnection } from "@xyflow/react";
import { createContext, useContext } from "react";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { StepCardView } from "@/app/graphs/[id]/StepCardView";
import type { PortView, StepData } from "@/lib/canvas/cardView";
import { candidateEdge } from "@/lib/canvas/flow";
import type { GraphEdge } from "@/lib/graph/types";

/** What a card or a wire can ask the editor to do. */
export interface EditorActions {
  onAddFrom(nodeId: string, port: string): void;
  onRemoveNode(id: string): void;
  onRemoveEdge(edge: GraphEdge): void;
  onOpenGame(): void;
  /** Whether a wire may be made (the wire rule), used to light up the handles that accept a wire being dragged. */
  canConnect(edge: GraphEdge): boolean;
}

const NOTHING: EditorActions = { onAddFrom() {}, onRemoveNode() {}, onRemoveEdge() {}, onOpenGame() {}, canConnect: () => false };

export const EditorActionsContext = createContext<EditorActions>(NOTHING);

export type StepNode = Node<StepData, "step">;

export function StepCard({ data, selected }: NodeProps<StepNode>) {
  const actions = useContext(EditorActionsContext);
  // The handle a wire is being dragged from, as a string so that moving the pointer does not re-render every card.
  const dragFrom = useConnection((c) => (c.inProgress && c.fromNode && c.fromHandle ? `${c.fromNode.id}|${c.fromHandle.id ?? ""}|${c.fromHandle.type}` : null));

  // While a wire is dragged, every handle says whether it would accept it (React Flow only marks the one under the pointer).
  const connectable = (port: PortView, side: "input" | "output"): "yes" | "no" | undefined => {
    if (!dragFrom) return undefined;
    const [node, handle, type] = dragFrom.split("|");
    const start = { node, port: handle, type: type as "source" | "target" };
    const end = { node: data.id, port: port.name, type: side === "input" ? ("target" as const) : ("source" as const) };
    if (start.node === end.node && start.port === end.port && start.type === end.type) return undefined; // where it started
    return actions.canConnect(candidateEdge(start, end)) ? "yes" : "no";
  };

  const renderHandle = (port: PortView, side: "input" | "output") => (
    <Handle
      key={`${side}:${port.name}`}
      data-connectable={connectable(port, side)}
      id={port.name}
      type={side === "input" ? "target" : "source"}
      position={side === "input" ? Position.Left : Position.Right}
      className={cx(styles.handle, styles[`wire_${port.type}`])}
      title={port.label}
    />
  );

  return (
    <StepCardView
      data={data}
      selected={selected}
      renderHandle={renderHandle}
      onAddFrom={(port) => actions.onAddFrom(data.id, port)}
      onRemove={() => actions.onRemoveNode(data.id)}
      onOpenGame={actions.onOpenGame}
    />
  );
}
