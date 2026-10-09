// The vocabulary of the builder: what Build Model asks for, what it gives back, and the service the step calls.
import type { BlenderJob } from "@/lib/blender/types";
import type { ClipKey, ClipName, ModelKind, Quality, SceneryKind, WorldStyle } from "@/lib/builder/kinds";
import type { Skipped } from "@/lib/builder/recipes";
import type { ArtStyle } from "@/lib/builder/world";
import type { Role } from "@/lib/graph/types";
import type { Density } from "@/lib/settings";

/** What the step hands the builder: the settings as the person left them (the words not yet cleaned), the optional picture, and the palette. */
export interface BuildModelInput {
  role: Role;
  /** The kind the person chose, "auto" to let the AI pick one from the description, or "freeform" for a model composed of parts (no kit kind, no animation yet). */
  kind: ModelKind | "auto" | "freeform";
  description: string;
  /** What the person typed in the boxes. Only the boxes of the role's own clips count. */
  motions: Record<ClipKey, string>;
  picture: { sha256: string; bytes: Uint8Array } | null;
  palette: readonly string[];
  /** Absent means Standard. */
  quality?: Quality;
  /** The art style of the game (freeform models only); absent means the designer's own choice. */
  style?: ArtStyle;
}

/** A built model, stored in the graph's folder, with what the card shows. */
export interface BuiltModel {
  sha256: string;
  size: number;
  kind: ModelKind | "freeform";
  parts: number;
  triangles: number;
  clips: ClipName[];
  /** One sentence about the look (the recipe's), as plain text. */
  summary: string;
  /** Motions the AI asked for that this model could not do (a tail on a blob), and, in High, tracks dropped to keep within the mesh budget. */
  skipped: Skipped[];
  reused: boolean;
  /** Only a High model says so, and how many shared vertices its GLB holds. */
  quality?: Quality;
  vertices?: number;
  /** A freeform model also has a variant cut to the phone's budget (`sha256` and `triangles` above are the PC's). */
  mobile?: { sha256: string; size: number; triangles: number };
}

/** What Build Environment hands the builder: the person's theme (not yet cleaned), how much scenery, and the palette. */
export interface BuildEnvironmentInput {
  theme: string;
  density: Density;
  palette: readonly string[];
  /** Absent means Standard. */
  quality?: Quality;
}

/** One stored GLB of the world or of the scenery, with what the card shows. `vertices` is only there in High. */
export interface BuiltPiece {
  sha256: string;
  size: number;
  triangles: number;
  vertices?: number;
}

/** The High world: its style, and one stored GLB for each of its three pieces. */
export interface BuiltWorld {
  style: WorldStyle;
  terrain: BuiltPiece;
  road: BuiltPiece;
  backdrop: BuiltPiece;
}

/** A built environment: the three palette picks, the density the person chose, and one stored GLB for each piece of scenery. */
export interface BuiltEnvironment {
  sky: number;
  field: number;
  stripe: number;
  density: Density;
  scenery: (BuiltPiece & { kind: SceneryKind })[];
  /** True only when Claude was not asked and every piece, the world's too, came from the cache. */
  reused: boolean;
  /** Only a High environment says so, and has a world. */
  quality?: Quality;
  world?: BuiltWorld;
}

export interface BuilderService {
  buildModel(job: BlenderJob, input: BuildModelInput): Promise<BuiltModel>;
  buildEnvironment(job: BlenderJob, input: BuildEnvironmentInput): Promise<BuiltEnvironment>;
}
