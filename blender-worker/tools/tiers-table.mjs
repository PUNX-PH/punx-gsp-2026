// The High tier's numbers in one place. `write-tiers.mjs` writes them into kit.json and the typed copy in kinds.ts.
// Measured from Blender's output with tools/measure-high.py (the world pieces are the larger of the two styles); when a builder changes, measure again,
// edit the numbers here and run write-tiers.mjs.
const b = (triangles, vertices, parts, meshes) => ({ triangles, vertices, parts, meshes });

export const TIERS = {
  high: {
    caps: {
      biped: b(12000, 9500, 80, 14),
      vehicle: b(6000, 4800, 50, 10),
      blob: b(5000, 4000, 30, 6),
      prop: b(3500, 2800, 24, 5),
      scenery: b(1500, 1200, 24, 3),
      world: { terrain: { triangles: 8000, vertices: 4200 }, road: { triangles: 1500, vertices: 1200 }, backdrop: { triangles: 1200, vertices: 700 } },
      materials: 7,
      details: 4,
    },
    finishes: {
      matte: { metallic: 0, roughness: 0.85, emission: 0 },
      painted: { metallic: 0, roughness: 0.35, emission: 0 },
      metal: { metallic: 0.9, roughness: 0.3, emission: 0 },
      rubber: { metallic: 0, roughness: 0.9, emission: 0 },
      glow: { metallic: 0, roughness: 0.5, emission: 1 },
    },
    // What each extra adds in High.
    extras: {
      tail: b(360, 184, 2, 0),
      ears: b(360, 184, 2, 0),
      antenna: b(516, 358, 3, 0),
      hat: b(140, 72, 1, 0),
      backpack: b(432, 384, 4, 0),
    },
    // What each detail adds, for the kinds that can have it (a kind with no entry cannot have the detail). Details join existing meshes.
    details: {
      seams: { biped: b(228, 264, 4, 0), vehicle: b(36, 72, 3, 0), blob: b(384, 352, 2, 0), prop: b(432, 468, 3, 0) },
      bolts: { biped: b(392, 448, 14, 0), vehicle: b(224, 256, 8, 0), prop: b(224, 256, 8, 0) },
      cables: { biped: b(288, 336, 4, 0), vehicle: b(144, 168, 2, 0) },
      lights: { biped: b(72, 144, 6, 0), vehicle: b(312, 204, 4, 0), blob: b(288, 156, 2, 0) },
    },
    defaults: {
      biped: { finishes: { head: "painted", body: "painted", arms: "painted", legs: "metal", feet: "rubber", extra: "painted" }, details: ["seams", "bolts", "lights"] },
      vehicle: { finishes: { body: "painted", cab: "metal", wheels: "rubber", extra: "painted" }, details: ["seams", "lights"] },
      blob: { finishes: { body: "painted", eyes: "glow", extra: "matte" }, details: ["lights"] },
      prop: { finishes: { body: "painted", extra: "metal" }, details: ["seams", "bolts"] },
      scenery: {
        tree: { finishes: { main: "matte", detail: "matte" } },
        pine: { finishes: { main: "matte", detail: "matte" } },
        rock: { finishes: { main: "matte", detail: "matte" } },
        cactus: { finishes: { main: "matte", detail: "glow" } },
        windmill: { finishes: { main: "painted", detail: "painted" } },
        lamp: { finishes: { main: "metal", detail: "glow" } },
      },
      world: { finishes: { ground: "matte", accent: "matte", far: "matte" } },
    },
    // The High model of each kind before extras and details. A vehicle adds its cab (when cabSize > 0) and each wheel; a prop is its shape.
    base: {
      biped: b(7188, 4788, 52, 7),
      vehicle: { ...b(432, 384, 4, 1), cab: b(120, 120, 2, 0), wheel: b(160, 104, 2, 1) },
      blob: b(1488, 1038, 6, 1),
      prop: {
        shapes: {
          cube: b(108, 96, 1, 1),
          sphere: b(440, 222, 1, 1),
          cone: b(94, 97, 1, 1),
          cylinder: b(156, 80, 1, 1),
          pyramid: b(14, 32, 1, 1),
          coin: b(476, 384, 2, 1),
          ring: b(480, 240, 1, 1),
          gem: b(70, 81, 3, 1),
          crate: b(324, 288, 3, 1),
        },
      },
      scenery: {
        tree: b(804, 430, 4, 2),
        pine: b(174, 193, 6, 2),
        rock: b(336, 174, 2, 1),
        cactus: b(1068, 596, 7, 1),
        windmill: b(834, 723, 8, 2),
        lamp: b(532, 422, 5, 1),
      },
      // the larger of the two styles for each (the backdrop builds different shapes in each); a build must come to at most this and at least half of it
      world: { terrain: { triangles: 8000, vertices: 4131 }, road: { triangles: 868, vertices: 595 }, backdrop: { triangles: 408, vertices: 612 } },
    },
    // The palette slots a world piece is colored with, by style (ground, accent, far). Unity's sky, sun and fog tables are by style too.
    worlds: {
      pieces: ["terrain", "road", "backdrop"],
      slots: { ground: 3, accent: 2, far: 1 },
      styles: ["desert", "meadow"],
    },
  },
};
