// The Build Model node: a rigged, animated model made from the person's words (or from the kind alone). It only passes things along; the
// kit, the AI, the cache, the limits, the clock and Blender are behind the builder service.
import type { ModelKind } from "@/lib/builder/kinds";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type Executor, NodeError, type Role } from "@/lib/graph/types";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const buildModel: Executor = async (inputs, params, ctx) => {
  // The settings' shape was checked when the graph was saved.
  const role = params.role as Role;
  const kind = params.kind as ModelKind | "auto";

  let picture: { sha256: string; bytes: Uint8Array } | null = null;
  if (inputs.image?.type === "image") {
    const bytes = await ctx.readAsset(inputs.image.sha256);
    if (!bytes) throw new NodeError("Build Model: the picture is missing. Choose it again.");
    picture = { sha256: inputs.image.sha256, bytes };
  }

  // Each color that is not #rrggbb falls back to the sample palette's, so the builder always paints with five real colors.
  const given = inputs.palette?.type === "palette" ? inputs.palette.colors : [];
  const palette = SAMPLE_PALETTE.map((sample, i) => (typeof given[i] === "string" && HEX_COLOR.test(given[i]) ? given[i] : sample));

  const built = await ctx.builder.buildModel(
    { user: ctx.user, graphId: ctx.graphId, derived: ctx.derived, deadline: ctx.deadline },
    {
      role,
      kind,
      description: params.description as string,
      motions: { run: params.run as string, jump: params.jump as string, loop: params.loop as string },
      picture,
      palette,
    },
  );
  return {
    output: { type: "model", sha256: built.sha256, name: `${built.kind}.glb`, size: built.size, format: "glb", role, clips: built.clips },
    result: {
      role,
      kind: built.kind,
      parts: built.parts,
      triangles: built.triangles,
      size: built.size,
      clips: built.clips,
      summary: built.summary,
      skipped: built.skipped,
      reused: built.reused,
    },
  };
};
