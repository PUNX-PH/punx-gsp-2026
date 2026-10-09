// Writes the freeform reference recipes (kind "model", slice 9) into fixtures/recipes/freeform/. They are what Claude is expected to write from words, made by hand to find
// out what the vocabulary can do. Axes: x side to side, y up, z forward; feet at y = 0.
// Usage, from the repo root: node blender-worker/tools/make-freeform-recipes.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "recipes", "freeform");
mkdirSync(out, { recursive: true });
const write = (name, recipe, palette) => writeFileSync(join(out, `${name}.json`), JSON.stringify({ recipe: { version: 2, kind: "model", ...recipe }, palette }, null, 1) + "\n");

const ball = (at, size, material, extra = {}) => ({ shape: "ellipsoid", at, size, material, ...extra });
const bar = (at, size, material, extra = {}) => ({ shape: "capsule", at, size, material, ...extra });
const cone = (at, size, material, extra = {}) => ({ shape: "cylinder", taper: 0, at, size, material, ...extra });

// ---- a fox: orange fur, a cream chest, cheeks and tail tip, dark legs and ears ----
write(
  "fox",
  {
    summary: "A small orange fox with a bushy tail and big ears.",
    materials: [
      { color: 1, finish: "matte" }, // 0 fur
      { color: 2, finish: "matte" }, // 1 cream
      { color: 0, finish: "matte" }, // 2 dark
      { color: 3, finish: "matte" }, // 3 brown legs
    ],
    parts: [
      ball([0, 0.48, -0.02], [0.5, 0.46, 1.0], 0, { detail: 3 }), // body
      ball([0, 0.56, 0.38], [0.4, 0.42, 0.46], 0, { detail: 3 }), // shoulders and neck
      ball([0, 0.4, 0.4], [0.3, 0.3, 0.4], 1, { detail: 3 }), // cream chest
      ball([0, 0.68, 0.6], [0.4, 0.34, 0.4], 0, { detail: 3 }), // head
      { shape: "loft", at: [0, 0.6, 0], size: [1, 1, 1], material: 0, detail: 3, sections: [{ z: 0.66, w: 0.26, h: 0.2 }, { z: 0.84, w: 0.2, h: 0.15 }, { z: 0.98, w: 0.1, h: 0.08 }, { z: 1.02, w: 0, h: 0 }] }, // snout
      ball([0, 0.61, 1.0], [0.08, 0.065, 0.07], 2), // nose
      ball([0.1, 0.62, 0.8], [0.1, 0.1, 0.2], 1, { mirror: true, detail: 2 }), // cheeks
      cone([0.14, 0.93, 0.5], [0.17, 0.3, 0.09], 0, { mirror: true, rot: [-10, 0, -14], detail: 2 }), // ears
      cone([0.14, 0.9, 0.53], [0.09, 0.19, 0.04], 2, { mirror: true, rot: [-10, 0, -14], detail: 2 }), // inner ears
      ball([0.12, 0.72, 0.8], [0.06, 0.075, 0.05], 2, { mirror: true }), // eyes
      bar([0.15, 0.22, 0.38], [0.15, 0.4, 0.16], 0, { mirror: true }), // front legs
      bar([0.16, 0.24, -0.32], [0.17, 0.4, 0.19], 0, { mirror: true }), // back legs
      ball([0.15, 0.05, 0.42], [0.15, 0.1, 0.22], 3, { mirror: true }), // front paws
      ball([0.16, 0.05, -0.28], [0.17, 0.1, 0.25], 3, { mirror: true }), // back paws
      ball([0, 0.62, -0.78], [0.3, 0.3, 0.78], 0, { rot: [32, 0, 0], detail: 3 }), // tail
      ball([0, 0.86, -1.18], [0.24, 0.24, 0.36], 1, { rot: [32, 0, 0], detail: 3 }), // tail tip
    ],
  },
  ["#2b1d14", "#e8772e", "#f4ede0", "#4a3426", "#fff4dc"],
);

