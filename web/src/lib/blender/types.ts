// The vocabulary of the Blender steps: the shapes and settings a person can choose, what the worker gives back, the service the
// steps call, and the two ways the worker can fail. The rules (cache, limits, time) live in the other files of lib/blender.
import type { User } from "@/lib/auth/ports";
import type { DerivedFiles } from "@/lib/graph/types";

/** The shapes Make Shape can build. A fixed list, so Describe Game can pick from it later. */
export const SHAPES = ["cube", "sphere", "cone", "cylinder", "pyramid", "coin", "ring"] as const;
export type Shape = (typeof SHAPES)[number];
export const SHAPE_NAMES: Record<Shape, string> = {
  cube: "Cube",
  sphere: "Sphere",
  cone: "Cone",
  cylinder: "Cylinder",
  pyramid: "Pyramid",
  coin: "Coin",
  ring: "Ring",
};

/** The kinds of model file a person can upload. Only a GLB can go into a game as it is. */
export type ModelFormat = "glb" | "fbx" | "obj";

/** Prepare Model's triangle budget: a whole number from `min` to `max`. */
export const TRIANGLES = { min: 100, max: 5000, default: 2000 } as const;

/** A palette color by position, as a person counts them (1 to 5). */
export type Swatch = 1 | 2 | 3 | 4 | 5;

/** The most the worker takes as input (Cloud Run's HTTP/1 request limit). Uploads stop at 4 MB long before this. */
export const MAX_WORKER_INPUT_BYTES = 32 * 1024 * 1024;

/** What one worker job gives back: a GLB and its triangle counts (`trianglesBefore` is null when the worker did not say). */
export interface MadeModel {
  bytes: Uint8Array;
  trianglesBefore: number | null;
  trianglesAfter: number;
}

/** The Blender worker, one call per job. `color` is a `#rrggbb` color, or null to keep the model's own colors. */
export interface BlenderWorker {
  prepare(input: { bytes: Uint8Array; format: ModelFormat; triangles: number; color: string | null; timeoutMs: number }): Promise<MadeModel>;
  shape(input: { shape: Shape; color: string; timeoutMs: number }): Promise<MadeModel>;
}

/** Blender ran and said no to this file. Carries a code and nothing else on purpose. */
export class BlenderRefusedError extends Error {
  constructor(readonly code: "empty" | "bad-format" | "too-big" | "timeout" | "failed") {
    super("Blender refused the file");
    this.name = "BlenderRefusedError";
  }
}

/**
 * The worker could not be reached, did not answer in time, refused our token, or gave back something unusable. Carries no
 * detail on purpose, except the HTTP status when there was one: a plain number that is safe to log.
 */
export class BlenderUnavailableError extends Error {
  constructor(readonly status?: number) {
    super("The Blender service is not available");
    this.name = "BlenderUnavailableError";
  }
}

/** What a job needs from Play: who is asking, which graph's folder keeps the result, and when Play must be finished. */
export interface BlenderJob {
  user: User;
  graphId: string;
  derived: DerivedFiles;
  deadline: number; // epoch milliseconds
}

/** The stored model a step hands on, with what the card shows. `reused` is true when the cache answered. */
export interface MadeResult {
  sha256: string;
  size: number;
  trianglesBefore: number | null;
  trianglesAfter: number;
  reused: boolean;
}

/** What the steps call: it caches, counts, watches the clock, asks the worker, keeps the result, and says in plain words (as a NodeError) when it cannot. */
export interface BlenderService {
  prepare(
    job: BlenderJob,
    input: { sha256: string; bytes: Uint8Array; format: ModelFormat; triangles: number; color: string | null },
  ): Promise<MadeResult>;
  shape(job: BlenderJob, input: { shape: Shape; color: string }): Promise<MadeResult>;
}
