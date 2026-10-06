// What one card shows, worked out from the graph, the run and the uploaded files: its status in words, its result, and
// its ports. The card component only draws this, so every wording and every rule here is tested without a browser.
import { SHAPE_NAMES, type Shape } from "@/lib/blender/types";
import { CLIP_NAMES, KIND_NAMES, type ModelKind, SCENERY_NAMES, type SceneryKind } from "@/lib/builder/kinds";
import type { RunView } from "@/lib/canvas/runView";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { Assets, Graph, GraphNode, Tuning, WireType } from "@/lib/graph/types";

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
  /** What Describe Game answered: five colors, the three numbers as a line, a one-line summary, and whether it was a stored answer. */
  | { kind: "described"; colors: string[]; numbers: string; summary: string; reused: boolean }
  /** What a Blender step made: a line of plain facts, the color it was painted (a #rrggbb string) or null, and whether it was a stored result. */
  | { kind: "made"; line: string; swatch: string | null; reused: boolean }
  /** What Build Model made: a line of plain facts, the clips it moves with, a one-sentence look (plain text), what was skipped (or null) and whether it was a stored result. */
  | { kind: "built"; line: string; clips: string; summary: string; skipped: string | null; reused: boolean }
  /** What Build Environment made: the sky, field and stripe colors (#rrggbb), the scenery by its plain names (or "No scenery"), and whether it was a stored result. */
  | { kind: "environment"; colors: string[]; scenery: string; reused: boolean }
  | { kind: "open-game" };

export type StepData = {
  id: string;
  type: string;
  label: string;
  help: string;
  /** Where this step comes in the running order, or null when it does not lead to the Preview. */
  number: number | null;
  status: StepStatus;
  statusText: string;
  result: ResultView;
  /** A Game Template whose three numbers are set by a feel wired into it, so its sliders are locked. */
  tuningLocked: boolean;
  /** The numbers a Game Template's last run used (what a locked slider shows), or null before a run or after a failure. */
  liveTuning: Tuning | null;
  /** The five colors a Prepare Model or Make Shape panel offers: the wired palette's once it has been made, otherwise the sample palette. */
  swatches?: string[];
  inputs: PortView[];
  outputs: PortView[];
};

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

/** "speed 6 · jump 2.2 · spacing 12": the three numbers on one line. */
const tuningLine = (tuning: Tuning) => `speed ${tuning.speed} · jump ${tuning.jumpHeight} · spacing ${tuning.obstacleSpacing}`;

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// What a finished Describe Game step handed over (lib/graph/nodes/describeGame.ts), or null when the result is not that.
function described(result: unknown): ResultView | null {
  const r = result as { palette?: unknown; tuning?: Partial<Record<keyof Tuning, unknown>>; summary?: unknown; reused?: unknown } | null | undefined;
  if (typeof r !== "object" || r === null) return null;
  const { palette, tuning, summary, reused } = r;
  if (!Array.isArray(palette) || !palette.every((c) => typeof c === "string")) return null;
  if (typeof tuning !== "object" || tuning === null || !isNumber(tuning.speed) || !isNumber(tuning.jumpHeight) || !isNumber(tuning.obstacleSpacing)) return null;
  if (typeof summary !== "string" || typeof reused !== "boolean") return null;
  return { kind: "described", colors: palette as string[], numbers: tuningLine(tuning as Tuning), summary, reused };
}

const HEX = /^#[0-9a-f]{6}$/i;
const count = (n: number) => n.toLocaleString("en-US");

// What a finished Prepare Model step handed over (lib/graph/nodes/prepareModel.ts), or null when the result is not that.
function prepared(result: unknown): ResultView | null {
  const r = result as { trianglesBefore?: unknown; trianglesAfter?: unknown; size?: unknown; color?: unknown; reused?: unknown } | null | undefined;
  if (typeof r !== "object" || r === null) return null;
  const { trianglesBefore, trianglesAfter, size, color, reused } = r;
  if (!isNumber(trianglesAfter) || !isNumber(size) || typeof reused !== "boolean") return null;
  if (trianglesBefore !== null && !isNumber(trianglesBefore)) return null;
  if (color !== null && !(typeof color === "string" && HEX.test(color))) return null;
  const triangles = trianglesBefore !== null && trianglesBefore !== trianglesAfter ? `${count(trianglesBefore)} triangles to ${count(trianglesAfter)}` : `${count(trianglesAfter)} triangles`;
  return { kind: "made", line: `${triangles}, ${formatSize(size)}, ${color === null ? "original colors" : `flat ${color}`}`, swatch: color, reused };
}

// What a finished Make Shape step handed over (lib/graph/nodes/makeShape.ts), or null when the result is not that.
function shapeMade(result: unknown): ResultView | null {
  const r = result as { shape?: unknown; color?: unknown; trianglesAfter?: unknown; size?: unknown; reused?: unknown } | null | undefined;
  if (typeof r !== "object" || r === null) return null;
  const { shape, color, trianglesAfter, size, reused } = r;
  if (typeof shape !== "string" || !Object.hasOwn(SHAPE_NAMES, shape)) return null;
  if (typeof color !== "string" || !HEX.test(color) || !isNumber(trianglesAfter) || !isNumber(size) || typeof reused !== "boolean") return null;
  return { kind: "made", line: `${SHAPE_NAMES[shape as Shape]}, ${count(trianglesAfter)} triangles, ${formatSize(size)}`, swatch: color, reused };
}

const CLIP_WORDS: readonly string[] = Object.values(CLIP_NAMES);
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;

