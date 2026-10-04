// What names a cached Blender job. Pure.
import type { Shape } from "@/lib/blender/types";
import { sha256Hex } from "@/lib/runs/service";

/** Part of every cache key: change it whenever a Blender script or the worker's output changes, so old results are not reused. */
export const JOB_VERSION = 1;

// The parts are encoded as a list, so text cannot run one field into the next, and the kind keeps the two jobs apart.
const keyOf = (parts: unknown[]): Promise<string> => sha256Hex(new TextEncoder().encode(JSON.stringify(parts)));

/**
 * The name of the result of preparing this model for this graph: the same graph, input file, triangle budget and color (the
 * resolved `#rrggbb`, or null for the model's own colors) always give the same key, and anything else gives another. The graph is
 * in it because the result is kept in the graph's own folder. The color is the resolved one, so a palette change that does not
 * change the picked color does not change the key.
 */
export const prepareKey = (input: { graphId: string; inputSha: string; triangles: number; color: string | null }): Promise<string> =>
  keyOf([JOB_VERSION, "prepare", input.graphId, input.inputSha, input.triangles, input.color]);

/** The name of the result of making this shape in this color for this graph. */
export const shapeKey = (input: { graphId: string; shape: Shape; color: string }): Promise<string> =>
  keyOf([JOB_VERSION, "shape", input.graphId, input.shape, input.color]);