// ---- a spaceship: a lofted hull, a glowing canopy, swept wings, twin engines ----
write(
  "spaceship",
  {
    summary: "A small silver spaceship with a blue canopy, swept wings and twin engines.",
    materials: [
      { color: 1, finish: "metal" }, // 0 hull
      { color: 2, finish: "glow" }, // 1 canopy
      { color: 0, finish: "metal" }, // 2 dark metal
      { color: 4, finish: "glow" }, // 3 engine glow
      { color: 3, finish: "painted" }, // 4 panels
    ],
    parts: [
      { shape: "loft", at: [0, 0.35, 0], size: [1, 1, 1], material: 0, detail: 3, sections: [{ z: 1.5, w: 0, h: 0 }, { z: 1.3, w: 0.2, h: 0.16 }, { z: 0.8, w: 0.62, h: 0.34 }, { z: 0.1, w: 0.95, h: 0.42 }, { z: -0.7, w: 0.9, h: 0.4 }, { z: -1.2, w: 0.6, h: 0.32 }, { z: -1.3, w: 0.5, h: 0.28, round: 0.6 }] }, // hull
      ball([0, 0.55, 0.5], [0.42, 0.28, 0.85], 1, { detail: 3 }), // canopy
      { shape: "loft", at: [0.5, 0.33, -0.45], size: [1, 1, 1], material: 4, detail: 2, mirror: true, rot: [0, 90, 0], sections: [{ z: 0.0, w: 0.8, h: 0.09 }, { z: 0.5, w: 0.62, h: 0.06 }, { z: 0.95, w: 0.2, h: 0.03 }, { z: 1.05, w: 0, h: 0 }] }, // wings
      { shape: "box", at: [0.38, 0.62, -0.95], size: [0.04, 0.5, 0.45], material: 4, bevel: 0.3, mirror: true, rot: [0, 0, -12] }, // fins
      { shape: "cylinder", taper: 0.85, at: [0.3, 0.3, -1.3], size: [0.26, 0.45, 0.26], material: 2, rot: [90, 0, 0], mirror: true, detail: 3 }, // engines
      ball([0.3, 0.3, -1.56], [0.2, 0.2, 0.08], 3, { mirror: true }), // engine glow
      { shape: "box", at: [0, 0.2, 0.2], size: [0.26, 0.06, 0.7], material: 2, bevel: 0.3 }, // belly
      bar([0.45, 0.1, 0.55], [0.05, 0.26, 0.05], 2, { mirror: true, rot: [0, 0, 15] }), // landing gear
    ],
  },
  ["#0b0f1a", "#c9d3e6", "#4f6bff", "#8da2c4", "#ffb347"],
);

// ---- a robot: boxy metal body, a visor with glowing eyes, bolts, an antenna ----
write(
  "robot",
  {
    summary: "A boxy grey robot with a dark visor, red eyes, bolts and an antenna.",
    materials: [
      { color: 3, finish: "metal" }, // 0 body
      { color: 1, finish: "metal" }, // 1 light metal
      { color: 0, finish: "metal" }, // 2 dark
      { color: 2, finish: "glow" }, // 3 red glow
      { color: 2, finish: "painted" }, // 4 red paint
    ],
    parts: [
      { shape: "box", at: [0, 0.95, 0], size: [0.8, 0.75, 0.55], material: 0, bevel: 0.14 }, // torso
      { shape: "box", at: [0, 0.95, 0.285], size: [0.5, 0.4, 0.04], material: 4, bevel: 0.2 }, // chest plate
      ball([0, 0.97, 0.31], [0.14, 0.14, 0.05], 3), // chest light
      { shape: "box", at: [0, 0.5, 0], size: [0.5, 0.2, 0.4], material: 2, bevel: 0.2 }, // hips
      { shape: "box", at: [0, 1.62, 0.02], size: [0.62, 0.5, 0.5], material: 1, bevel: 0.25 }, // head
      { shape: "box", at: [0, 1.62, 0.27], size: [0.5, 0.26, 0.05], material: 2, bevel: 0.3 }, // visor
      ball([0.12, 1.62, 0.3], [0.1, 0.1, 0.04], 3, { mirror: true }), // eyes
      { shape: "cylinder", taper: 1, at: [0, 1.98, 0], size: [0.035, 0.28, 0.035], material: 2, detail: 1 }, // antenna
      ball([0, 2.14, 0], [0.1, 0.1, 0.1], 3), // antenna light
      bar([0.55, 0.95, 0], [0.18, 0.7, 0.2], 1, { mirror: true }), // arms
      ball([0.55, 1.32, 0], [0.3, 0.26, 0.3], 4, { mirror: true }), // shoulders
      { shape: "box", at: [0.55, 0.52, 0.04], size: [0.24, 0.2, 0.28], material: 2, bevel: 0.25, mirror: true }, // hands
      { shape: "box", at: [0.2, 0.22, 0], size: [0.22, 0.4, 0.26], material: 0, bevel: 0.2, mirror: true }, // legs
      { shape: "box", at: [0.2, 0.06, 0.1], size: [0.3, 0.12, 0.46], material: 2, bevel: 0.3, mirror: true }, // feet
      ball([0.4, 1.12, 0.29], [0.05, 0.05, 0.03], 1, { mirror: true }), // bolts
      ball([0.4, 0.78, 0.29], [0.05, 0.05, 0.03], 1, { mirror: true }),
      { shape: "torus", at: [0.55, 0.78, 0], size: [0.24, 0.1, 0.24], thickness: 0.35, material: 2, mirror: true }, // elbow rings
    ],
  },
  ["#12151c", "#a7b0bf", "#e0453f", "#5d6779", "#ffd166"],
);

