// The Build World node: the world around a made game, from the game's own plan. It sets the sky and the ground (palette picks) and makes each piece of scenery from
// its words, as a model of its own (built for the PC and the phone by the builder service). A piece that cannot be built is left out and counted: the game still has
// its sky and its ground. Everything else (the AI, the cache, the limits, the clock, Blender) is behind the builder service.
import type { ArtStyle } from "@/lib/builder/world";
import { paintingPalette } from "@/lib/graph/palette";
import { type Executor, NodeError } from "@/lib/graph/types";

export const buildWorld: Executor = async (inputs, params, ctx) => {
  // The settings' shape was checked when the graph was saved.
  const sky = params.sky as number;
  const ground = params.ground as number;
  const style = typeof params.style === "string" ? (params.style as ArtStyle) : undefined;
  const descriptions = params.scenery as string[];
  const palette = paintingPalette(inputs.palette?.type === "palette" ? inputs.palette.colors : []);
  const job = { user: ctx.user, graphId: ctx.graphId, derived: ctx.derived, deadline: ctx.deadline };

  const made: { name: string; sha256: string; mobile?: string; triangles: number; reused: boolean }[] = [];
  let skipped = 0;
  for (const description of descriptions) {
    try {
      const built = await ctx.builder.buildScenery(job, { description, palette, ...(style ? { style } : {}) });
      made.push({ name: built.summary, sha256: built.sha256, ...(built.mobile ? { mobile: built.mobile.sha256 } : {}), triangles: built.triangles, reused: built.reused });
    } catch (error) {
      if (!(error instanceof NodeError)) throw error;
      skipped += 1; // a limit, the clock or the worker: that piece is left out, and the others are still tried
    }
  }

  return {
    output: {
      type: "environment",
      sky,
      field: ground,
      stripe: ground,
      density: "lots",
      scenery: made.map(({ sha256, mobile }) => ({ kind: "custom" as const, sha256, ...(mobile ? { mobile } : {}) })),
    },
    result: {
      sky: palette[sky],
      field: palette[ground],
      pieces: made.map(({ name, sha256 }) => ({ name, sha256 })),
      triangles: made.reduce((sum, piece) => sum + piece.triangles, 0),
      skipped,
      reused: skipped === 0 && made.every((piece) => piece.reused),
    },
  };
};
