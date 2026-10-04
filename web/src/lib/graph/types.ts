// The shared vocabulary of the graph engine: what a graph is, what travels along its wires, and what a node's code is
// given. The runner's own result types live in runner.ts; the node catalog (labels, ports) is in registry.ts.
import type { User } from "@/lib/auth/ports";
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
  | { type: "model"; sha256: string; name: string; size: number }
  | { type: "palette"; colors: string[] }
  | { type: "feel"; tuning: Tuning }
  | { type: "settings"; settingsText: string; tuning: Tuning; models: Record<Role, ModelSource> };

// ---- what a node's code is given ----

export interface ExecutorContext {
  user: User;
  assets: Assets;
  /** The bytes of a file uploaded to this graph, or null if it is gone. */
  readAsset(sha256: string): Promise<Uint8Array | null>;
  /** Preview stores the game as an ordinary run through these. */
  runs: Pick<RunService, "createRun" | "putFile" | "deleteRun">;
  /** The run this graph's Preview last stored; Preview replaces it. */
  lastRun: { get(): string | null; set(id: string | null): void };
}

export type Executor = (
  inputs: Partial<Record<string, WireValue>>,
  params: Record<string, unknown>,
  ctx: ExecutorContext,
) => Promise<{ output?: WireValue; result: unknown }>;