// ---- a wooden crate: planks, corner posts, rails and nails ----
{
  const parts = [{ shape: "box", at: [0, 0.5, 0], size: [0.96, 0.96, 0.96], material: 1, bevel: 0.04 }];
  for (let i = 0; i < 3; i++) {
    const y = 0.2 + i * 0.3;
    for (const [x, z, w, d] of [[0, 0.49, 0.9, 0.03], [0, -0.49, 0.9, 0.03], [0.49, 0, 0.03, 0.9], [-0.49, 0, 0.03, 0.9]]) {
      parts.push({ shape: "box", at: [x, y, z], size: [w, 0.27, d], material: i % 2 ? 0 : 2, bevel: 0.1 });
    }
  }
  for (let i = 0; i < 3; i++) parts.push({ shape: "box", at: [0, 1.0, -0.3 + i * 0.3], size: [0.9, 0.04, 0.27], material: i % 2 ? 0 : 2, bevel: 0.1 });
  for (const [x, z] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) parts.push({ shape: "box", at: [x, 0.5, z], size: [0.1, 1.04, 0.1], material: 3, bevel: 0.2 });
  for (const y of [0.03, 0.97]) {
    parts.push({ shape: "box", at: [0, y, 0.5], size: [1.04, 0.07, 0.1], material: 3, bevel: 0.2 }, { shape: "box", at: [0, y, -0.5], size: [1.04, 0.07, 0.1], material: 3, bevel: 0.2 });
    parts.push({ shape: "box", at: [0.5, y, 0], size: [0.1, 0.07, 0.9], material: 3, bevel: 0.2 }, { shape: "box", at: [-0.5, y, 0], size: [0.1, 0.07, 0.9], material: 3, bevel: 0.2 });
  }
  for (const [x, y] of [[0.24, 0.2], [-0.24, 0.2], [0.24, 0.8], [-0.24, 0.8]]) parts.push({ shape: "ellipsoid", at: [x, y, 0.515], size: [0.05, 0.05, 0.03], material: 3, detail: 1 });
  write(
    "crate",
    {
      summary: "A wooden crate with plank sides, iron corner posts and rails, and nails.",
      materials: [
        { color: 1, finish: "matte" }, // 0 light plank
        { color: 3, finish: "matte" }, // 1 the box under the planks (dark wood)
        { color: 2, finish: "matte" }, // 2 lighter plank
        { color: 0, finish: "metal" }, // 3 iron
      ],
      parts,
    },
    ["#4a4f58", "#b9854a", "#d1a36a", "#6e4a26", "#e8d5b0"],
  );
}

// ---- a pine: a trunk and tiers of drooping needles ----
{
  const parts = [{ shape: "cylinder", taper: 0.7, at: [0, 0.4, 0], size: [0.32, 0.8, 0.32], material: 2, detail: 2 }];
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const radius = 1.5 - 1.1 * t;
    const y = 0.7 + i * 0.55;
    parts.push({ shape: "cylinder", taper: 0.1, at: [0, y + 0.5, 0], size: [radius, 1.05 - 0.04 * i, radius], material: i % 2, rot: [0, i * 23, 0], detail: 2 });
    // a fringe of drooping boughs round the tier
    for (let k = 0; k < 5; k++) {
      const a = (2 * Math.PI * k) / 5 + i;
      parts.push({ shape: "ellipsoid", at: [Math.cos(a) * radius * 0.42, y + 0.08, Math.sin(a) * radius * 0.42], size: [radius * 0.55, 0.22, radius * 0.4], material: i % 2, rot: [0, ((-a * 57.3) % 360), 8], detail: 1 });
    }
  }
  write(
    "pine",
    {
      summary: "A tall pine with a brown trunk and tiers of dark and light green boughs.",
      materials: [
        { color: 2, finish: "matte" }, // 0 dark green
        { color: 3, finish: "matte" }, // 1 light green
        { color: 1, finish: "matte" }, // 2 trunk
      ],
      parts,
    },
    ["#10201a", "#5c3d24", "#2a6e45", "#3f9d5f", "#cfe8d0"],
  );
}

console.log("wrote freeform recipes to", out);
