// The Make Shape node: a low-poly shape in one of the palette's colors, built by Blender. Like Prepare Model it only passes things
// along; the cache, the limits, the clock and the worker are in the Blender service.
import { resolveColor } from "@/lib/blender/color";
import type { Shape } from "@/lib/blender/types";
import type { Executor } from "@/lib/graph/types";

export const makeShape: Executor = async (inputs, params, ctx) => {
  const shape = params.shape as Shape; // the settings' shape was checked when the graph was saved
  const palette = inputs.palette?.type === "palette" ? inputs.palette.colors : null;
  const color = resolveColor(params.color, palette);
  if (color === null) throw new Error("a shape's color is always a swatch"); // the save check refuses anything else

  const made = await ctx.blender.shape({ user: ctx.user, graphId: ctx.graphId, derived: ctx.derived, deadline: ctx.deadline }, { shape, color });
  return {
    output: { type: "model", sha256: made.sha256, name: `${shape}.glb`, size: made.size, format: "glb" },
    result: { shape, color, trianglesAfter: made.trianglesAfter, size: made.size, reused: made.reused },
  };
};
