// What one card shows, worked out from the graph, the run and the uploaded files: its status in words, its result, and
// its ports. The card component only draws this, so every wording and every rule here is tested without a browser.
import type { RunView } from "@/lib/canvas/runView";
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { Assets, Graph, GraphNode, WireType } from "@/lib/graph/types";

export type StepStatus = "idle" | "running" | "done" | "skipped" | "failed" | "not-used" | "attention";

export interface PortView {
  name: string;
  label: string;
  type: WireType;
  required: boolean;
  wired: boolean;
}

export type ResultView =
  | { kind: "none" }
  | { kind: "image"; name: string; thumbUrl: string }
  | { kind: "model"; name: string; size: string }
  | { kind: "palette"; colors: string[] }
  | { kind: "text"; text: string }
  | { kind: "open-game" };

export interface StepData {
  id: string;
  type: string;
  label: string;
  help: string;
  /** Where this step comes in the running order, or null when it does not lead to the Preview. */
  number: number | null;
  status: StepStatus;
  statusText: string;
  result: ResultView;
  inputs: PortView[];
  outputs: PortView[];
}

export interface StepDataArgs {
  graph: Graph;
  node: GraphNode;
  assets: Assets;
  run: RunView;
  numbers: Map<string, number>;
  graphId: string;
  /** Steps whose result has not been revealed yet after Play (they still show a spinner). */
  pending: ReadonlySet<string>;
  specs?: Record<string, NodeSpec>;
}

const FILE_KIND: Record<string, "image" | "model"> = { "reference-image": "image", model: "model" };

/** "512 B", "1.5 KB", "1.2 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "Reference Image: choose a picture." -> "Choose a picture." The card already says which step it is.
function plainProblem(message: string, label: string): string {
  const text = message.startsWith(`${label}: `) ? message.slice(label.length + 2) : message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function chosenFile(node: GraphNode, assets: Assets, graphId: string): ResultView {
  const sha = node.params.asset;
  const wanted = FILE_KIND[node.type];
  if (typeof sha !== "string" || !Object.hasOwn(assets, sha) || assets[sha].kind !== wanted) return { kind: "none" };
  const info = assets[sha];
  if (wanted === "image") return { kind: "image", name: info.name, thumbUrl: `/api/graphs/${encodeURIComponent(graphId)}/assets/${sha}` };
  return { kind: "model", name: info.name, size: formatSize(info.size) };
}

function fromRun(node: GraphNode, run: RunView): ResultView {
  const outcome = run.outcomes[node.id];
  if (outcome?.state !== "done") return { kind: "none" };
  if (node.type === "palette-from-image" && Array.isArray(outcome.result)) return { kind: "palette", colors: outcome.result as string[] };
  if (node.type === "game-template") {
    const tuning = (outcome.result as { tuning?: { speed: number; jumpHeight: number; obstacleSpacing: number } } | undefined)?.tuning;
    if (tuning) return { kind: "text", text: `speed ${tuning.speed} · jump ${tuning.jumpHeight} · spacing ${tuning.obstacleSpacing}` };
  }
  if (node.type === "preview" && run.runId) return { kind: "open-game" };
  return { kind: "none" };
}

export function stepData({ graph, node, assets, run, numbers, graphId, pending, specs = NODE_SPECS }: StepDataArgs): StepData {
  const spec = specs[node.type];
  const number = numbers.get(node.id) ?? null;

  let status: StepStatus = "idle";
  let statusText = "";
  const problem = run.problems.find((p) => p.node === node.id);
  const outcome = run.outcomes[node.id];
  if (number === null) {
    [status, statusText] = ["not-used", "Not connected to a Preview"];
  } else if (problem) {
    [status, statusText] = ["attention", plainProblem(problem.message, spec.label)];
  } else if (pending.has(node.id)) {
    [status, statusText] = ["running", "Running…"];
  } else if (outcome?.state === "done") {
    [status, statusText] = ["done", "Done"];
  } else if (outcome?.state === "failed") {
    [status, statusText] = ["failed", outcome.error ?? "Failed"];
  } else if (outcome?.state === "skipped") {
    [status, statusText] = ["skipped", outcome.because ?? "Skipped"];
  }

  const isFileStep = Object.hasOwn(FILE_KIND, node.type);
  const result = isFileStep ? chosenFile(node, assets, graphId) : pending.has(node.id) ? { kind: "none" as const } : fromRun(node, run);

  return {
    id: node.id,
    type: node.type,
    label: spec.label,
    help: spec.help,
    number,
    status,
    statusText,
    result,
    inputs: spec.inputs.map((p) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      required: p.required,
      wired: graph.edges.some((e) => e.to.node === node.id && e.to.port === p.name),
    })),
    outputs: spec.outputs.map((p) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      required: p.required,
      wired: graph.edges.some((e) => e.from.node === node.id && e.from.port === p.name),
    })),
  };
}
