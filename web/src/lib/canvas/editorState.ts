// The editor's state and the one reducer that changes it. Everything that happens on the canvas becomes an action here,
// so the rules (what an edit makes stale, what a selection survives, when the hint closes) are tested without a browser.
import { type PlayResponse, type RunView, applyPlay, emptyRunView, markStale } from "@/lib/canvas/runView";
import type { Assets, Graph, GraphEdge } from "@/lib/graph/types";

export type Selection = { kind: "none" } | { kind: "node"; id: string } | { kind: "edge"; edge: GraphEdge };

export interface EditorState {
  graph: Graph;
  assets: Assets;
  run: RunView;
  selection: Selection;
  playing: boolean;
  /** The "choose a picture, then press Play" hint, shown until the first successful run. */
  hintOpen: boolean;
  toast: string | null;
}

export type EditorAction =
  | { type: "edited"; graph: Graph; touched: string[] }
  | { type: "assets"; assets: Assets }
  | { type: "select"; selection: Selection }
  | { type: "play-started" }
  | { type: "play-finished"; response: PlayResponse }
  | { type: "play-failed" }
  | { type: "toast"; message: string | null };

export function initialEditorState(record: { graph: Graph; assets: Assets; lastRunId: string | null }): EditorState {
  return {
    graph: record.graph,
    assets: record.assets,
    run: emptyRunView(record.lastRunId),
    selection: { kind: "none" },
    playing: false,
    hintOpen: record.lastRunId === null,
    toast: null,
  };
}

const sameWire = (a: GraphEdge, b: GraphEdge) =>
  a.from.node === b.from.node && a.from.port === b.from.port && a.to.node === b.to.node && a.to.port === b.to.port;

function survivingSelection(selection: Selection, graph: Graph): Selection {
  if (selection.kind === "node") return graph.nodes.some((n) => n.id === selection.id) ? selection : { kind: "none" };
  if (selection.kind === "edge") return graph.edges.some((e) => sameWire(e, selection.edge)) ? selection : { kind: "none" };
  return selection;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "edited": {
      let run = markStale(state.run, action.graph, action.touched);
      // A step or wire added or removed may fix a problem that belongs to the graph as a whole (no Preview, two Previews).
      const structural = action.graph.nodes.length !== state.graph.nodes.length || action.graph.edges.length !== state.graph.edges.length;
      if (structural && run.problems.some((p) => p.node === null)) run = { ...run, problems: run.problems.filter((p) => p.node !== null) };
      return { ...state, graph: action.graph, run, selection: survivingSelection(state.selection, action.graph) };
    }
    case "assets":
      return { ...state, assets: action.assets };
    case "select":
      return { ...state, selection: action.selection };
    case "play-started":
      return { ...state, playing: true, toast: null };
    case "play-finished":
      return {
        ...state,
        playing: false,
        run: applyPlay(state.run, state.graph, action.response),
        hintOpen: state.hintOpen && !(action.response.kind === "ran" && action.response.state === "done"),
      };
    case "play-failed":
      return { ...state, playing: false };
    case "toast":
      return { ...state, toast: action.message };
  }
}
