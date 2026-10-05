import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { personDocId, dayOf } from "@/lib/ai/key";
import { MemoryUsageLimits } from "@/lib/ai/memory";
import { MemoryJobCache } from "@/lib/blender/memory";
import { makeBlenderService } from "@/lib/blender/service";
import {
  type BlenderJob,
  BlenderRefusedError,
  type BlenderWorker,
  BlenderUnavailableError,
  type BuiltGlb,
  type MadeModel,
  type ModelFormat,
} from "@/lib/blender/types";
import type { BuildBody } from "@/lib/builder/recipes";
import { type DerivedFiles, NodeError } from "@/lib/graph/types";
import { sha256Hex } from "@/lib/runs/service";

const alice = { uid: "alice", email: "alice@punx.ai" };
const bob = { uid: "bob", email: "bob@punx.ai" };
const MADE = new Uint8Array([1, 2, 3, 4]);
const START = Date.UTC(2026, 9, 5, 12, 0, 0);
const OUT_OF_TIME = "Play ran out of time. Press Play again; finished steps are kept, so it carries on.";
const DID_NOT_ANSWER = "The Blender service did not answer. Try again.";

const input = (extra: Partial<{ triangles: number; color: string | null; sha256: string; format: ModelFormat }> = {}) => ({
  sha256: "a".repeat(64),
  bytes: new Uint8Array([9, 9, 9]),
  format: "fbx" as ModelFormat,
  triangles: 2000,
  color: "#ff6f59" as string | null,
  ...extra,
});

function setup(options: { perPerson?: number; total?: number; putFails?: boolean } = {}) {
  const now = START;
  const cache = new MemoryJobCache();
  const limits = new MemoryUsageLimits();
  const calls: { kind: "prepare" | "shape" | "build"; input: Record<string, unknown> }[] = [];
  let reply: () => Promise<MadeModel> = async () => ({ bytes: MADE, trianglesBefore: 9400, trianglesAfter: 2000 });
  let replyBuild: () => Promise<BuiltGlb> = async () => ({ bytes: MADE, triangles: 180, parts: 15, clips: ["Run", "Jump"] });
  const worker: BlenderWorker = {
    prepare: async (i) => {
      calls.push({ kind: "prepare", input: i });
      return reply();
    },
    shape: async (i) => {
      calls.push({ kind: "shape", input: i });
      return reply();
    },
    build: async (i) => {
      calls.push({ kind: "build", input: i });
      return replyBuild();
    },
  };
  const logs: Record<string, unknown>[] = [];
  const stored = new Map<string, Uint8Array>();
  const derived: DerivedFiles = {
    put: async (bytes) => {
      if (options.putFails) throw new Error("storage said: secret path");
      const sha = await sha256Hex(bytes);
      stored.set(sha, bytes);
      return sha;
    },
    recall: async (sha) => stored.has(sha),
  };
  const service = makeBlenderService({
    cache,
    limits,
    worker,
    perPerson: options.perPerson ?? 60,
    total: options.total ?? 600,
    now: () => now,
    log: (info) => logs.push(info as Record<string, unknown>),
  });
  const job = (deadline = now + 270_000, user = alice): BlenderJob => ({ user, graphId: "g1", derived, deadline });
  const count = (uid = "alice") => limits.counts.get(personDocId(uid, dayOf(now))) ?? 0;
  return {
    service,
    cache,
    limits,
    calls,
    logs,
    stored,
    derived,
    job,
    count,
    reply: (f: () => Promise<MadeModel>) => (reply = f),
    replyBuild: (f: () => Promise<BuiltGlb>) => (replyBuild = f),
  };
}

const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

