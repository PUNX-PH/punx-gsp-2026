"use client";

// A wire: a colored curve, a small pill that says in plain words what it carries, and a × to remove it while selected.
import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { useContext } from "react";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { CrossIcon } from "@/app/graphs/[id]/icons";
import { EditorActionsContext } from "@/app/graphs/[id]/StepCard";
import type { WireType } from "@/lib/graph/types";

type WireData = { word: string; wire: WireType };
export type WireEdgeType = Edge<WireData, "wire">;

export function WireEdge({ id, source, target, sourceHandleId, targetHandleId, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps<WireEdgeType>) {
  const actions = useContext(EditorActionsContext);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const wire = data?.wire ?? "image";

  return (
    <>
      <BaseEdge id={id} path={path} className={cx(styles.edgePath, styles[`wire_${wire}`], selected && styles.edgeSelected)} />
      <EdgeLabelRenderer>
        <div
          className={cx(styles.pill, "nodrag", "nopan")}
          style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
        >
          {data?.word}
          {selected && (
            <button
              type="button"
              className={styles.pillRemove}
              aria-label={`Remove this ${data?.word ?? ""} wire`}
              onClick={() => actions.onRemoveEdge({ from: { node: source, port: sourceHandleId ?? "" }, to: { node: target, port: targetHandleId ?? "" } })}
            >
              <CrossIcon />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
