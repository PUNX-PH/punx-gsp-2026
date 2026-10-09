// The art gate (slice 9, Task 1): builds each reference recipe in fixtures/recipes/art with the worker's own build script, renders it with
// render-preview.py, and writes the pictures and the real numbers (triangles, parts, file size) to docs/superpowers/notes/art-gate/.
// Usage, from the repo root: node blender-worker/tools/art-gate.mjs [name ...]     (Blender: BLENDER env var, or the default install path)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const recipes = join(here, "..", "fixtures", "recipes", "art");
const out = join(root, "docs", "superpowers", "notes", "art-gate");
mkdirSync(out, { recursive: true });

const blender = process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe";
if (!existsSync(blender)) throw new Error(`Blender not found at ${blender}; set BLENDER`);

const only = process.argv.slice(2);
const names = readdirSync(recipes).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((n) => only.length === 0 || only.includes(n));
// a run of some of the recipes keeps what the earlier runs wrote for the others
const summaryFile = join(out, "summary.json");
const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : {};

for (const name of names) {
  const glb = join(out, `${name}.glb`);
  const stats = join(out, `${name}.stats.json`);
  const build = spawnSync(blender, ["-b", "--factory-startup", "--disable-autoexec", "-noaudio", "--python-exit-code", "1", "-P", join(here, "..", "scripts", "build.py"), "--", "--recipe", join(recipes, `${name}.json`), "--out", glb, "--stats", stats], { encoding: "utf8" });
  if (build.status !== 0) {
    console.log(`${name}: BUILD FAILED (exit ${build.status})\n${(build.stdout + build.stderr).split("\n").slice(-8).join("\n")}`);
    summary[name] = { build: `failed, exit ${build.status}` };
    continue;
  }
  const png = join(out, `${name}.png`);
  const render = spawnSync(blender, ["-b", "--factory-startup", "-noaudio", "--python-exit-code", "1", "-P", join(here, "render-preview.py"), "--", glb, png, "900"], { encoding: "utf8" });
  const numbers = JSON.parse(readFileSync(stats, "utf8"));
  summary[name] = { ...numbers, bytes: statSync(glb).size, render: render.status === 0 ? `${name}.png` : `failed, exit ${render.status}` };
  console.log(`${name}: ${numbers.triangles} triangles, ${numbers.parts} parts, ${(summary[name].bytes / 1024).toFixed(0)} KB, render ${summary[name].render}`);
}

writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
