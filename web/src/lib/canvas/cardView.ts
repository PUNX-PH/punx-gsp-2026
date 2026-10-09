// What one card shows, worked out from the graph, the run and the uploaded files: its status in words, its result, and
// its ports. The card component only draws this, so every wording and every rule here is tested without a browser.
import { SHAPE_NAMES, type Shape } from "@/lib/blender/types";
import { CLIP_NAMES, KIND_NAMES, type ModelKind, SCENERY_NAMES, type SceneryKind, type WorldStyle } from "@/lib/builder/kinds";
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
  /**
   * What Build Model made: a line of plain facts, the clips it moves with, a one-sentence look (plain text), what was skipped (or null) and
   * whether it was a stored result. A High model also says "High quality" (and its line has the vertices); a Standard one has no `quality`.
   */
  | { kind: "built"; line: string; clips: string; summary: string; skipped: string | null; reused: boolean; quality?: string }
  /**
   * What Build Environment made: the sky, field and stripe colors (#rrggbb), the scenery by its plain names (or "No scenery"), and whether it
   * was a stored result. A High one also says "High quality" and what the scenery and the world came to together.
   */
  | { kind: "environment"; colors: string[]; scenery: string; reused: boolean; quality?: string; numbers?: string }
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

/** The names of the models that are plain shapes for now, from a result's `plainShapes` list. */
const plainShapeNames = (plain: unknown): string[] =>
  Array.isArray(plain) ? plain.flatMap((p) => (typeof p === "object" && p !== null && typeof (p as { entity?: unknown }).entity === "string" ? [(p as { entity: string }).entity] : [])) : [];

// What a finished Describe Game step handed over (lib/graph/nodes/describeGame.ts), or null when the result is not that.
function described(result: unknown): ResultView | null {
  // A script game (Make a game: Script): how long it is, what Claude left out and which models are plain shapes for now, in words.
  const s = result as { script?: unknown; lines?: unknown; leftOut?: unknown; reused?: unknown; plainShapes?: unknown } | null | undefined;
  if (typeof s === "object" && s !== null && s.script === true && isNumber(s.lines)) {
    const left = typeof s.leftOut === "string" && s.leftOut !== "" ? ` Left out: ${s.leftOut}` : "";
    const shapes = plainShapeNames(s.plainShapes);
    const drawn = shapes.length > 0 ? ` Drawn as plain shapes for now: ${shapes.join(", ")}. Press Play again to try building them.` : "";
    return { kind: "text", text: `A script game, ${s.lines} ${s.lines === 1 ? "line" : "lines"}.${left}${drawn}${s.reused === true ? " Reused your earlier result." : ""}` };
  }
  // A game of rules (Make a game: Rules): how much it has and what Claude left out, in words.
  const g = result as { game?: unknown; entities?: unknown; rules?: unknown; leftOut?: unknown; reused?: unknown } | null | undefined;
  if (typeof g === "object" && g !== null && g.game === true && isNumber(g.entities) && isNumber(g.rules)) {
    const left = typeof g.leftOut === "string" && g.leftOut !== "" ? ` Left out: ${g.leftOut}` : "";
    const shapes = plainShapeNames((g as { plainShapes?: unknown }).plainShapes);
    const drawn = shapes.length > 0 ? ` Drawn as plain shapes for now: ${shapes.join(", ")}. Press Play again to try building them.` : "";
    return { kind: "text", text: `A game with ${g.entities} things and ${g.rules} rules.${left}${drawn}${g.reused === true ? " Reused your earlier result." : ""}` };
  }
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
  // A soft step (made from a described game) that could not build: the game goes on with a plain shape, and the card says why.
  const soft = result as { notBuilt?: unknown } | null | undefined;
  if (typeof soft === "object" && soft !== null && typeof soft.notBuilt === "string") {
    return { kind: "text", text: `Not built: ${soft.notBuilt} The game uses a plain shape for it. Press Play again to try building it.` };
  }
  const r = result as { kind?: unknown; parts?: unknown; triangles?: unknown; size?: unknown; clips?: unknown; summary?: unknown; skipped?: unknown; reused?: unknown; quality?: unknown; vertices?: unknown; mobile?: unknown } | null | undefined;
  if (typeof r !== "object" || r === null) return null;
  const { kind, parts, triangles, size, clips, summary, skipped, reused, quality, vertices, mobile } = r;
  if (typeof kind !== "string" || !(Object.hasOwn(KIND_NAMES, kind) || kind === "freeform")) return null;
  // a freeform model has a variant for the phone; the card says its triangles
  const phone = kind === "freeform" && typeof mobile === "object" && mobile !== null && isNumber((mobile as { triangles?: unknown }).triangles) ? ((mobile as { triangles: number }).triangles) : null;
  if (!isNumber(parts) || !isNumber(triangles) || !isNumber(size) || typeof summary !== "string" || typeof reused !== "boolean") return null;
  if (!Array.isArray(clips) || !clips.every((c) => typeof c === "string" && CLIP_WORDS.includes(c))) return null;
  // a skipped entry is a clip and a joint, and the only reason it may give is the model's limit
  if (!Array.isArray(skipped) || !skipped.every((s) => typeof s?.clip === "string" && typeof s?.joint === "string" && (s.why === undefined || s.why === "budget"))) return null;
  // only "high" is a quality worth saying; anything else is not what the step hands over
  if (quality !== undefined && quality !== "standard" && quality !== "high") return null;
  const high = quality === "high";
  if (high && !isNumber(vertices)) return null;
  const left = skipped as { clip: string; joint: string; why?: "budget" }[];
  const list = (entries: typeof left) => entries.map((s) => `${s.joint} (${s.clip})`).join(", ");
  const sentences = [
    left.some((s) => s.why === undefined) ? `Skipped, no such part: ${list(left.filter((s) => s.why === undefined))}` : null,
    left.some((s) => s.why === "budget") ? `Skipped, over the model's limit: ${list(left.filter((s) => s.why === "budget"))}` : null,
  ].filter((sentence): sentence is string => sentence !== null);
  return {
    kind: "built",
    line: `${kind === "freeform" ? "Custom" : KIND_NAMES[kind as ModelKind]}, ${plural(parts, "part")}, ${plural(triangles, "triangle")}${phone === null ? "" : ` (${plural(phone, "triangle")} on a phone)`}, ${high ? `${count(vertices as number)} vertices, ` : ""}${formatSize(size)}`,
    clips: clips.length === 0 ? "Still" : `Moves: ${clips.join(", ")}`,
    summary,
    skipped: sentences.length === 0 ? null : sentences.join(". "),
    reused,
    ...(high ? { quality: "High quality" } : {}),
  };
}

