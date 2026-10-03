// The Reference Image node: hands on the picture the person chose. The picture was checked when it was uploaded.
import { type Executor, NodeError } from "@/lib/graph/types";

export const referenceImage: Executor = async (_inputs, params, ctx) => {
  const sha256 = params.asset as string; // Play checked that a file was chosen
  const info = Object.hasOwn(ctx.assets, sha256) ? ctx.assets[sha256] : undefined;
  if (!info || info.kind !== "image") throw new NodeError("Reference Image: the file is missing. Choose it again.");

  const [width, height] = [info.width ?? 0, info.height ?? 0];
  return { output: { type: "image", sha256, name: info.name, width, height }, result: { name: info.name, width, height } };
};
