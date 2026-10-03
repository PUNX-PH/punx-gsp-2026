"use client";

// The node canvas. It holds one reducer (the graph, the run view, the selection) and hands React Flow a picture of it;
// everything React Flow reports (a drag, a delete, a wire) goes back through the pure units in lib/graph and lib/canvas,
// so the rules are tested without a browser and this file only connects them.
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type FinalConnectionState,
  type NodeChange,
  type EdgeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { AddMenu } from "@/app/graphs/[id]/AddMenu";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { SettingsPanel } from "@/app/graphs/[id]/SettingsPanel";
import { type EditorActions, EditorActionsContext, StepCard, type StepNode } from "@/app/graphs/[id]/StepCard";
import { Toolbar } from "@/app/graphs/[id]/Toolbar";
import { WireEdge, type WireEdgeType } from "@/app/graphs/[id]/WireEdge";
import { type Choice, addChoices } from "@/lib/canvas/addMenu";
import { editorReducer, initialEditorState } from "@/lib/canvas/editorState";
import { connectionToEdge, graphFromEdgeChanges, graphFromNodeChanges, toFlow } from "@/lib/canvas/flow";
import type { Theme } from "@/lib/canvas/prefs";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import { type Edit, addEdge, addNode, editTuning, removeEdge, removeNode } from "@/lib/graph/edits";
import { starterGraph } from "@/lib/graph/starter";
import type { Assets, Graph, GraphEdge, PortRef } from "@/lib/graph/types";
import { wiringProblem } from "@/lib/graph/wiring";

export interface EditorProps {
  id: string;
  name: string;
  initialGraph: Graph;
  initialAssets: Assets;
  initialRunId: string | null;
}

const NODE_TYPES = { step: StepCard };
const EDGE_TYPES = { wire: WireEdge };
const NO_PENDING: ReadonlySet<string> = new Set();
const TOAST_MS = 4000;