describe("Prepare Model", () => {
  it("makes a prepared model with the worker, stores it, caches it and counts one job", async () => {
    const t = setup();
    const done = await t.service.prepare(t.job(), input());

    const sha = await sha256Hex(MADE);
    expect(done).toEqual({ sha256: sha, size: 4, trianglesBefore: 9400, trianglesAfter: 2000, reused: false });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toEqual({ kind: "prepare", input: { bytes: new Uint8Array([9, 9, 9]), format: "fbx", triangles: 2000, color: "#ff6f59", timeoutMs: 65_000 } });
    expect(t.stored.get(sha)).toEqual(MADE);
    expect([...t.cache.jobs.values()]).toEqual([{ sha256: sha, size: 4, trianglesBefore: 9400, trianglesAfter: 2000, createdAt: START }]);
    expect(t.count()).toBe(1);
  });

  it("answers a repeat from the cache: no worker call, no count, reused", async () => {
    const t = setup();
    await t.service.prepare(t.job(), input());
    const again = await t.service.prepare(t.job(), input());

    expect(again).toMatchObject({ reused: true, size: 4, trianglesBefore: 9400, trianglesAfter: 2000 });
    expect(t.calls).toHaveLength(1);
    expect(t.count()).toBe(1);
  });

  it("treats a cache record whose file is gone as a miss and makes the model again", async () => {
    const t = setup();
    await t.service.prepare(t.job(), input());
    t.stored.clear();

    const again = await t.service.prepare(t.job(), input());

    expect(again.reused).toBe(false);
    expect(t.calls).toHaveLength(2);
    expect(t.count()).toBe(2);
  });

  it("still answers a cache hit when no time is left", async () => {
    const t = setup();
    await t.service.prepare(t.job(), input());
    const again = await t.service.prepare(t.job(START), input());
    expect(again.reused).toBe(true);
  });

  it("says Play ran out of time, calls nothing and takes no count, when a miss has less than 10 seconds left", async () => {
    const t = setup();
    const error = await failure(t.service.prepare(t.job(START + 9_999), input()));

    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(`Prepare Model: ${OUT_OF_TIME}`);
    expect(t.calls).toHaveLength(0);
    expect(t.limits.counts.size).toBe(0);
    expect(t.logs).toEqual([{ step: "prepare-model", outcome: "no-time" }]);
    // exactly 10 seconds is enough to start
    await t.service.prepare(t.job(START + 10_000), input());
    expect(t.calls).toHaveLength(1);
  });

  it("gives the worker 65 seconds, or less when the deadline is nearer", async () => {
    const t = setup();
    await t.service.prepare(t.job(START + 200_000), input({ triangles: 1000 }));
    await t.service.prepare(t.job(START + 20_000), input({ triangles: 1100 }));
    expect(t.calls.map((c) => c.input.timeoutMs)).toEqual([65_000, 20_000]);
  });

  it("says so when the person's or the site's daily jobs are used up, and calls nothing", async () => {
    const t = setup({ perPerson: 2, total: 3 });
    await t.service.prepare(t.job(), input({ triangles: 1000 }));
    await t.service.prepare(t.job(), input({ triangles: 1100 }));

    const mine = await failure(t.service.prepare(t.job(), input({ triangles: 1200 })));
    expect((mine as Error).message).toBe("Prepare Model: You have used today's 2 Blender jobs. Try again tomorrow.");

    await t.service.prepare(t.job(undefined, bob), input({ triangles: 1300 }));
    const busy = await failure(t.service.prepare(t.job(undefined, bob), input({ triangles: 1400 })));
    expect(busy).toBeInstanceOf(NodeError);
    expect((busy as Error).message).toBe("Prepare Model: Blender is busy today. Try again tomorrow.");
    expect(t.calls).toHaveLength(3);
  });

  it.each([
    ["empty", "This file has no 3D shape in it."],
    ["bad-format", "This file could not be read as a GLB, FBX or OBJ."],
    ["too-big", "This file is larger than 32 MB."],
    ["timeout", "This model took longer than 60 seconds. Try a simpler one."],
    ["failed", "This file could not be prepared. Try another one."],
  ] as const)("when Blender refuses the file (%s) it keeps the count and says why", async (code, sentence) => {
    const t = setup();
    t.reply(async () => {
      throw new BlenderRefusedError(code);
    });

    const error = await failure(t.service.prepare(t.job(), input()));

    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(`Prepare Model: ${sentence}`);
    expect(t.count()).toBe(1);
    expect(t.cache.jobs.size).toBe(0);
    expect(t.stored.size).toBe(0);
    expect(t.logs.at(-1)).toEqual({ step: "prepare-model", outcome: "refused", code });
  });

  it.each([
    ["a worker that is down", new BlenderUnavailableError(503), { outcome: "unavailable", status: 503 }],
    ["an unexpected failure", new Error("boom at C:/secret/path"), { outcome: "unexpected", kind: "Error" }],
  ])("when the worker never answers (%s) it gives the count back and says it did not answer", async (_label, thrown, logged) => {
    const t = setup();
    t.reply(async () => {
      throw thrown;
    });

    const error = await failure(t.service.prepare(t.job(), input()));

    expect((error as Error).message).toBe(`Prepare Model: ${DID_NOT_ANSWER}`);
    expect(error).toBeInstanceOf(NodeError);
    expect(t.count()).toBe(0);
    expect(t.logs.at(-1)).toEqual({ step: "prepare-model", ...logged });
    expect(JSON.stringify(t.logs)).not.toContain("secret");
  });

  it("gives the count back and says it did not answer when the result cannot be stored", async () => {
    const t = setup({ putFails: true });
    const error = await failure(t.service.prepare(t.job(), input()));

    expect((error as Error).message).toBe(`Prepare Model: ${DID_NOT_ANSWER}`);
    expect(t.count()).toBe(0);
    expect(t.cache.jobs.size).toBe(0);
    expect(JSON.stringify(t.logs)).not.toContain("secret");
  });

  it("still returns the model when the cache cannot be written", async () => {
    const t = setup();
    t.cache.put = async () => {
      throw new Error("firestore down");
    };
    const done = await t.service.prepare(t.job(), input());
    expect(done.reused).toBe(false);
    expect(t.logs.map((l) => l.outcome)).toContain("cache-write-failed");
  });

  it("does not let a failure giving the count back hide the plain sentence", async () => {
    const t = setup();
    t.limits.give = async () => {
      throw new Error("firestore down");
    };
    t.reply(async () => {
      throw new BlenderUnavailableError();
    });
    const error = await failure(t.service.prepare(t.job(), input()));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(`Prepare Model: ${DID_NOT_ANSWER}`);
  });

  it("lets exactly the limit's worth of simultaneous different jobs reach the worker", async () => {
    const t = setup({ perPerson: 3 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => failure(t.service.prepare(t.job(), input({ triangles: 100 + i })))),
    );

    expect(t.calls).toHaveLength(3);
    expect(results.filter((r) => r === null)).toHaveLength(3);
    const refused = results.filter((r): r is NodeError => r instanceof NodeError);
    expect(refused).toHaveLength(7);
    expect(new Set(refused.map((e) => e.message))).toEqual(new Set(["Prepare Model: You have used today's 3 Blender jobs. Try again tomorrow."]));
  });
});

