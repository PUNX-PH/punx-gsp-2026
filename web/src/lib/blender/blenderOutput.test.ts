// The contract between the worker and the app, pinned with real output: GLBs written by the real scripts in real Blender (see
// blender-worker/scripts; regenerate them with the commands in blender-worker/README.md when the scripts change). They must pass the
// same GLB check every other model in the app passes (Preview stores only GLBs that do), and the client must take them as they are.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeBlenderWorker } from "@/lib/blender/client";
import type { BuildBody } from "@/lib/builder/recipes";
import { checkGlb } from "@/lib/glb";

const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const FIXTURES = [
  ["prepared-cube.glb", "12"],
  ["ring.glb", "144"],
] as const;

describe("what Blender really writes", () => {
  it.each(FIXTURES)("%s passes the app's own GLB check", (name) => {
    expect(checkGlb(name, load(name))).toEqual({ ok: true });
  });

  it.each(FIXTURES)("%s is accepted by the client, with its triangle count", async (name, triangles) => {
    const bytes = load(name);
    const worker = makeBlenderWorker({
      baseUrl: "https://worker.example",
      getIdToken: async () => "tok",
      fetch: (async () => new Response(bytes as BodyInit, { status: 200, headers: { "X-Triangles-After": triangles } })) as unknown as typeof fetch,
    });

    const made = await worker.shape({ shape: "ring", color: "#06d6a0", timeoutMs: 5000 });

    expect(made.bytes).toEqual(bytes);
    expect(made.trianglesAfter).toBe(Number(triangles));
  });
});

// What build.py really writes: a character with a skeleton and clips, a prop and a tree, with the counts and clip names the worker sends for them
// (the worker's fixtures/recipes/expected.json, which Blender's own tests check against build.py's output).
describe("what build.py really writes", () => {
  const recipes = new URL("../../../../blender-worker/fixtures/recipes/", import.meta.url);
  const expected = JSON.parse(readFileSync(new URL("expected.json", recipes), "utf8")) as Record<string, { parts: number; triangles: number; clips: string[] }>;
  const BUILT = [
    ["built-biped.glb", "biped-default.json"],
    ["built-prop.glb", "prop-default.json"],
    ["built-tree.glb", "scenery-tree.json"],
  ] as const;

  it.each(BUILT)("%s passes the app's own GLB check", (name) => {
    expect(checkGlb(name, load(name))).toEqual({ ok: true });
  });

  it.each(BUILT)("%s is accepted by the client's build, with the counts and clips the worker sends", async (name, recipeFile) => {
    const bytes = load(name);
    const want = expected[recipeFile];
    const headers = { "X-Triangles": String(want.triangles), "X-Parts": String(want.parts), "X-Clips": want.clips.join(",") };
    const worker = makeBlenderWorker({
      baseUrl: "https://worker.example",
      getIdToken: async () => "tok",
      fetch: (async () => new Response(bytes as BodyInit, { status: 200, headers })) as unknown as typeof fetch,
    });
    const body = JSON.parse(readFileSync(new URL(recipeFile, recipes), "utf8")) as BuildBody;

    const made = await worker.build({ body, timeoutMs: 5000 });

    expect(made.bytes).toEqual(bytes);
    expect(made).toMatchObject({ triangles: want.triangles, parts: want.parts, clips: want.clips });
  });
});

// The High tier's real output (finishes, vertex colors, merged joints): the GLBs of three High models and the three pieces of the world, and the stats build.py wrote beside each
// (what the worker sends in its headers). The kit's estimate for the same recipe must be what the real build came to.
describe("what build.py really writes in High", () => {
  const recipes = new URL("../../../../blender-worker/fixtures/recipes/high/", import.meta.url);
  const expected = JSON.parse(readFileSync(new URL("expected-high.json", recipes), "utf8")) as Record<string, { parts: number; triangles: number; vertices: number; clips: string[] }>;
  type Stats = { triangles: number; vertices: number; parts: number; meshes: number; clips: string[] };
  const stats = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/high/${name}.stats.json`, import.meta.url), "utf8")) as Stats;
  const BUILT = [
    ["built-biped-high", "biped-high-default.json"],
    ["built-prop-high", "prop-high-default.json"],
    ["built-lamp-high", "scenery-lamp-high.json"],
    ["world-terrain-desert", "world-terrain-desert.json"],
    ["world-road-desert", "world-road-desert.json"],
    ["world-backdrop-desert", "world-backdrop-desert.json"],
  ] as const;

  it.each(BUILT)("%s passes the app's own GLB check", (name) => {
    expect(checkGlb(name, load(`high/${name}.glb`))).toEqual({ ok: true });
  });

  it.each(BUILT)("%s came to what the kit's estimate said (within 10 percent; for a world piece, at most it and at least half of it)", (name, recipeFile) => {
    const real = stats(name);
    const want = expected[recipeFile];
    expect(real.parts).toBe(want.parts);
    if (recipeFile.startsWith("world-")) {
      // the kit's number for a world piece is the larger of its two styles', since the styles build different shapes
      expect(real.triangles).toBeLessThanOrEqual(want.triangles);
      expect(real.vertices).toBeLessThanOrEqual(want.vertices);
      expect(real.triangles).toBeGreaterThanOrEqual(want.triangles * 0.5);
      expect(real.vertices).toBeGreaterThanOrEqual(want.vertices * 0.5);
    } else {
      expect(Math.abs(real.triangles - want.triangles)).toBeLessThanOrEqual(want.triangles * 0.1);
      expect(Math.abs(real.vertices - want.vertices)).toBeLessThanOrEqual(want.vertices * 0.1);
    }
    expect(real.clips).toEqual(want.clips);
  });

  it.each(BUILT)("%s is accepted by the client's build, with the counts and clips the worker sends", async (name, recipeFile) => {
    const bytes = load(`high/${name}.glb`);
    const real = stats(name);
    const headers = { "X-Triangles": String(real.triangles), "X-Parts": String(real.parts), "X-Clips": real.clips.join(","), "X-Vertices": String(real.vertices) };
    const worker = makeBlenderWorker({
      baseUrl: "https://worker.example",
      getIdToken: async () => "tok",
      fetch: (async () => new Response(bytes as BodyInit, { status: 200, headers })) as unknown as typeof fetch,
    });
    const body = JSON.parse(readFileSync(new URL(recipeFile, recipes), "utf8")) as BuildBody;

    const made = await worker.build({ body, timeoutMs: 5000 });

    expect(made.bytes).toEqual(bytes);
    expect(made).toMatchObject({ triangles: real.triangles, parts: real.parts, clips: real.clips });
  });
});
