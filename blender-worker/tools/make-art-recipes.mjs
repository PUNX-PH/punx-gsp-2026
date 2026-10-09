// Writes the five reference recipes of the art gate (slice 9, Task 1) into fixtures/recipes/art/: a fox hero, a robot enemy, a wooden crate, a forest piece and a
// spaceship, each as good as the CURRENT kit (High) can make it. They are derived from the High fixtures, so they pass the worker's own checks. The gate is
// whether this ceiling looks good enough; if it does not, the kit grows (Tasks 2 and 3) until these five do.
// Usage, from the repo root: node blender-worker/tools/make-art-recipes.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const high = join(here, "..", "fixtures", "recipes", "high");
const out = join(here, "..", "fixtures", "recipes", "art");
mkdirSync(out, { recursive: true });

const base = (name) => JSON.parse(readFileSync(join(high, name), "utf8"));
const write = (name, body) => writeFileSync(join(out, `${name}.json`), JSON.stringify(body, null, 2) + "\n");

// palette slots: 0 dark, 1..3 the body colors, 4 light

// A fox: small, orange, cream chest and feet-dark legs, a tail and ears.
{
  const body = base("biped-high-default.json");
  Object.assign(body.recipe.build, { headSize: 0.58, torsoWidth: 0.46, torsoHeight: 0.46, armLength: 0.38, armThickness: 0.12, legLength: 0.42, legThickness: 0.15, footSize: 0.2 });
  Object.assign(body.recipe, {
    summary: "A small orange fox with a bushy tail and big ears.",
    colors: { head: 1, body: 1, arms: 1, legs: 3, feet: 0, extra: 1 },
    extras: ["tail", "ears"],
    finishes: { head: "painted", body: "painted", arms: "painted", legs: "matte", feet: "rubber", extra: "painted" },
    details: ["seams"],
  });
  body.palette = ["#2b1d14", "#e8772e", "#f4ede0", "#4a3426", "#fff4dc"];
  write("fox-hero", body);
}

// A robot: boxy, metal, red eye-light, bolts and an antenna.
{
  const body = base("biped-high-default.json");
  Object.assign(body.recipe.build, { headSize: 0.46, torsoWidth: 0.72, torsoHeight: 0.7, armLength: 0.55, armThickness: 0.17, legLength: 0.4, legThickness: 0.2, footSize: 0.28 });
  Object.assign(body.recipe, {
    summary: "A boxy grey robot with bolts, a red light and an antenna.",
    colors: { head: 1, body: 3, arms: 1, legs: 3, feet: 0, extra: 2 },
    extras: ["antenna"],
    finishes: { head: "metal", body: "metal", arms: "metal", legs: "metal", feet: "rubber", extra: "glow" },
    details: ["bolts", "lights", "seams"],
  });
  body.palette = ["#12151c", "#a7b0bf", "#e0453f", "#5d6779", "#ffd166"];
  write("robot-enemy", body);
}

// A wooden crate with bolts and seams.
{
  const body = base("prop-high-default.json");
  Object.assign(body.recipe.build, { shape: "crate", size: 1.2 });
  Object.assign(body.recipe, {
    summary: "A wooden crate with iron corners.",
    colors: { body: 1, extra: 3 },
    finishes: { body: "matte", extra: "metal" },
    details: ["seams", "bolts"],
  });
  body.palette = ["#2a1b10", "#a8743f", "#c99a5b", "#53606b", "#e8d5b0"];
  write("wooden-crate", body);
}

// A forest piece: a tall pine.
{
  const body = base("scenery-pine-high.json");
  Object.assign(body.recipe, { summary: "A tall pine with a brown trunk.", colors: { main: 2, detail: 1 }, finishes: { main: "matte", detail: "matte" } });
  body.palette = ["#10201a", "#5c3d24", "#2f7d4f", "#3f9d5f", "#cfe8d0"];
  write("forest-pine", body);
}

// A spaceship: the vehicle kind with two small wheels as landing gear, a cab as the cockpit, an antenna.
{
  const body = base("vehicle-high-default.json");
  Object.assign(body.recipe.build, { bodyLength: 2.3, bodyWidth: 1.25, bodyHeight: 0.34, cabSize: 0.55, wheelCount: 2, wheelRadius: 0.15 });
  Object.assign(body.recipe, {
    summary: "A small silver spaceship with a blue cockpit and landing gear.",
    colors: { body: 1, cab: 2, wheels: 0, extra: 4 },
    extras: ["antenna"],
    finishes: { body: "metal", cab: "glow", wheels: "rubber", extra: "glow" },
    details: ["seams", "lights", "bolts"],
  });
  body.motions = { version: 1, motions: {} }; // the stock clips name four wheels; this one has two
  body.palette = ["#0b0f1a", "#c9d3e6", "#4f6bff", "#8da2c4", "#ffb347"];
  write("spaceship", body);
}

console.log("wrote 5 recipes to", out);
