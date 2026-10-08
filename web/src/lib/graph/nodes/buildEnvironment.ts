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
    { theme: params.theme as string, density, palette, ...(params.quality === "high" ? { quality: "high" as const } : {}) },
  );
  // A High environment has a world: its three files go on the wire, and the card shows what all the pieces came to.
  const world = built.quality === "high" ? built.world : undefined;
  const pieces = [...built.scenery, ...(world ? [world.terrain, world.road, world.backdrop] : [])];
  const total = (key: "triangles" | "vertices" | "size") => pieces.reduce((sum, piece) => sum + (piece[key] ?? 0), 0);
  return {
    output: {
      type: "environment",
      sky: built.sky,
      field: built.field,
      stripe: built.stripe,
      density: built.density,
      scenery: built.scenery.map(({ kind, sha256 }) => ({ kind, sha256 })),
      ...(world ? { quality: "high" as const, world: { style: world.style, terrain: world.terrain.sha256, road: world.road.sha256, backdrop: world.backdrop.sha256 } } : {}),
    },
    // The picks are shown as the colors they stand for in the palette this step painted with.
    result: {
      sky: palette[built.sky],
      field: palette[built.field],
      stripe: palette[built.stripe],
      density: built.density,
      scenery: built.scenery.map((piece) => piece.kind),
      // the files of the pieces, for the studio window to show
      pieces: [...built.scenery.map((piece) => ({ name: piece.kind, sha256: piece.sha256 })), ...(world ? [{ name: "terrain", sha256: world.terrain.sha256 }, { name: "road", sha256: world.road.sha256 }, { name: "backdrop", sha256: world.backdrop.sha256 }] : [])],
      reused: built.reused,
      ...(world ? { quality: "high" as const, world: world.style, triangles: total("triangles"), vertices: total("vertices"), size: total("size") } : {}),
    },
  };
};
