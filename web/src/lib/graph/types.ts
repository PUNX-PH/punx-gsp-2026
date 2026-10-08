// The shared vocabulary of the graph engine: what a graph is, what travels along its wires, and what a node's code is
// given. The runner's own result types live in runner.ts; the node catalog (labels, ports) is in registry.ts.
import type { AssetRequest, GameService } from "@/lib/engine/service";
import type { GameSpec } from "@/lib/engine/spec";
import type { DescribeGameService } from "@/lib/ai/types";
import type { User } from "@/lib/auth/ports";
import type { BlenderService, ModelFormat } from "@/lib/blender/types";
import type { BuilderService } from "@/lib/builder/types";
import type { ClipName, Quality, SceneryKind, WorldStyle } from "@/lib/builder/kinds";
import type { RunService } from "@/lib/runs/types";
import type { Density } from "@/lib/settings";

/**
 * What a wire carries. A `feel` is the three tuning numbers (how fast, how high, how far apart); an `environment` is the world around the
 * track (the sky, the field and the edge stripes as palette picks, and the scenery).
 */
export type WireType = "image" | "model" | "palette" | "feel" | "environment" | "settings" | "game";

/** The three models a runner game uses, and the file each is stored under in a run. */
export type Role = "hero" | "obstacle" | "collectible";
export const ROLE_FILES: Record<Role, string> = { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb" };

/** The files a run keeps its scenery under (at most three), whatever the pieces are. */
export const SCENERY_FILES = ["scenery1.glb", "scenery2.glb", "scenery3.glb"] as const;

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
    readonly status: 400 | 404 | 409 | 429 | 503,
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
  // `quality` is there only when Build Model made a High model (a missing one means Standard).
  | { type: "model"; sha256: string; name: string; size: number; format: ModelFormat; role?: Role; clips?: ClipName[]; quality?: Quality }
  | { type: "palette"; colors: string[] }
  | { type: "feel"; tuning: Tuning }
  // A whole game from Describe Game: the checked spec, what Claude left out, the assets asked for, and the entity files made so far (entity-NAME.glb).
  | { type: "game"; spec: GameSpec; leftOut: string; assets: AssetRequest[]; entityFiles: { file: string; sha256: string }[] }
  // `sky`, `field` and `stripe` are palette indices 0 to 4; each piece of scenery is a GLB stored in the graph's folder.
  // A High environment also says so and carries the three files of its world (`style` is the look of the land, the road and the far hills).
  | {
      type: "environment";
      sky: number;
      field: number;
      stripe: number;
      density: Density;
      scenery: { kind: SceneryKind; sha256: string }[];
      quality?: Quality;
      world?: { style: WorldStyle; terrain: string; road: string; backdrop: string };
    }
  // `scenery` is there only when an environment was wired: the files, in the order the settings name them. `world` only when that environment
  // was High and had a world: its three files (terrain, road, backdrop).
  | {
      type: "settings";
      settingsText: string;
      tuning: Tuning;
      models: Record<Role, ModelSource>;
      scenery?: { file: string; sha256: string }[];
      world?: { file: string; sha256: string }[];
      // Present (even empty) only for an engine game: the entity files, which are then the only files of the run.
      entityFiles?: { file: string; sha256: string }[];
    };

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
  /** Describe Game with Make a game on writes a whole game through this; without one the step says it is not set up. */
  games?: GameService;
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