export function Editor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ id, name, initialGraph, initialAssets, initialRunId }: EditorProps) {
  const [state, dispatch] = useReducer(editorReducer, { graph: initialGraph, assets: initialAssets, lastRunId: initialRunId }, initialEditorState);
  const [theme, setTheme] = useState<Theme>("dark");
  const [menu, setMenu] = useState<{ from?: PortRef; anchor?: { x: number; y: number } } | null>(null);
  const [toastAt, setToastAt] = useState<{ x: number; y: number } | null>(null);
  // In a controlled flow React Flow hides a node until it is told the node's measured size, so the sizes it reports are
  // kept here and handed back with the nodes.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow();

  const { graph } = state;
  const numbers = useMemo(() => stepNumbers(graph), [graph]);
  const flow = useMemo(
    () => toFlow({ graph, assets: state.assets, run: state.run, numbers, graphId: id, pending: NO_PENDING, selection: state.selection }),
    [graph, state.assets, state.run, numbers, id, state.selection],
  );
  const nodes = useMemo(() => flow.nodes.map((n) => (measured[n.id] ? { ...n, measured: measured[n.id] } : n)) as StepNode[], [flow.nodes, measured]);
  const edges = flow.edges as WireEdgeType[];

  const apply = useCallback((edit: Edit) => dispatch({ type: "edited", graph: edit.graph, touched: edit.touched }), []);
  const say = useCallback((message: string, at: { x: number; y: number } | null = null) => {
    setToastAt(at);
    dispatch({ type: "toast", message });
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    const timer = setTimeout(() => dispatch({ type: "toast", message: null }), TOAST_MS);
    return () => clearTimeout(timer);
  }, [state.toast]);

  // ---- what React Flow reports ----

  const onNodesChange = useCallback(
    (changes: NodeChange<StepNode>[]) => {
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const change of changes) if (change.type === "dimensions" && change.dimensions) sizes[change.id] = change.dimensions;
      if (Object.keys(sizes).length > 0) setMeasured((current) => ({ ...current, ...sizes }));

      const result = graphFromNodeChanges(graph, changes);
      if (result.graph !== graph) apply({ graph: result.graph, touched: result.touched });
      if (result.selected !== undefined) dispatch({ type: "select", selection: result.selected === null ? { kind: "none" } : { kind: "node", id: result.selected } });
    },
    [graph, apply],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<WireEdgeType>[]) => {
      const result = graphFromEdgeChanges(graph, changes);
      if (result.graph !== graph) apply({ graph: result.graph, touched: result.touched });
      if (result.selected !== undefined) dispatch({ type: "select", selection: result.selected === null ? { kind: "none" } : { kind: "edge", edge: result.selected } });
    },
    [graph, apply],
  );

  const isValidConnection = useCallback(
    (candidate: Edge | Connection) => {
      const edge = connectionToEdge(candidate);
      return edge !== null && wiringProblem(graph.nodes, graph.edges, edge) === null;
    },
    [graph],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const edge = connectionToEdge(connection);
      if (!edge) return;
      const added = addEdge(graph, edge);
      if (added.ok) apply(added);
      else say(added.reason);
    },
    [graph, apply, say],
  );

  // A wire let go over a handle that does not accept it is refused with the reason, near the pointer.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connection: FinalConnectionState) => {
      if (connection.isValid !== false || !connection.fromHandle || !connection.toHandle || !connection.fromNode || !connection.toNode) return;
      const start = { node: connection.fromNode.id, port: connection.fromHandle.id ?? "" };
      const end = { node: connection.toNode.id, port: connection.toHandle.id ?? "" };
      const attempted: GraphEdge = connection.fromHandle.type === "source" ? { from: start, to: end } : { from: end, to: start };
      const problem = wiringProblem(graph.nodes, graph.edges, attempted);
      if (!problem) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      say(problem, { x: point.clientX, y: point.clientY });
    },
    [graph, say],
  );

  // ---- adding steps ----

  const openMenu = useCallback((from?: PortRef, anchor?: { x: number; y: number }) => setMenu({ from, anchor }), []);

  const pickChoice = useCallback(
    (choice: Choice) => {
      const source = menu?.from ? graph.nodes.find((n) => n.id === menu.from!.node) : undefined;
      const near = source
        ? { x: source.position.x + 300, y: source.position.y }
        : screenToFlowPosition({ x: window.innerWidth * 0.4, y: window.innerHeight * 0.45 });
      const added = addNode(graph, choice.type, near);
      if (!added.ok) {
        say(added.reason);
        return setMenu(null);
      }
      let next = added.graph;
      let touched = added.touched;
      if (menu?.from && choice.wireInto) {
        const wired = addEdge(next, { from: menu.from, to: { node: added.id, port: choice.wireInto } });
        if (wired.ok) {
          next = wired.graph;
          touched = [...touched, ...wired.touched];
        } else {
          say(wired.reason);
        }
      }
      apply({ graph: next, touched });
      dispatch({ type: "select", selection: { kind: "node", id: added.id } });
      setMenu(null);
    },
    [menu, graph, apply, say, screenToFlowPosition],
  );

  const actions = useMemo<EditorActions>(
    () => ({
      onAddFrom(nodeId, port) {
        const node = graph.nodes.find((n) => n.id === nodeId);
        const anchor = node ? flowToScreenPosition({ x: node.position.x + 260, y: node.position.y }) : undefined;
        openMenu({ node: nodeId, port }, anchor);
      },
      onRemoveNode: (nodeId) => apply(removeNode(graph, nodeId)),
      onRemoveEdge: (edge) => apply(removeEdge(graph, edge)),
      onOpenGame() {
        // The game view is added with Play (Task 15).
      },
    }),
    [graph, apply, openMenu, flowToScreenPosition],
  );

  const selectedId = state.selection.kind === "node" ? state.selection.id : null;
  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedData = selectedId ? nodes.find((n) => n.id === selectedId)?.data ?? null : null;

  return (
    <EditorActionsContext.Provider value={actions}>
      <div className={cx(styles.editor, styles.shell)} data-theme={theme}>
        <Toolbar
          name={name}
          save={{ status: "idle" }}
          theme={theme}
          canPlay={false}
          playing={state.playing}
          onPlay={() => {}}
          onAddStep={() => openMenu()}
          onTheme={setTheme}
          onRetry={() => {}}
        />

        {state.hintOpen && graph.nodes.length > 0 && (
          <p className={styles.hintBar}>1. Choose a picture on the first step. 2. Press Play.</p>
        )}

        <div className={styles.main}>
          <div className={styles.canvasArea}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              deleteKeyCode={["Delete", "Backspace"]}
              colorMode={theme}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.3}
              maxZoom={1.5}
            >
              <Background gap={18} size={1.2} />
              <Controls showInteractive={false} />
            </ReactFlow>

            {graph.nodes.length === 0 && (
              <div className={styles.emptyStart}>
                <p>This graph has no steps yet.</p>
                <button type="button" className={styles.play} onClick={() => apply({ graph: starterGraph(), touched: [] })}>
                  Start from the starter
                </button>
              </div>
            )}
          </div>

          <aside className={styles.side} aria-label="Settings">
            <SettingsPanel
              node={selectedNode}
              data={selectedData}
              assets={state.assets}
              graphId={id}
              uploading={false}
              error={null}
              onChooseFile={() => {
                // Uploading is added with saving (Task 15).
              }}
              onTune={(nodeId, tuning) => apply(editTuning(graph, nodeId, tuning))}
            />
          </aside>
        </div>

        {menu && <AddMenu choices={addChoices(graph, menu.from)} anchor={menu.anchor} onPick={pickChoice} onClose={() => setMenu(null)} />}

        {state.toast && (
          <p role="alert" className={styles.toast} style={toastAt ? { left: toastAt.x + 12, top: toastAt.y + 12, bottom: "auto", transform: "none" } : undefined}>
            {state.toast}
          </p>
        )}
      </div>
    </EditorActionsContext.Provider>
  );
}