// What a finished Build Environment step handed over (lib/graph/nodes/buildEnvironment.ts), or null when the result is not that. Nothing in
// it is trusted: the three colors must be #rrggbb and every piece must be one of ours, so only known words and hex colors reach the card.
const WORLD_NAMES: Record<WorldStyle, string> = { desert: "Desert", meadow: "Meadow" };

// What a finished Build World step handed over: the sky and ground colors, the pieces of scenery it made (named by what the AI wrote about each), and what
// they came to. Nothing in it is trusted: the colors must be #rrggbb and the names are drawn as text.
function builtWorld(result: unknown): ResultView | null {
  const soft = result as { notBuilt?: unknown } | null | undefined;
  if (typeof soft === "object" && soft !== null && typeof soft.notBuilt === "string") {
    return { kind: "text", text: `Not built: ${soft.notBuilt} The game uses a plain world. Press Play again to try building it.` };
  }
  const r = result as { sky?: unknown; field?: unknown; pieces?: unknown; triangles?: unknown; skipped?: unknown; reused?: unknown } | null | undefined;
  if (typeof r !== "object" || r === null) return null;
  const { sky, field, pieces, triangles, skipped, reused } = r;
  if (![sky, field].every((c): c is string => typeof c === "string" && HEX.test(c))) return null;
  if (!Array.isArray(pieces) || !pieces.every((p) => typeof p?.name === "string") || typeof reused !== "boolean") return null;
  const names = (pieces as { name: string }[]).map((p) => p.name);
  const left = isNumber(skipped) && skipped > 0 ? ` (${skipped} could not be built)` : "";
  return {
    kind: "environment",
    colors: [sky as string, field as string],
    scenery: names.length === 0 ? `No scenery${left}` : `${plural(names.length, "piece")} of scenery${left}`,
    reused,
    ...(isNumber(triangles) ? { numbers: plural(triangles, "triangle") } : {}),
  };
}

function builtEnvironment(result: unknown): ResultView | null {
  const soft = result as { notBuilt?: unknown } | null | undefined;
  if (typeof soft === "object" && soft !== null && typeof soft.notBuilt === "string") {
    return { kind: "text", text: `Not built: ${soft.notBuilt} The game uses a plain world. Press Play again to try building it.` };
  }
  const r = result as { sky?: unknown; field?: unknown; stripe?: unknown; scenery?: unknown; reused?: unknown; quality?: unknown; world?: unknown; triangles?: unknown; vertices?: unknown; size?: unknown } | null | undefined;
  if (typeof r !== "object" || r === null) return null;
  const { sky, field, stripe, scenery, reused, quality, world, triangles, vertices, size } = r;
  const colors = [sky, field, stripe];
  if (!colors.every((c): c is string => typeof c === "string" && HEX.test(c))) return null;
  if (!Array.isArray(scenery) || !scenery.every((piece) => typeof piece === "string" && Object.hasOwn(SCENERY_NAMES, piece))) return null;
  if (typeof reused !== "boolean") return null;
  if (quality !== undefined && quality !== "standard" && quality !== "high") return null;
  const names = (scenery as SceneryKind[]).map((piece) => SCENERY_NAMES[piece]);
  const base = { kind: "environment" as const, colors, scenery: names.length === 0 ? "No scenery" : names.join(", "), reused };
  if (quality !== "high") return base;
  // a High environment says what its world is and what everything in it came to; nothing is shown unless all of that is ours
  if (typeof world !== "string" || !Object.hasOwn(WORLD_NAMES, world) || !isNumber(triangles) || !isNumber(vertices) || !isNumber(size)) return null;
  return {
    ...base,
    quality: "High quality",
    numbers: `${WORLD_NAMES[world as WorldStyle]} world, ${plural(triangles, "triangle")}, ${count(vertices)} vertices, ${formatSize(size)}`,
  };
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
  if (node.type === "build-world") return builtWorld(outcome.result) ?? { kind: "none" };
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
