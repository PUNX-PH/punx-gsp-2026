// The vocabulary of the builder: what Build Model asks for, what it gives back, and the service the step calls.
import type { BlenderJob } from "@/lib/blender/types";
import type { ClipKey, ClipName, ModelKind } from "@/lib/builder/kinds";
import type { Skipped } from "@/lib/builder/recipes";
import type { Role } from "@/lib/graph/types";

/** What the step hands the builder: the settings as the person left them (the words not yet cleaned), the optional picture, and the palette. */
export interface BuildModelInput {
  role: Role;
  /** The kind the person chose, or "auto" to let the AI pick one from the description. */
  kind: ModelKind | "auto";
  description: string;
  /** What the person typed in the boxes. Only the boxes of the role's own clips count. */
  motions: Record<ClipKey, string>;
  picture: { sha256: string; bytes: Uint8Array } | null;
  palette: readonly string[];
}

/** A built model, stored in the graph's folder, with what the card shows. */
export interface BuiltModel {
  sha256: string;
  size: number;
  kind: ModelKind;
  parts: number;
  triangles: number;
  clips: ClipName[];
  /** One sentence about the look (the recipe's), as plain text. */
  summary: string;
  /** Motions the AI asked for that this model could not do (a tail on a blob). */
  skipped: Skipped[];
  reused: boolean;
}

export interface BuilderService {
  buildModel(job: BlenderJob, input: BuildModelInput): Promise<BuiltModel>;
}
