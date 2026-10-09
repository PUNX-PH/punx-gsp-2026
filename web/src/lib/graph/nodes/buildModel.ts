// The Build Model node: a rigged, animated model made from the person's words (or from the kind alone). It only passes things along; the
// kit, the AI, the cache, the limits, the clock and Blender are behind the builder service.
import type { ModelKind } from "@/lib/builder/kinds";
import { paintingPalette } from "@/lib/graph/palette";
import { type Executor, NodeError, type Role } from "@/lib/graph/types";

export const buildModel: Executor = async (inputs, params, ctx) => {
  // The settings' shape was checked when the graph was saved.
  const role = params.role as Role;
  const kind = params.kind as ModelKind | "auto" | "freeform";
  // A graph saved before the Quality setting has none, and means Standard; only High is told to the builder.
  const high = params.quality === "high";

  let picture: { sha256: string; bytes: Uint8Array } | null = null;
  if (inputs.image?.type === "image") {
    const bytes = await ctx.readAsset(inputs.image.sha256);
    if (!bytes) throw new NodeError("Build Model: the picture is missing. Choose it again.");
    picture = { sha256: inputs.image.sha256, bytes };
  }

  // Each color that is not #rrggbb falls back to the sample palette's, so the builder always paints with five real colors.
  const palette = paintingPalette(inputs.palette?.type === "palette" ? inputs.palette.colors : []);

  const built = await ctx.builder.buildModel(
    { user: ctx.user, graphId: ctx.graphId, derived: ctx.derived, deadline: ctx.deadline },
    {
      role,
      kind,
      description: params.description as string,
      motions: { run: params.run as string, jump: params.jump as string, loop: params.loop as string },
      picture,
      palette,
      ...(high ? { quality: "high" as const } : {}),
    },
  );
  return {
    output: { type: "model", sha256: built.sha256, name: `${built.kind}.glb`, size: built.size, format: "glb", role, clips: built.clips, ...(built.quality === "high" ? { quality: "high" as const } : {}), ...(built.mobile ? { mobile: { sha256: built.mobile.sha256, size: built.mobile.size } } : {}) },
    result: {
      role,
      kind: built.kind,
      sha256: built.sha256, // the studio window shows this file
      parts: built.parts,
      triangles: built.triangles,
      size: built.size,
      clips: built.clips,
      summary: built.summary,
      skipped: built.skipped,
      reused: built.reused,
      ...(built.quality === "high" ? { quality: "high" as const, ...(built.vertices === undefined ? {} : { vertices: built.vertices }) } : {}),
      ...(built.mobile ? { mobile: built.mobile } : {}),
    },
  };
};
