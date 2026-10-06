// The Build Environment node: the world around the track (sky, field, edge stripes and scenery) made from a theme, or a meadow from no theme.
// It only passes things along; the kit, the AI, the cache, the limits, the clock and Blender are behind the builder service.
import { paintingPalette } from "@/lib/graph/palette";
import type { Density } from "@/lib/settings";
import type { Executor } from "@/lib/graph/types";

export const buildEnvironment: Executor = async (inputs, params, ctx) => {
  // The settings' shape was checked when the graph was saved.
  const density = params.density as Density;
  const palette = paintingPalette(inputs.palette?.type === "palette" ? inputs.palette.colors : []);

  const built = await ctx.builder.buildEnvironment(
    { user: ctx.user, graphId: ctx.graphId, derived: ctx.derived, deadline: ctx.deadline },
    { theme: params.theme as string, density, palette },
  );
  return {
    output: {
      type: "environment",
      sky: built.sky,
      field: built.field,
      stripe: built.stripe,
      density: built.density,
      scenery: built.scenery.map(({ kind, sha256 }) => ({ kind, sha256 })),
    },
    // The picks are shown as the colors they stand for in the palette this step painted with.
    result: {
      sky: palette[built.sky],
      field: palette[built.field],
      stripe: palette[built.stripe],
      density: built.density,
      scenery: built.scenery.map((piece) => piece.kind),
      reused: built.reused,
    },
  };
};
