// The game-level budgets of the High tier (the spec's "Game-level budgets"), added up from the real files of a High game: the Unity sample
// sample-world-high is real build.py output (a toy-robot hero, a vehicle obstacle, a gem collectible, three scenery pieces and the desert world's
// terrain, road and backdrop), and the web fixtures are the same builds. If these break, the kit's caps or the builders are wrong, not this test.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GAME = fileURLToPath(new URL("../../../../unity/runner-template/Assets/StreamingAssets/sample-world-high/", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../blender/fixtures/high/", import.meta.url));

// The budgets (spec, "Game-level budgets"): the run folder, the vertices the game decodes, and what is drawn at once.
const RUN_FOLDER_BYTES = 1.5 * 1024 * 1024;
const RUN_FOLDER_VERTICES = 60_000;
const VISIBLE_TRIANGLES = 100_000;

interface Counts {
  triangles: number;
  vertices: number;
  bytes: number;
}

/** What a GLB holds, read from the file itself: the shared vertices (the POSITION accessors) and the triangles (the index accessors). */
function countsOf(path: string): Counts {
  const data = readFileSync(path);
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8")) as {
    meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
    accessors: { count: number }[];
  };
  let triangles = 0;
  let vertices = 0;
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      vertices += gltf.accessors[primitive.attributes.POSITION].count;
      triangles += gltf.accessors[primitive.indices].count / 3;
    }
  }
  return { triangles, vertices, bytes: statSync(path).size };
}

const game = Object.fromEntries(readdirSync(GAME).filter((f) => f.endsWith(".glb")).map((f) => [f.replace(/\.glb$/, ""), countsOf(GAME + f)]));
const sum = (parts: Counts[], key: keyof Counts) => parts.reduce((total, part) => total + part[key], 0);

describe("the sample High game is a whole game", () => {
  it("has a hero, an obstacle, a collectible, three scenery pieces and the world's three files", () => {
    expect(Object.keys(game).sort()).toEqual(["backdrop", "coin", "hero", "obstacle", "road", "scenery1", "scenery2", "scenery3", "terrain"]);
  });
});

describe("the run folder of a High game", () => {
  it(`is at most ${RUN_FOLDER_BYTES} bytes (1.5 MB)`, () => {
    const total = sum(Object.values(game), "bytes");
    expect(total).toBeLessThanOrEqual(RUN_FOLDER_BYTES);
  });

  it(`holds at most ${RUN_FOLDER_VERTICES} vertices altogether (what the game decodes before it can start)`, () => {
    const total = sum(Object.values(game), "vertices");
    expect(total).toBeLessThanOrEqual(RUN_FOLDER_VERTICES);
  });

  it("keeps each file within its own caps (the kit's), so the whole is no surprise", () => {
    // a hero 12,000 triangles and 9,500 vertices at most; the three world pieces their own limits
    expect(game.hero.triangles).toBeLessThanOrEqual(12_000);
    expect(game.hero.vertices).toBeLessThanOrEqual(9_500);
    expect(game.terrain.triangles).toBeLessThanOrEqual(8_000);
    expect(game.terrain.vertices).toBeLessThanOrEqual(4_200);
    expect(game.road.triangles).toBeLessThanOrEqual(1_500);
    expect(game.road.vertices).toBeLessThanOrEqual(1_200);
    expect(game.backdrop.triangles).toBeLessThanOrEqual(1_200);
    expect(game.backdrop.vertices).toBeLessThanOrEqual(700);
    for (const piece of ["scenery1", "scenery2", "scenery3"]) {
      expect(game[piece].triangles, piece).toBeLessThanOrEqual(1_500);
      expect(game[piece].vertices, piece).toBeLessThanOrEqual(1_200);
    }
  });
});

describe("what is drawn at once in a High game", () => {
  // The hero, 6 obstacles and 6 collectibles on screen, 16 scenery pieces (the pool at density "lots" is about 24, and what the camera sees
  // is fewer), the terrain tile and a half, the road tile and the backdrop. Each scenery piece is counted as the biggest of the three.
  const scenery = Math.max(game.scenery1.triangles, game.scenery2.triangles, game.scenery3.triangles);
  const visible = (terrainTiles: number) =>
    game.hero.triangles + 6 * game.obstacle.triangles + 6 * game.coin.triangles + 16 * scenery + terrainTiles * game.terrain.triangles + game.road.triangles + game.backdrop.triangles;

  it(`is at most ${VISIBLE_TRIANGLES} triangles`, () => {
    expect(visible(1.5)).toBeLessThanOrEqual(VISIBLE_TRIANGLES);
  });

  it("is still within the budget when all three terrain tiles are in view, so the third tile does not break it", () => {
    expect(visible(3)).toBeLessThanOrEqual(VISIBLE_TRIANGLES);
  });

  it("leaves room: even with every obstacle, collectible and scenery piece drawn at the biggest one, it is within the budget", () => {
    const worst = game.hero.triangles + 12 * Math.max(game.obstacle.triangles, game.coin.triangles) + 24 * scenery + 3 * game.terrain.triangles + 3 * game.road.triangles + game.backdrop.triangles;
    expect(worst).toBeLessThanOrEqual(VISIBLE_TRIANGLES);
  });
});

describe("the web fixtures and their stats", () => {
  it("say what the GLBs hold (the worker's headers are what the cards show, so they must be true)", () => {
    const stats = readdirSync(FIXTURES).filter((f) => f.endsWith(".stats.json"));
    expect(stats.length).toBeGreaterThanOrEqual(6);
    for (const file of stats) {
      const said = JSON.parse(readFileSync(FIXTURES + file, "utf8")) as { triangles: number; vertices: number };
      const real = countsOf(FIXTURES + file.replace(/\.stats\.json$/, ".glb"));
      expect(real.triangles, file).toBe(said.triangles);
      expect(real.vertices, file).toBe(said.vertices);
    }
  });

  it("agree with the sample game, which is built from the same recipes", () => {
    const fixture = (name: string) => countsOf(FIXTURES + name);
    expect(fixture("built-biped-high.glb")).toEqual(game.hero);
    expect(fixture("world-terrain-desert.glb")).toEqual(game.terrain);
    expect(fixture("world-road-desert.glb")).toEqual(game.road);
    expect(fixture("world-backdrop-desert.glb")).toEqual(game.backdrop);
  });
});
