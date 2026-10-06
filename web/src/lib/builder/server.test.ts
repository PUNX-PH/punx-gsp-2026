import { afterEach, describe, expect, it, vi } from "vitest";
import { dayOf } from "@/lib/ai/key";
import { MemoryUsageLimits } from "@/lib/ai/memory";
import type { BlenderJob, BlenderService } from "@/lib/blender/types";
import { designKey } from "@/lib/builder/keys";
import { MemoryRecipeCache } from "@/lib/builder/memory";
import { defaultRecipe, type ModelRecipe, type MotionRecipe, type Skipped } from "@/lib/builder/recipes";
import { getBuilderService } from "@/lib/builder/server";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type DerivedFiles, NodeError } from "@/lib/graph/types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const jobWithTime = (): BlenderJob => ({ user: { uid: "alice", email: "alice@punx.ai" }, graphId: "g1", derived: {} as DerivedFiles, deadline: Date.now() + 200_000 });
const input = (description: string) => ({
  role: "hero" as const,
  kind: "biped" as const,
  description,
  motions: { run: "", jump: "", loop: "" },
  picture: null,
  palette: SAMPLE_PALETTE,
});

function fakeBlender() {
  const builds: string[] = [];
  const blender: BlenderService = {
    async prepare() {
      throw new Error("not used");
    },
    async shape() {
      throw new Error("not used");
    },
    async build(_job, request) {
      builds.push(request.label);
      return { sha256: "e".repeat(64), size: 100, triangles: 180, parts: 15, clips: ["Run", "Jump"], reused: false };
    },
  };
  return { blender, builds };
}

/** Stores that are only in memory, so nothing reaches Firestore. */
function memoryStores() {
  return {
    designs: new MemoryRecipeCache<ModelRecipe>(),
    motions: new MemoryRecipeCache<{ motions: MotionRecipe; skipped: Skipped[] }>(),
    limits: new MemoryUsageLimits(),
  };
}

describe("getBuilderService", () => {
  it("is made with no environment at all, without throwing or reading a key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_MODEL", "");
    expect(() => getBuilderService(fakeBlender().blender, memoryStores())).not.toThrow();
  });

  it("builds an empty biped through the Blender service it is given, with no AI and no AI count", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { blender, builds } = fakeBlender();
    const stores = memoryStores();
    const built = await getBuilderService(blender, stores).buildModel(jobWithTime(), input(""));

    expect(builds).toEqual(["Build Model"]);
    expect(built).toMatchObject({ kind: "biped", parts: 15, triangles: 180, clips: ["Run", "Jump"], skipped: [], reused: false });
    expect(stores.limits.counts.size).toBe(0);
  });

  it("says the AI service did not answer when a description needs Claude and there is no key, and gives the AI count back", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { blender, builds } = fakeBlender();
    const stores = memoryStores();
    const error = await getBuilderService(blender, stores)
      .buildModel(jobWithTime(), input("a red fox in a scarf"))
      .then(() => null, (e: unknown) => e);

    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("Build Model: The AI service did not answer. Try again.");
    expect(builds).toHaveLength(0);
    expect(stores.limits.counts.get(`site_${dayOf(Date.now())}`) ?? 0).toBe(0);
  });

  it("says the same for a motion box with no key, and gives that count back too", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { blender } = fakeBlender();
    const stores = memoryStores();
    const error = await getBuilderService(blender, stores)
      .buildModel(jobWithTime(), { ...input(""), motions: { run: "gallop like a horse", jump: "", loop: "" } })
      .then(() => null, (e: unknown) => e);

    expect((error as Error).message).toBe("Build Model: The AI service did not answer. Try again.");
    expect(stores.limits.counts.get(`site_${dayOf(Date.now())}`) ?? 0).toBe(0);
  });

  it("never needs the key for an answer that is already cached", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_MODEL", "");
    const { blender, builds } = fakeBlender();
    const stores = memoryStores();
    const key = await designKey({ model: "claude-sonnet-5-5", uid: "alice", description: "a red fox in a scarf", kind: "biped", role: "hero", pictureSha: null });
    await stores.designs.put(key, {
      value: { ...defaultRecipe("biped"), summary: "A red fox in a scarf." },
      model: "claude-sonnet-5-5",
      createdAt: 1,
      inputTokens: 1,
      outputTokens: 1,
    });

    const built = await getBuilderService(blender, stores).buildModel(jobWithTime(), input("a red fox in a scarf"));
    expect(built).toMatchObject({ kind: "biped", summary: "A red fox in a scarf." });
    expect(builds).toEqual(["Build Model"]);
    expect(stores.limits.counts.size).toBe(0);
  });

  it("keys the cache by the model the environment names", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_MODEL", "claude-opus-5-5");
    const { blender } = fakeBlender();
    const stores = memoryStores();
    const key = await designKey({ model: "claude-sonnet-5-5", uid: "alice", description: "a red fox", kind: "biped", role: "hero", pictureSha: null });
    await stores.designs.put(key, { value: defaultRecipe("biped"), model: "claude-sonnet-5-5", createdAt: 1, inputTokens: 1, outputTokens: 1 });

    // the answer cached for another model is not used: with no key, Claude cannot be asked
    const error = await getBuilderService(blender, stores).buildModel(jobWithTime(), input("a red fox")).then(() => null, (e: unknown) => e);
    expect((error as Error).message).toBe("Build Model: The AI service did not answer. Try again.");
  });
});
