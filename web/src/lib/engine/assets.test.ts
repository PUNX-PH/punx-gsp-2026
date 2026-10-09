import { describe, expect, it } from "vitest";
import type { BlenderJob } from "@/lib/blender/types";
import type { BuiltModel } from "@/lib/builder/types";
import { NodeError } from "@/lib/graph/types";
import { designEntityAssets } from "./assets";
import type { AssetRequest } from "./service";

const NOW = 1_000_000;
const job = { user: { uid: "u" }, graphId: "g", derived: {}, deadline: NOW + 120_000 } as unknown as BlenderJob;
const palette = ["#111111", "#222222", "#333333", "#444444", "#555555"];
const request = (entity: string, role: AssetRequest["role"] = "hero"): AssetRequest => ({ entity, role, kind: "biped", description: `a ${entity}` });
const built = (sha256: string): BuiltModel => ({ sha256, size: 1, kind: "biped", parts: 1, triangles: 1, clips: [], summary: "", skipped: [], reused: false });

describe("designEntityAssets", () => {
  it("builds one model per request with the game's palette, names each file for its entity, and builds nothing for an empty list", async () => {
    const calls: unknown[] = [];
    const builder = { buildModel: async (_job: BlenderJob, input: unknown) => (calls.push(input), built(String(calls.length).padStart(64, "0"))) };
    const done = await designEntityAssets(builder, job, [request("hero"), request("rock", "obstacle")], palette, () => NOW);
    expect(done.files).toEqual([
      { file: "entity-hero.glb", sha256: "0".repeat(63) + "1" },
      { file: "entity-rock.glb", sha256: "0".repeat(63) + "2" },
    ]);
    expect(done.fallbacks).toEqual([]);
    expect(calls[0]).toMatchObject({ role: "hero", kind: "freeform", description: "a hero", palette, picture: null, motions: { run: "", jump: "", loop: "" } });
    expect(await designEntityAssets(builder, job, [], palette, () => NOW)).toEqual({ files: [], fallbacks: [] });
  });

  it("falls back for an entity whose build failed, with the step's own sentence, and goes on to the next", async () => {
    let n = 0;
    const builder = {
      buildModel: async () => {
        n++;
        if (n === 1) throw new NodeError("Build Model: You have used today's Blender builds. Try again tomorrow.");
        if (n === 2) throw new TypeError("boom: secret detail");
        return built("a".repeat(64));
      },
    };
    const done = await designEntityAssets(builder, job, [request("a"), request("b"), request("c")], palette, () => NOW);
    expect(done.fallbacks).toEqual([
      { entity: "a", message: "You have used today's Blender builds. Try again tomorrow." },
      { entity: "b", message: "it could not be built." },
    ]);
    expect(done.files).toEqual([{ file: "entity-c.glb", sha256: "a".repeat(64) }]);
    expect(JSON.stringify(done)).not.toContain("secret");
  });

  it("starts no build when Play's clock could not finish it", async () => {
    let called = 0;
    const builder = { buildModel: async () => (called++, built("b".repeat(64))) };
    const done = await designEntityAssets(builder, { ...job, deadline: NOW + 5_000 }, [request("a")], palette, () => NOW);
    expect(called).toBe(0);
    expect(done.fallbacks).toEqual([{ entity: "a", message: "there was no time left to build it." }]);
  });

  it("builds at most six, and says the rest are plain shapes", async () => {
    let called = 0;
    const builder = { buildModel: async () => (called++, built("c".repeat(64))) };
    const requests = Array.from({ length: 8 }, (_, i) => request(`e${i}`));
    const done = await designEntityAssets(builder, job, requests, palette, () => NOW);
    expect(called).toBe(6);
    expect(done.files).toHaveLength(6);
    expect(done.fallbacks.map((f) => f.entity)).toEqual(["e6", "e7"]);
  });
});
