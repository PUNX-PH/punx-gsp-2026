"use client";

// The step card as a React Flow node: the card itself plus its connection handles, wired to what the editor can do
// through a context (so the card needs no props beyond the node's own).
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { createContext, useContext } from "react";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { StepCardView } from "@/app/graphs/[id]/StepCardView";
import type { PortView, StepData } from "@/lib/canvas/cardView";
import type { GraphEdge } from "@/lib/graph/types";

/** What a card or a wire can ask the editor to do. */
export interface EditorActions {
  onAddFrom(nodeId: string, port: string): void;
  onRemoveNode(id: string): void;
  onRemoveEdge(edge: GraphEdge): void;
  onOpenGame(): void;
}

const NOTHING: EditorActions = { onAddFrom() {}, onRemoveNode() {}, onRemoveEdge() {}, onOpenGame() {} };

export const EditorActionsContext = createContext<EditorActions>(NOTHING);

export type StepNode = Node<StepData, "step">;

export function StepCard({ data, selected }: NodeProps<StepNode>) {
  const actions = useContext(EditorActionsContext);

  const renderHandle = (port: PortView, side: "input" | "output") => (
    <Handle
      key={`${side}:${port.name}`}
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
