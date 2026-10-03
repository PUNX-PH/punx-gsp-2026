// The Palette from Image node: five colors from the picture it is given.
import { sampleImage } from "@/lib/graph/image";
import { makePalette } from "@/lib/graph/palette";
import { type Executor, NodeError } from "@/lib/graph/types";

export const paletteFromImage: Executor = async (inputs, _params, ctx) => {
  const image = inputs.image;
  if (image?.type !== "image") throw new Error("Palette from Image was run without its picture"); // Play checks this first

  const bytes = await ctx.readAsset(image.sha256);
  if (!bytes) throw new NodeError("Palette from Image: the picture is missing. Choose it again.");

  const sampled = await sampleImage(bytes);
  if (!sampled.ok) throw new NodeError(`Palette from Image: ${sampled.error}`);

  const colors = makePalette(sampled.pixels);
  return { output: { type: "palette", colors }, result: colors };
};
