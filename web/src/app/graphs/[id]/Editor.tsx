"use client";

// The node canvas. It holds one reducer (the graph, the run view, the selection) and hands React Flow a picture of it;
// everything React Flow reports (a drag, a delete, a wire) goes back through the pure units in lib/graph and lib/canvas,
// so the rules are tested without a browser and this file only connects them: saving, uploading, Play, the game view.
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { AddMenu } from "@/app/graphs/[id]/AddMenu";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { GameFrame, GamePanel } from "@/app/graphs/[id]/GamePanel";
import { usePrefs } from "@/app/graphs/[id]/prefsStore";
import { SettingsPanel } from "@/app/graphs/[id]/SettingsPanel";
import { SideTabs } from "@/app/graphs/[id]/SideTabs";
import { type EditorActions, EditorActionsContext, StepCard, type StepNode } from "@/app/graphs/[id]/StepCard";
import { Toast } from "@/app/graphs/[id]/Toast";
import { Toolbar } from "@/app/graphs/[id]/Toolbar";
import { WireEdge, type WireEdgeType } from "@/app/graphs/[id]/WireEdge";
import { type Choice, addChoices } from "@/lib/canvas/addMenu";
import { type Autosave, type SaveState, createAutosave } from "@/lib/canvas/autosave";
import { SESSION_EXPIRED, playGraph, saveGraph, uploadFile } from "@/lib/canvas/client";
import { editorReducer, initialEditorState } from "@/lib/canvas/editorState";
import { candidateEdge, connectionToEdge, graphFromEdgeChanges, graphFromNodeChanges, pruneSizes, toFlow } from "@/lib/canvas/flow";
import { fileProblem } from "@/lib/canvas/files";
import { type GameView, clampRect, viewToReturnTo } from "@/lib/canvas/prefs";
import { isOutOfDate, revealSchedule } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import { type Edit, addEdge, addNode, editAsset, editPrompt, editTuning, removeEdge, removeNode } from "@/lib/graph/edits";
import { starterGraph } from "@/lib/graph/starter";
import type { Assets, Graph, PortRef } from "@/lib/graph/types";
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
const AUTOSAVE_MS = 800;
const REVEAL_MS = 150;
const TOAST_MS = 4000;

// ---- things the browser tells us about ----

