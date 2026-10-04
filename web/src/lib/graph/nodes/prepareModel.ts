// The Prepare Model node: a model the person uploaded (a GLB, FBX or OBJ) becomes a small GLB in flat colors. All the rules (the
// cache, the limits, the clock, the worker) are in the Blender service it is given; this only reads the file, picks the color and
// passes things along.
import { resolveColor } from "@/lib/blender/color";
import { type Executor, NodeError } from "@/lib/graph/types";

// The old name with its extension replaced by .glb (a name that is only an extension, like ".hidden", keeps it).
const glbName = (name: string) => `${name.replace(/(?<=.)\.[^./]+$/, "")}.glb`;

export const prepareModel: Executor = async (inputs, params, ctx) => {
  const given = inputs.model;
  const bytes = given?.type === "model" ? await ctx.readAsset(given.sha256) : null;
  if (given?.type !== "model" || !bytes) throw new NodeError("Prepare Model: the model is missing. Choose it again.");

  // The settings' shape was checked when the graph was saved. The color is the resolved one, so a palette change that leaves
  // the picked color as it was makes the same call (and is answered from the cache).
  const palette = inputs.palette?.type === "palette" ? inputs.palette.colors : null;
  const color = resolveColor(params.color, palette);

  const made = await ctx.blender.prepare(
    { user: ctx.user, graphId: ctx.graphId, derived: ctx.derived, deadline: ctx.deadline },
    { sha256: given.sha256, bytes, format: given.format, triangles: params.triangles as number, color },
  );
  return {
    output: { type: "model", sha256: made.sha256, name: glbName(given.name), size: made.size, format: "glb" },
    result: { trianglesBefore: made.trianglesBefore, trianglesAfter: made.trianglesAfter, size: made.size, color, reused: made.reused },
  };
};
