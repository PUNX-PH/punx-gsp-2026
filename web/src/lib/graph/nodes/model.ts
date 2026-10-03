// The 3D Model node: hands on the GLB the person chose. The file was checked when it was uploaded.
import { type Executor, NodeError } from "@/lib/graph/types";

export const model: Executor = async (_inputs, params, ctx) => {
  const sha256 = params.asset as string; // Play checked that a file was chosen
  const info = Object.hasOwn(ctx.assets, sha256) ? ctx.assets[sha256] : undefined;
  if (!info || info.kind !== "model") throw new NodeError("3D Model: the file is missing. Choose it again.");

  return { output: { type: "model", sha256, name: info.name, size: info.size }, result: { name: info.name, size: info.size } };
};
