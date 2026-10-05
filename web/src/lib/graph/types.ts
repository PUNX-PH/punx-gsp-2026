// The shared vocabulary of the graph engine: what a graph is, what travels along its wires, and what a node's code is
// given. The runner's own result types live in runner.ts; the node catalog (labels, ports) is in registry.ts.
import type { DescribeGameService } from "@/lib/ai/types";
import type { User } from "@/lib/auth/ports";
import type { BlenderService, ModelFormat } from "@/lib/blender/types";
import type { BuilderService } from "@/lib/builder/types";
import type { ClipName } from "@/lib/builder/kinds";
import type { RunService } from "@/lib/runs/types";

/** What a wire carries. A `feel` is the three tuning numbers (how fast, how high, how far apart). */
export type WireType = "image" | "model" | "palette" | "feel" | "settings";

/** The three models a runner game uses, and the file each is stored under in a run. */
export type Role = "hero" | "obstacle" | "collectible";
export const ROLE_FILES: Record<Role, string> = { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb" };

export interface PortRef {
  node: string;
  port: string;
}

export interface GraphNode {
  id: string;
  type: string;
  params: Record<string, unknown>;
  position: { x: number; y: number }; // for the editor; the engine never reads it
}

export interface GraphEdge {
  from: PortRef;
  to: PortRef;
}

export interface Graph {
  schemaVersion: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Tuning {
  speed: number;
  jumpHeight: number;
  obstacleSpacing: number;
}

/** A file uploaded to a graph, kept in the graph's record under its SHA-256 (hex). */
export interface AssetInfo {
  name: string; // for people to read; never used in a path
  size: number;
  kind: "image" | "model";
  /** For a model: what kind of file it is. Missing means a GLB (the only kind before FBX and OBJ were accepted). */
  format?: ModelFormat;
  contentType: string;
  width?: number;
  height?: number;
  uploadedAt: number; // milliseconds since the epoch
}
export type Assets = Record<string, AssetInfo>;

export interface GraphRecord {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  graph: Graph;
  assets: Assets;
  lastRunId: string | null; // the run this graph's Preview last stored
}

/** A problem that stops a graph from running. `node` is null when it belongs to the graph as a whole. */
export interface Problem {
  node: string | null;
  message: string;
}

/** A failure with a status and a message that is safe to show the person. */
export class GraphError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

/** A node's failure, in a plain sentence for the person (anything else thrown is "Something went wrong on our side"). */
export class NodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeError";
  }
}

// ---- what travels along a wire ----

export type ModelSource = { kind: "asset"; sha256: string } | { kind: "builtin"; role: Role };

export type WireValue =
  | { type: "image"; sha256: string; name: string; width: number; height: number }
  // `role` and `clips` come only from Build Model (the role it was built for, and the clips it carries); an upload, a prepared model and a
  // shape have neither.
  | { type: "model"; sha256: string; name: string; size: number; format: ModelFormat; role?: Role; clips?: ClipName[] }
  | { type: "palette"; colors: string[] }
  | { type: "feel"; tuning: Tuning }
  | { type: "settings"; settingsText: string; tuning: Tuning; models: Record<Role, ModelSource> };

// ---- what a node's code is given ----

/**
 * Files a step makes (Blender's results). They are kept in the graph's own folder under their SHA-256, like its uploads, and go
 * with the graph; `readAsset` reads one once this Play has stored or recalled it.
 */
export interface DerivedFiles {
  /** Stores a GLB a step made and returns its SHA-256. */
  put(bytes: Uint8Array): Promise<string>;
  /** Makes an earlier stored file readable again (true), or says it is gone (false). */
  recall(sha256: string): Promise<boolean>;
}

export interface ExecutorContext {
  user: User;
  /** The graph being played: its folder keeps what steps make, and it is part of every Blender cache key. */
  graphId: string;
  assets: Assets;
  /** The bytes of a file uploaded to this graph or made by one of its steps in this Play, or null if it is gone. */
  readAsset(sha256: string): Promise<Uint8Array | null>;
  /** Where a step keeps the files it makes. */
  derived: DerivedFiles;
  /** When Play must be finished (epoch milliseconds): slow steps shape their calls to the time that is left. */
  deadline: number;
  /** Prepare Model and Make Shape get their GLBs from this (cache, limits, the clock and the worker). */
  blender: BlenderService;
  /** Preview stores the game as an ordinary run through these. */
  runs: Pick<RunService, "createRun" | "putFile" | "deleteRun">;
  /** The run this graph's Preview last stored; Preview replaces it. */
  lastRun: { get(): string | null; set(id: string | null): void };
  /** Build Model turns a person's words (or just a kind) into an animated GLB through this (the kit, Blender, and later the AI). */
  builder: BuilderService;
  /** Describe Game turns a person's words and picture into a palette and a feel through this (cache, limits and the model). */
  ai: DescribeGameService;
}

export type Executor = (
  inputs: Partial<Record<string, WireValue>>,
  params: Record<string, unknown>,
  ctx: ExecutorContext,
) => Promise<{
  /** The value of a step with one output port (it is kept under that port's name). */
  output?: WireValue;
  /** The values of a step with several output ports, by port name. When given, it is used instead of `output`. */
  outputs?: Record<string, WireValue>;
  result: unknown;
}>;