// What a finished Build Model step handed over (lib/graph/nodes/buildModel.ts), or null when the result is not that. Nothing in it is
// trusted: the kind and the clips must be ones we have, and the summary is kept as text for the card to draw as text.
function builtModel(result: unknown): ResultView | null {
  const r = result as { kind?: unknown; parts?: unknown; triangles?: unknown; size?: unknown; clips?: unknown; summary?: unknown; skipped?: unknown; reused?: unknown } | null | undefined;
  if (typeof r !== "object" || r === null) return null;
  const { kind, parts, triangles, size, clips, summary, skipped, reused } = r;
  if (typeof kind !== "string" || !Object.hasOwn(KIND_NAMES, kind)) return null;
  if (!isNumber(parts) || !isNumber(triangles) || !isNumber(size) || typeof summary !== "string" || typeof reused !== "boolean") return null;
  if (!Array.isArray(clips) || !clips.every((c) => typeof c === "string" && CLIP_WORDS.includes(c))) return null;
  if (!Array.isArray(skipped) || !skipped.every((s) => typeof s?.clip === "string" && typeof s?.joint === "string")) return null;
  const left = skipped as { clip: string; joint: string }[];
  return {
    kind: "built",
    line: `${KIND_NAMES[kind as ModelKind]}, ${plural(parts, "part")}, ${plural(triangles, "triangle")}, ${formatSize(size)}`,
    clips: clips.length === 0 ? "Still" : `Moves: ${clips.join(", ")}`,
    summary,
    skipped: left.length === 0 ? null : `Skipped, no such part: ${left.map((s) => `${s.joint} (${s.clip})`).join(", ")}`,
    reused,
  };
}

// What a finished Build Environment step handed over (lib/graph/nodes/buildEnvironment.ts), or null when the result is not that. Nothing in
// it is trusted: the three colors must be #rrggbb and every piece must be one of ours, so only known words and hex colors reach the card.
function builtEnvironment(result: unknown): ResultView | null {
  const r = result as { sky?: unknown; field?: unknown; stripe?: unknown; scenery?: unknown; reused?: unknown } | null | undefined;
  if (typeof r !== "object" || r === null) return null;
  const { sky, field, stripe, scenery, reused } = r;
  const colors = [sky, field, stripe];
  if (!colors.every((c): c is string => typeof c === "string" && HEX.test(c))) return null;
  if (!Array.isArray(scenery) || !scenery.every((piece) => typeof piece === "string" && Object.hasOwn(SCENERY_NAMES, piece))) return null;
  if (typeof reused !== "boolean") return null;
  const names = (scenery as SceneryKind[]).map((piece) => SCENERY_NAMES[piece]);
  return { kind: "environment", colors, scenery: names.length === 0 ? "No scenery" : names.join(", "), reused };
}

// The colors of the palette wired into a Blender step, once the step that makes them has run (a Palette from Image or a Describe
// Game step); the sample palette otherwise, and whenever what came back is not five #rrggbb colors.
function swatchesFor(graph: Graph, node: GraphNode, run: RunView): string[] {
  const edge = graph.edges.find((e) => e.to.node === node.id && e.to.port === "palette");
  const source = edge ? graph.nodes.find((n) => n.id === edge.from.node) : undefined;
  const outcome = source ? run.outcomes[source.id] : undefined;
  let colors: unknown;
  if (outcome?.state === "done") {
    if (source?.type === "palette-from-image") colors = outcome.result;
    else if (source?.type === "describe-game") colors = (outcome.result as { palette?: unknown } | null | undefined)?.palette;
  }
  return Array.isArray(colors) && colors.length === 5 && colors.every((c) => typeof c === "string" && HEX.test(c)) ? (colors as string[]) : [...SAMPLE_PALETTE];
}

function fromRun(node: GraphNode, run: RunView): ResultView {
  const outcome = run.outcomes[node.id];
  // A game made earlier is still there to open after a reload, before anything has run on this page (and when an edit
  // made the Preview's result stale: the game view then says it is out of date). A Preview that failed or was skipped in
  // the last run offers nothing.
  if (node.type === "preview" && outcome === undefined && run.runId) return { kind: "open-game" };
  if (outcome?.state !== "done") return { kind: "none" };
  if (node.type === "palette-from-image" && Array.isArray(outcome.result)) return { kind: "palette", colors: outcome.result as string[] };
  if (node.type === "game-template") {
    const tuning = (outcome.result as { tuning?: { speed: number; jumpHeight: number; obstacleSpacing: number } } | undefined)?.tuning;
    if (tuning) return { kind: "text", text: tuningLine(tuning) };
  }
  if (node.type === "describe-game") return described(outcome.result) ?? { kind: "none" };
  if (node.type === "prepare-model") return prepared(outcome.result) ?? { kind: "none" };
  if (node.type === "make-shape") return shapeMade(outcome.result) ?? { kind: "none" };
  if (node.type === "build-model") return builtModel(outcome.result) ?? { kind: "none" };
  if (node.type === "build-environment") return builtEnvironment(outcome.result) ?? { kind: "none" };
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

  const isTemplate = node.type === "game-template";
  const used = isTemplate && outcome?.state === "done" ? (outcome.result as { tuning?: Partial<Record<keyof Tuning, unknown>> } | undefined)?.tuning : undefined;
  const liveTuning =
    used && isNumber(used.speed) && isNumber(used.jumpHeight) && isNumber(used.obstacleSpacing)
      ? { speed: used.speed, jumpHeight: used.jumpHeight, obstacleSpacing: used.obstacleSpacing }
      : null;

  return {
    id: node.id,
    type: node.type,
    label: spec.label,
    help: spec.help,
    number,
    status,
    statusText,
    result,
    tuningLocked: isTemplate && graph.edges.some((e) => e.to.node === node.id && e.to.port === "feel"),
    liveTuning,
    ...(node.type === "prepare-model" || node.type === "make-shape" ? { swatches: swatchesFor(graph, node, run) } : {}),
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
