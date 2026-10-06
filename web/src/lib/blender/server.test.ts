import { afterEach, describe, expect, it, vi } from "vitest";
import { dayOf, personDocId } from "@/lib/ai/key";
import { MemoryUsageLimits } from "@/lib/ai/memory";
import { MemoryJobCache } from "@/lib/blender/memory";
import { blenderConfigFromEnv, getBlenderService } from "@/lib/blender/server";
import { NodeError } from "@/lib/graph/types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("blenderConfigFromEnv", () => {
  it("has the defaults when nothing is set: 60 jobs a person a day, 600 for the site", () => {
    expect(blenderConfigFromEnv({})).toEqual({ perPerson: 60, total: 600 });
  });

  it("takes the two limits from the environment", () => {
    expect(blenderConfigFromEnv({ BLENDER_DAILY_LIMIT_PER_PERSON: "5", BLENDER_DAILY_LIMIT_TOTAL: "50" })).toEqual({ perPerson: 5, total: 50 });
  });

  it.each([["empty", ""], ["text", "abc"], ["negative", "-5"], ["fractional", "1.5"], ["with spaces", " 7 "], ["scientific", "1e3"], ["unset", undefined]])(
    "falls back to the default for a limit that is %s",
    (_label, value) => {
      expect(blenderConfigFromEnv({ BLENDER_DAILY_LIMIT_PER_PERSON: value, BLENDER_DAILY_LIMIT_TOTAL: value })).toEqual({ perPerson: 60, total: 600 });
    },
  );

  it("accepts 0 (a way to switch Blender off for everyone)", () => {
    expect(blenderConfigFromEnv({ BLENDER_DAILY_LIMIT_PER_PERSON: "0" })).toMatchObject({ perPerson: 0 });
  });
});

describe("getBlenderService", () => {
  const alice = { uid: "alice", email: "alice@punx.ai" };
  const fakes = () => ({ cache: new MemoryJobCache(), limits: new MemoryUsageLimits() });
  const job = () => ({
    user: alice,
    graphId: "g1",
    derived: { put: async () => "a".repeat(64), recall: async () => true },
    deadline: Date.now() + 270_000,
  });
  const prepare = { sha256: "b".repeat(64), bytes: new Uint8Array([1, 2, 3]), format: "fbx" as const, triangles: 2000, color: null };

  it("can be made with nothing in the environment: nothing is read or connected until a job is asked for", () => {
    vi.stubEnv("BLENDER_WORKER_URL", "");
    vi.stubEnv("BLENDER_WORKER_KEY", "");
    expect(() => getBlenderService(fakes())).not.toThrow();
  });

  it.each([
    ["no address and no key", "", ""],
    ["an address and no key", "https://worker.example", ""],
    ["a key and no address", "", "{}"],
    ["an address that is not one", "not a url", "{}"],
    ["a key that is not JSON", "https://worker.example", "not json"],
  ])("with %s, says the Blender service is not set up, in plain words, and gives the count back", async (_label, url, key) => {
    vi.stubEnv("BLENDER_WORKER_URL", url);
    vi.stubEnv("BLENDER_WORKER_KEY", key);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stores = fakes();
    const service = getBlenderService(stores);

    const failure = await service.prepare(job(), prepare).then(() => null, (e: unknown) => e);

    expect(failure).toEqual(new NodeError("Prepare Model: The Blender service is not set up on this site yet."));
    expect(stores.limits.counts.get(personDocId("alice", dayOf(Date.now())))).toBe(0);
  });

  it("says the same for Make Shape", async () => {
    vi.stubEnv("BLENDER_WORKER_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = await getBlenderService(fakes()).shape(job(), { shape: "cube", color: "#06d6a0" }).then(() => null, (e: unknown) => e);
    expect(failure).toEqual(new NodeError("Make Shape: The Blender service is not set up on this site yet."));
  });

  it("says the same for a build", async () => {
    vi.stubEnv("BLENDER_WORKER_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const build = { label: "Build Model" as const, body: { recipe: { kind: "biped" } } as never };
    const failure = await getBlenderService(fakes()).build(job(), build).then(() => null, (e: unknown) => e);
    expect(failure).toEqual(new NodeError("Build Model: The Blender service is not set up on this site yet."));
  });
});
