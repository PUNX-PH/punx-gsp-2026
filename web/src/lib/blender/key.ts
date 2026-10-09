// What names a cached Blender job. Pure.
import type { AnyBuildBody } from "@/lib/builder/recipes";
import type { Shape } from "@/lib/blender/types";
import { sha256Hex } from "@/lib/runs/service";

/** Part of every cache key: change it whenever a Blender script or the worker's output changes, so old results are not reused. */
export const JOB_VERSION = 1;

/**
 * JSON with the keys of every object in sorted order, so the same data written in another key order (Claude's recipes can come in any
 * order) gives the same text. Arrays keep their order; strings, numbers and booleans are written as `JSON.stringify` writes them, and
 * what JSON leaves out (an `undefined` property) is left out here too.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const members = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The parts are encoded as a list, so text cannot run one field into the next, and the kind keeps the jobs apart. For a list of plain
 * values this is the same text `JSON.stringify` makes, so the prepare and shape keys are what they always were.
 */
export const hashKey = (parts: unknown[]): Promise<string> => sha256Hex(new TextEncoder().encode(canonicalJson(parts)));

/**
 * The name of the result of preparing this model for this graph: the same graph, input file, triangle budget and color (the
 * resolved `#rrggbb`, or null for the model's own colors) always give the same key, and anything else gives another. The graph is
 * in it because the result is kept in the graph's own folder. The color is the resolved one, so a palette change that does not
 * change the picked color does not change the key.
 */
export const prepareKey = (input: { graphId: string; inputSha: string; triangles: number; color: string | null }): Promise<string> =>
  hashKey([JOB_VERSION, "prepare", input.graphId, input.inputSha, input.triangles, input.color]);

/** The name of the result of making this shape in this color for this graph. */
export const shapeKey = (input: { graphId: string; shape: Shape; color: string }): Promise<string> =>
  hashKey([JOB_VERSION, "shape", input.graphId, input.shape, input.color]);

/**
 * The name of the result of building this recipe with these motions in this palette for this graph. The key order inside the recipe
 * and the motions does not matter, because only what they say is hashed.
 */
export const buildKey = (input: { graphId: string; body: AnyBuildBody }): Promise<string> =>
  "motions" in input.body
    ? hashKey([JOB_VERSION, "build", input.graphId, input.body.recipe, input.body.motions, input.body.palette])
    : // a freeform model: the role and the target are part of the question (the same recipe is cut to another budget)
      hashKey([JOB_VERSION, "build", input.graphId, input.body.recipe, input.body.palette, input.body.role, input.body.target]);