describe("Make Shape", () => {
  const shape = { shape: "sphere" as const, color: "#06d6a0" };

  it("makes a shape with the worker, and answers a repeat from the cache", async () => {
    const t = setup();
    const first = await t.service.shape(t.job(), shape);
    const again = await t.service.shape(t.job(), shape);

    expect(t.calls).toEqual([{ kind: "shape", input: { shape: "sphere", color: "#06d6a0", timeoutMs: 65_000 } }]);
    expect(first.reused).toBe(false);
    expect(again).toMatchObject({ reused: true, size: 4, trianglesAfter: 2000 });
    expect(t.count()).toBe(1);
  });

  it("is a new job for another shape or another color", async () => {
    const t = setup();
    await t.service.shape(t.job(), shape);
    await t.service.shape(t.job(), { ...shape, shape: "cube" });
    await t.service.shape(t.job(), { ...shape, color: "#06d6a1" });
    expect(t.calls).toHaveLength(3);
  });

  it("says it did not answer, and gives the count back, for any refusal: a shape has no file to be refused", async () => {
    const t = setup();
    t.reply(async () => {
      throw new BlenderRefusedError("failed");
    });
    const error = await failure(t.service.shape(t.job(), shape));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(`Make Shape: ${DID_NOT_ANSWER}`);
    expect(t.count()).toBe(0);
  });

  it("starts its sentences with its own name", async () => {
    const t = setup({ perPerson: 0 });
    const error = await failure(t.service.shape(t.job(), shape));
    expect((error as Error).message).toBe("Make Shape: You have used today's 0 Blender jobs. Try again tomorrow.");
    const late = await failure(setup().service.shape(setup().job(START + 1), shape));
    expect((late as Error).message).toBe(`Make Shape: ${OUT_OF_TIME}`);
  });
});