const subscribeCoarse = (onChange: () => void) => {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const subscribeResize = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function Editor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ id, name, initialGraph, initialAssets, initialRunId }: EditorProps) {
  const [state, dispatch] = useReducer(editorReducer, { graph: initialGraph, assets: initialAssets, lastRunId: initialRunId }, initialEditorState);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  const [prefs, changePrefs] = usePrefs();
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [menu, setMenu] = useState<{ from?: PortRef; anchor?: { x: number; y: number } } | null>(null);
  const [toastAt, setToastAt] = useState<{ x: number; y: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<{ nodeId: string; message: string } | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(NO_PENDING);
  const [sideTab, setSideTab] = useState<"settings" | "game">("settings");
  const [sideOpen, setSideOpen] = useState(true);
  // Where "Back to canvas" goes from full screen: the view the game was in before it went full screen.
  const [returnTo, setReturnTo] = useState<Exclude<GameView, "full">>("docked");
  // In a controlled flow React Flow hides a node until it is told the node's measured size, so the sizes it reports are
  // kept here and handed back with the nodes.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  const coarsePointer = useSyncExternalStore<boolean | null>(subscribeCoarse, () => window.matchMedia("(pointer: coarse)").matches, () => null);
  const viewportWidth = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1280);
  const viewportHeight = useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 800);

  const autosave = useRef<Autosave | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { flowToScreenPosition, screenToFlowPosition, fitView } = useReactFlow();

  const { graph } = state;
  const numbers = useMemo(() => stepNumbers(graph), [graph]);
  const flow = useMemo(
    () => toFlow({ graph, assets: state.assets, run: state.run, numbers, graphId: id, pending, selection: state.selection }),
    [graph, state.assets, state.run, numbers, id, pending, state.selection],
  );
  const nodes = useMemo(() => flow.nodes.map((n) => (measured[n.id] ? { ...n, measured: measured[n.id] } : n)) as StepNode[], [flow.nodes, measured]);
  const edges = flow.edges as WireEdgeType[];

  const apply = useCallback((edit: Edit) => {
    dispatch({ type: "edited", graph: edit.graph, touched: edit.touched });
    // An upload error belongs to a step; if the step is gone, so is the error (a new step may reuse the id).
    setUploadError((current) => (current && edit.graph.nodes.some((n) => n.id === current.nodeId) ? current : null));
  }, []);
  const say = useCallback((message: string, at: { x: number; y: number } | null = null) => {
    setToastAt(at);
    dispatch({ type: "toast", message });
  }, []);

  // ---- saving ----

  useEffect(() => {
    const created = createAutosave({ save: (g) => saveGraph(id, g), delayMs: AUTOSAVE_MS });
    autosave.current = created;
    const stop = created.subscribe(setSave);
    return () => {
      stop();
      created.dispose({ flush: true }); // leaving the page (even by Back) must not lose an edit made a moment ago
      autosave.current = null;
    };
  }, [id]);

  const firstGraph = useRef(initialGraph);
  useEffect(() => {
    if (graph !== firstGraph.current) autosave.current?.edit(graph);
  }, [graph]);

  useEffect(() => {
    // Unsaved changes: waiting to save, saving, or a save that failed (the changes are still only on this page).
    if (save.status !== "dirty" && save.status !== "saving" && save.status !== "error") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.status]);

  useEffect(() => {
    if (!state.toast) return;
    const timer = setTimeout(() => dispatch({ type: "toast", message: null }), TOAST_MS);
    return () => clearTimeout(timer);
  }, [state.toast, state.toastSeq]); // the same message shown again starts its time again

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  // ---- what React Flow reports ----

  const onNodesChange = useCallback(
    (changes: NodeChange<StepNode>[]) => {
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const change of changes) if (change.type === "dimensions" && change.dimensions) sizes[change.id] = change.dimensions;
      if (Object.keys(sizes).length > 0) setMeasured((current) => pruneSizes({ ...current, ...sizes }, graph.nodes));

      const result = graphFromNodeChanges(graph, changes);
      if (result.graph !== graph) apply({ graph: result.graph, touched: result.touched });
      if (result.selected !== undefined) {
        dispatch({ type: "select", selection: { kind: "node", id: result.selected } });
        setSideTab("settings");
      } else if (result.deselected) {
        dispatch({ type: "deselect", kind: "node" }); // clears a step selection only; a wire just selected stays
      }
    },
    [graph, apply],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<WireEdgeType>[]) => {
      const result = graphFromEdgeChanges(graph, changes);
      if (result.graph !== graph) apply({ graph: result.graph, touched: result.touched });
      if (result.selected !== undefined) dispatch({ type: "select", selection: { kind: "edge", edge: result.selected } });
      else if (result.deselected) dispatch({ type: "deselect", kind: "edge" });
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
      const attempted = candidateEdge(
        { node: connection.fromNode.id, port: connection.fromHandle.id ?? "", type: connection.fromHandle.type },
        { node: connection.toNode.id, port: connection.toHandle.id ?? "", type: connection.toHandle.type },
      );
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
      setSideTab("settings");
      setMenu(null);
    },
    [menu, graph, apply, say, screenToFlowPosition],
  );

  // ---- files ----

  const chooseFile = useCallback(
    async (nodeId: string, file: File) => {
      setUploadError(null);
      setUploading(true);
      const result = await uploadFile(id, file);
      setUploading(false);
      if (!result.ok) {
        if (result.expired) setExpired(true);
        return setUploadError({ nodeId, message: result.message });
      }
      const current = latest.current;
      const step = current.graph.nodes.find((n) => n.id === nodeId);
      const wrongKind = step ? fileProblem(step.type, result.info.kind) : "That step is no longer in the graph.";
      if (wrongKind) return setUploadError({ nodeId, message: wrongKind }); // never put a file a step cannot use into the graph
      dispatch({ type: "assets", assets: { ...current.assets, [result.sha256]: result.info } });
      // Worked out from the graph as it is when the reducer handles it, not from `current`, which may be a render behind: a
      // step moved a moment ago must stay where it was moved.
      dispatch({ type: "edit", make: (graph) => (graph.nodes.some((n) => n.id === nodeId) ? editAsset(graph, nodeId, result.sha256) : { graph, touched: [] }) });
    },
    [id],
  );

  // ---- the game view ----

  const showGame = useCallback(() => {
    setSideTab("game");
    setSideOpen(true);
  }, []);

  const chooseGameView = useCallback(
    (gameView: GameView) => {
      setReturnTo((before) => viewToReturnTo(before, prefs.gameView, gameView));
      changePrefs({ gameView });
      if (gameView === "docked") showGame();
    },
    [prefs.gameView, changePrefs, showGame],
  );

  // ---- Play ----

  const play = useCallback(async () => {
    if (latest.current.playing) return;
    // Results still waiting to be revealed from the last Play must not reveal steps of this one early.
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    dispatch({ type: "play-started" });

    // What is played is what is saved: wait for the save, and stop if it failed.
    const saved = (await autosave.current?.flush()) ?? true;
    if (!saved) {
      dispatch({ type: "play-failed" });
      return say("The graph could not be saved, so it was not played. Fix the save problem first.");
    }

    setPending(new Set(stepNumbers(latest.current.graph).keys()));
    const outcome = await playGraph(id);
    if (outcome.kind === "expired" || outcome.kind === "failed") {
      setPending(NO_PENDING);
      dispatch({ type: "play-failed" });
      if (outcome.kind === "expired") setExpired(true);
      else say(outcome.message);
      return;
    }

    dispatch({ type: "play-finished", response: outcome });
    if (outcome.kind === "invalid") return setPending(NO_PENDING);

    // One step's result at a time, in the order they ran, so the order can be seen.
    setPending(new Set(outcome.order));
    for (const { node, atMs } of revealSchedule(outcome.order, REVEAL_MS, prefersReducedMotion())) {
      timers.current.push(
        setTimeout(() => {
          setPending((current) => {
            if (!current.has(node)) return current;
            const next = new Set(current);
            next.delete(node);
            return next;
          });
        }, atMs),
      );
    }
    if (outcome.state === "done") showGame();
  }, [id, say, showGame]);

  // ---- problems after a Play ----

  const failedIds = state.run.order.filter((nodeId) => state.run.outcomes[nodeId]?.state === "failed");
  const problemCount = state.run.problems.length + failedIds.length;
  const firstProblem = state.run.problems[0];
  const firstProblemStep = state.run.problems.find((p) => p.node !== null)?.node ?? failedIds[0] ?? null;

  const showProblem = useCallback(
    (nodeId: string) => {
      dispatch({ type: "select", selection: { kind: "node", id: nodeId } });
      setSideTab("settings");
      void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1, padding: 1 });
    },
    [fitView],
  );

  // ---- what the cards can ask for ----

  const actions = useMemo<EditorActions>(
    () => ({
      onAddFrom(nodeId, port) {
        const node = graph.nodes.find((n) => n.id === nodeId);
        const anchor = node ? flowToScreenPosition({ x: node.position.x + 260, y: node.position.y }) : undefined;
        openMenu({ node: nodeId, port }, anchor);
      },
      onRemoveNode: (nodeId) => apply(removeNode(graph, nodeId)),
      onRemoveEdge: (edge) => apply(removeEdge(graph, edge)),
      onOpenGame: showGame,
      canConnect: (edge) => wiringProblem(graph.nodes, graph.edges, edge) === null,
    }),
    [graph, apply, openMenu, flowToScreenPosition, showGame],
  );

  // ---- drawing it ----

  const selectedId = state.selection.kind === "node" ? state.selection.id : null;
  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedData = selectedId ? nodes.find((n) => n.id === selectedId)?.data ?? null : null;
  const sessionExpired = expired || (save.status === "error" && save.message === SESSION_EXPIRED);
  const docked = prefs.gameView === "docked";
  const viewport = { width: viewportWidth, height: viewportHeight };
  const frame = <GameFrame runId={state.run.runId} outOfDate={isOutOfDate(state.run, graph)} coarsePointer={coarsePointer} />;

  return (
    <EditorActionsContext.Provider value={actions}>
      <div className={cx(styles.editor, styles.shell)} data-theme={prefs.theme}>
        <Toolbar
          name={name}
          save={save}
          theme={prefs.theme}
          canPlay={graph.nodes.length > 0}
          playing={state.playing}
          onPlay={play}
          onAddStep={() => openMenu()}
          onTheme={(theme) => changePrefs({ theme })}
          onRetry={() => autosave.current?.retry()}
        />

        {sessionExpired && (
          <p className={styles.banner} role="alert">
            {SESSION_EXPIRED} Changes that are not saved will be lost. <a href="/sign-in">Sign in</a>
          </p>
        )}

        {!state.playing && problemCount > 0 && (
          <p className={styles.banner} role="status">
            {problemCount} {problemCount === 1 ? "problem" : "problems"}
            {firstProblem && firstProblem.node === null ? `: ${firstProblem.message}` : ""}
            {firstProblemStep && (
              <>
                {" "}
                <button type="button" className={styles.linkButton} onClick={() => showProblem(firstProblemStep)}>
                  Show the first
                </button>
              </>
            )}
          </p>
        )}

        {state.hintOpen && graph.nodes.length > 0 && <p className={styles.hintBar}>1. Choose a picture on the first step. 2. Press Play.</p>}

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
              deleteKeyCode={menu ? null : ["Delete", "Backspace"]} // not while the Add menu is open: the key is for the menu, not the selected step
              connectOnClick={false} // a wire is dragged: a stray click on a handle would start one that skips the refusal message
              colorMode={prefs.theme}
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

            {!sideOpen && (
              <button type="button" className={cx(styles.secondary, styles.showPanel)} onClick={() => setSideOpen(true)}>
                Show panel
              </button>
            )}
          </div>

          {sideOpen && (
            <aside className={styles.side} aria-label="Side panel">
              <SideTabs docked={docked} tab={sideTab} onTab={setSideTab} onHide={() => setSideOpen(false)} />
              {docked && sideTab === "game" ? (
                <GamePanel
                  mode="docked"
                  rect={prefs.floating}
                  viewport={viewport}
                  frame={frame}
                  onMode={chooseGameView}
                  onRect={(floating, final) => changePrefs({ floating }, { persist: final })}
                />
              ) : (
                <SettingsPanel
                  node={selectedNode}
                  data={selectedData}
                  assets={state.assets}
                  graphId={id}
                  uploading={uploading}
                  error={uploadError && uploadError.nodeId === selectedId ? uploadError.message : null}
                  onChooseFile={chooseFile}
                  onTune={(nodeId, tuning) => apply(editTuning(graph, nodeId, tuning))}
                  onPrompt={(nodeId, prompt) => apply(editPrompt(graph, nodeId, prompt))}
                />
              )}
            </aside>
          )}
        </div>

        {!docked && (
          <GamePanel
            mode={prefs.gameView}
            rect={clampRect(prefs.floating, viewport)}
            viewport={viewport}
            frame={frame}
            onMode={chooseGameView}
            onRect={(floating, final) => changePrefs({ floating }, { persist: final })}
            backTo={returnTo}
          />
        )}

        {menu && <AddMenu choices={addChoices(graph, menu.from)} anchor={menu.anchor} onPick={pickChoice} onClose={() => setMenu(null)} />}

        {state.toast && <Toast message={state.toast} at={toastAt} seq={state.toastSeq} />}
      </div>
    </EditorActionsContext.Provider>
  );
}