describe("Build Model and Build Environment", () => {
  const body = JSON.parse(readFileSync(new URL("../../../../blender-worker/fixtures/recipes/biped-default.json", import.meta.url), "utf8")) as BuildBody;
  const model = { label: "Build Model" as const, body };
  const environment = { label: "Build Environment" as const, body };

  it("builds with the worker, stores the GLB, caches it with its parts and clips, and counts one job", async () => {
    const t = setup();
    const done = await t.service.build(t.job(), model);

    const sha = await sha256Hex(MADE);
    expect(done).toEqual({ sha256: sha, size: 4, triangles: 180, parts: 15, clips: ["Run", "Jump"], reused: false });
    expect(t.calls).toEqual([{ kind: "build", input: { body, timeoutMs: 65_000 } }]);
    expect(t.stored.get(sha)).toEqual(MADE);
    expect([...t.cache.jobs.values()]).toEqual([
      { sha256: sha, size: 4, trianglesBefore: null, trianglesAfter: 180, parts: 15, clips: ["Run", "Jump"], createdAt: START },
    ]);
    expect(t.count()).toBe(1);
  });

  it("answers a repeat from the cache: no worker call, no count, reused", async () => {
    const t = setup();
    await t.service.build(t.job(), model);
    const again = await t.service.build(t.job(), model);

    expect(again).toMatchObject({ reused: true, size: 4, triangles: 180, parts: 15, clips: ["Run", "Jump"] });
    expect(t.calls).toHaveLength(1);
    expect(t.count()).toBe(1);
  });

  it("treats a cache record whose file is gone as a miss and builds again", async () => {
    const t = setup();
    await t.service.build(t.job(), model);
    t.stored.clear();

    expect((await t.service.build(t.job(), model)).reused).toBe(false);
    expect(t.calls).toHaveLength(2);
    expect(t.count()).toBe(2);
  });

  it("treats a cache record with no parts or no clips as a miss (a record a prepare job could have left)", async () => {
    const t = setup();
    await t.service.build(t.job(), model);
    const [key, record] = [...t.cache.jobs.entries()][0];
    const withoutParts = { ...record };
    delete withoutParts.parts;
    t.cache.jobs.set(key, withoutParts);
    expect((await t.service.build(t.job(), model)).reused).toBe(false);

    const withoutClips = { ...[...t.cache.jobs.values()][0] };
    delete withoutClips.clips;
    t.cache.jobs.set(key, withoutClips);
    expect((await t.service.build(t.job(), model)).reused).toBe(false);
    expect(t.calls).toHaveLength(3);
  });

  it("says Play ran out of time, calls nothing and takes no count, when a miss has less than 10 seconds left", async () => {
    const t = setup();
    const error = await failure(t.service.build(t.job(START + 9_999), model));

    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(`Build Model: ${OUT_OF_TIME}`);
    expect(t.calls).toHaveLength(0);
    expect(t.limits.counts.size).toBe(0);
    expect(t.logs).toEqual([{ step: "build-model", outcome: "no-time" }]);
    await t.service.build(t.job(START + 10_000), model);
    expect(t.calls).toHaveLength(1);
  });

  it.each([
    ["bad-recipe", "Build Environment: The Blender service could not build this. Try different words."],
    ["timeout", "Build Environment: This took longer than 60 seconds. Try a simpler one."],
    ["empty", `Build Environment: ${DID_NOT_ANSWER}`],
    ["bad-format", `Build Environment: ${DID_NOT_ANSWER}`],
    ["too-big", `Build Environment: ${DID_NOT_ANSWER}`],
    ["failed", `Build Environment: ${DID_NOT_ANSWER}`],
  ] as const)("a %s refusal says its sentence under the step's name, and the count is given back", async (code, sentence) => {
    const t = setup();
    t.replyBuild(async () => {
      throw new BlenderRefusedError(code);
    });
    const error = await failure(t.service.build(t.job(), environment));

    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(sentence);
    expect(t.count()).toBe(0);
    expect(t.logs).toEqual([{ step: "build-environment", outcome: "refused", code }]);
  });

  it("says the service did not answer, and gives the count back, when the worker is unavailable, throws or cannot store", async () => {
    const t = setup();
    t.replyBuild(async () => {
      throw new BlenderUnavailableError(503);
    });
    expect(((await failure(t.service.build(t.job(), model))) as Error).message).toBe(`Build Model: ${DID_NOT_ANSWER}`);
    t.replyBuild(async () => {
      throw new TypeError("boom: C:/secret/path");
    });
    expect(((await failure(t.service.build(t.job(), model))) as Error).message).toBe(`Build Model: ${DID_NOT_ANSWER}`);
    expect(t.count()).toBe(0);

    const failing = setup({ putFails: true });
    expect(((await failure(failing.service.build(failing.job(), model))) as Error).message).toBe(`Build Model: ${DID_NOT_ANSWER}`);
    expect(failing.count()).toBe(0);
  });

  it("says the person and site limit sentences under the step's name, and builds nothing", async () => {
    const person = setup({ perPerson: 0 });
    expect(((await failure(person.service.build(person.job(), environment))) as Error).message).toBe(
      "Build Environment: You have used today's 0 Blender jobs. Try again tomorrow.",
    );
    const site = setup({ total: 0 });
    expect(((await failure(site.service.build(site.job(), model))) as Error).message).toBe("Build Model: Blender is busy today. Try again tomorrow.");
    expect(person.calls).toHaveLength(0);
    expect(site.calls).toHaveLength(0);
  });

  it("makes a new build when only the palette changes, and the same build when the keys come in another order", async () => {
    const t = setup();
    await t.service.build(t.job(), model);
    const repainted = structuredClone(body);
    repainted.palette[0] = "#000001";
    await t.service.build(t.job(), { label: "Build Model", body: repainted });
    expect(t.calls).toHaveLength(2);

    const reordered = { palette: body.palette, motions: body.motions, recipe: { ...body.recipe } } as BuildBody;
    expect((await t.service.build(t.job(), { label: "Build Model", body: reordered })).reused).toBe(true);
    expect(t.calls).toHaveLength(2);
  });

  it("logs nothing of the recipe: not its summary, a joint's name or a number from it", async () => {
    const t = setup();
    await t.service.build(t.job(), model);
    await t.service.build(t.job(), model);
    t.replyBuild(async () => {
      throw new BlenderRefusedError("bad-recipe");
    });
    const other = structuredClone(body);
    other.palette[1] = "#000002";
    await failure(t.service.build(t.job(), { label: "Build Model", body: other }));

    const text = JSON.stringify(t.logs);
    expect(text).not.toContain("summary");
    expect(text).not.toContain(body.recipe.summary);
    expect(text).not.toContain("thigh");
    expect(text).not.toContain("#");
    expect(t.logs.map((l) => l.outcome)).toEqual(["made", "reused", "refused"]);
  });
});

describe("what is logged", () => {
  it("is the step, the outcome, a code, a status, a kind of error and numbers: never bytes, names or messages", async () => {
    const t = setup();
    await t.service.prepare(t.job(), input({ triangles: 1000 }));
    await t.service.prepare(t.job(), input({ triangles: 1000 }));
    t.reply(async () => {
      throw new BlenderRefusedError("empty");
    });
    await failure(t.service.prepare(t.job(), input({ triangles: 1200 })));
    t.reply(async () => {
      throw new BlenderUnavailableError(502);
    });
    await failure(t.service.prepare(t.job(), input({ triangles: 1300 })));

    const allowed = new Set(["step", "outcome", "code", "status", "kind", "trianglesAfter", "size"]);
    for (const entry of t.logs) expect(Object.keys(entry).every((k) => allowed.has(k))).toBe(true);
    expect(t.logs.map((l) => l.outcome)).toEqual(["made", "reused", "refused", "unavailable"]);
  });
});
