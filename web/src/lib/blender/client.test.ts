import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeBlenderWorker } from "@/lib/blender/client";
import { BlenderRefusedError, BlenderUnavailableError } from "@/lib/blender/types";
import type { BuildBody } from "@/lib/builder/recipes";
import { builtinModel } from "@/lib/graph/builtin";
import { makeGlb } from "@/lib/testing/glb";

const GLB = builtinModel("hero");
const BASE = "https://worker.example";
type Handler = (url: string, init: RequestInit) => Promise<Response>;

function setup(handler: Handler, options: { baseUrl?: string; token?: () => Promise<string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  const worker = makeBlenderWorker({ baseUrl: options.baseUrl ?? BASE, getIdToken: options.token ?? (async () => "tok"), fetch: fetchStub });
  return { worker, calls };
}

const ok = (headers: Record<string, string> = { "X-Triangles-Before": "9400", "X-Triangles-After": "2000" }, body: Uint8Array = GLB) =>
  new Response(body as BodyInit, { status: 200, headers: { "Content-Type": "model/gltf-binary", ...headers } });
const refusal = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
const prepareInput = { bytes: new Uint8Array([1, 2, 3]), format: "fbx" as const, triangles: 2000, color: "#ff6f59" as string | null, timeoutMs: 5000 };
const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

describe("prepare", () => {
  it("posts the file to /prepare with the settings in the query and the token in the header, and returns the GLB and its counts", async () => {
    const { worker, calls } = setup(async () => ok());

    const made = await worker.prepare(prepareInput);

    expect(made).toEqual({ bytes: GLB, trianglesBefore: 9400, trianglesAfter: 2000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://worker.example/prepare?format=fbx&triangles=2000&color=%23ff6f59");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ authorization: "Bearer tok", "content-type": "application/octet-stream" });
    expect(calls[0].init.body).toEqual(prepareInput.bytes);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("asks for the model's own colors with color=original, and tolerates a slash at the end of the address", async () => {
    const { worker, calls } = setup(async () => ok(), { baseUrl: "https://worker.example/" });
    await worker.prepare({ ...prepareInput, color: null });
    expect(calls[0].url).toBe("https://worker.example/prepare?format=fbx&triangles=2000&color=original");
  });

  it("takes a missing or unreadable before-count as null, and keeps the after-count", async () => {
    const variants: Record<string, string>[] = [{ "X-Triangles-After": "2000" }, { "X-Triangles-Before": "abc", "X-Triangles-After": "2000" }];
    for (const headers of variants) {
      const { worker } = setup(async () => ok(headers));
      expect(await worker.prepare(prepareInput)).toMatchObject({ trianglesBefore: null, trianglesAfter: 2000 });
    }
  });
});

describe("shape", () => {
  it("posts the shape and color as JSON to /shape", async () => {
    const { worker, calls } = setup(async () => ok({ "X-Triangles-After": "80" }));

    const made = await worker.shape({ shape: "sphere", color: "#06d6a0", timeoutMs: 5000 });

    expect(made).toEqual({ bytes: GLB, trianglesBefore: null, trianglesAfter: 80 });
    expect(calls[0].url).toBe("https://worker.example/shape");
    expect(calls[0].init.headers).toEqual({ authorization: "Bearer tok", "content-type": "application/json" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ shape: "sphere", color: "#06d6a0" });
  });
});

describe("when the worker says no to the file", () => {
  it.each([
    [413, "too-big"],
    [415, "bad-format"],
    [422, "empty"],
    [504, "timeout"],
    [500, "failed"],
  ] as const)("a %s with { error: %s } is Blender refusing it", async (status, code) => {
    const { worker } = setup(async () => refusal(status, code));
    const error = await failure(worker.prepare(prepareInput));
    expect(error).toBeInstanceOf(BlenderRefusedError);
    expect((error as BlenderRefusedError).code).toBe(code);
  });
});

describe("when the worker did not really answer", () => {
  it.each([[400, "bad-request"], [401, "x"], [403, "x"], [404, "x"], [502, "x"], [503, "x"], [413, "empty"], [500, "empty"]])(
    "a %s with { error: %s } is unavailable, with the status",
    async (status, code) => {
      const { worker } = setup(async () => refusal(status, code));
      const error = await failure(worker.prepare(prepareInput));
      expect(error).toBeInstanceOf(BlenderUnavailableError);
      expect((error as BlenderUnavailableError).status).toBe(status);
    },
  );

  it("keeps nothing of what a failing response says", async () => {
    const { worker } = setup(async () => new Response("Traceback at C:/secret/path: the key is sk-123", { status: 500 }));
    const error = (await failure(worker.prepare(prepareInput))) as BlenderUnavailableError;
    expect(error).toBeInstanceOf(BlenderUnavailableError);
    expect(error.status).toBe(500);
    expect(JSON.stringify({ message: error.message, name: error.name, status: error.status })).not.toContain("secret");
  });

  it.each([
    ["an empty body", () => ok(undefined, new Uint8Array(0))],
    ["a body that is not a GLB", () => ok(undefined, new TextEncoder().encode("hello, not a model"))],
    ["a GLB that points at a file (a uri)", () => ok(undefined, makeGlb({ asset: { version: "2.0" }, buffers: [{ uri: "https://example.com/x.bin", byteLength: 4 }] }))],
    ["no triangle count", () => ok({})],
    ["a triangle count of 0", () => ok({ "X-Triangles-After": "0" })],
    ["a negative triangle count", () => ok({ "X-Triangles-After": "-3" })],
    ["a count that is not a number", () => ok({ "X-Triangles-After": "abc" })],
  ])("a 200 with %s is unavailable", async (_label, response) => {
    const { worker } = setup(async () => response());
    const error = await failure(worker.prepare(prepareInput));
    expect(error).toBeInstanceOf(BlenderUnavailableError);
    expect((error as BlenderUnavailableError).status).toBe(200);
  });

  it("a network error is unavailable, with no status", async () => {
    const { worker } = setup(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    const error = (await failure(worker.prepare(prepareInput))) as BlenderUnavailableError;
    expect(error).toBeInstanceOf(BlenderUnavailableError);
    expect(error.status).toBeUndefined();
  });

  it("a call that outlasts its timeout is unavailable, with no status", async () => {
    const { worker } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const error = (await failure(worker.prepare({ ...prepareInput, timeoutMs: 20 }))) as BlenderUnavailableError;
    expect(error).toBeInstanceOf(BlenderUnavailableError);
    expect(error.status).toBeUndefined();
  });

  it("a token that cannot be had is unavailable, and the worker is never called", async () => {
    const { worker, calls } = setup(async () => ok(), {
      token: async () => {
        throw new Error("no key");
      },
    });
    const error = await failure(worker.prepare(prepareInput));
    expect(error).toBeInstanceOf(BlenderUnavailableError);
    expect(calls).toHaveLength(0);
  });
});

describe("build", () => {
  const body = JSON.parse(readFileSync(new URL("../../../../blender-worker/fixtures/recipes/biped-default.json", import.meta.url), "utf8")) as BuildBody;
  const built = (headers: Record<string, string> = { "X-Triangles": "180", "X-Parts": "15", "X-Clips": "Run,Jump" }) => ok(headers);

  it("posts the body as JSON to /build with the token, and reads the three headers", async () => {
    const { worker, calls } = setup(async () => built());

    const made = await worker.build({ body, timeoutMs: 5000 });

    expect(made).toEqual({ bytes: GLB, triangles: 180, parts: 15, clips: ["Run", "Jump"] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://worker.example/build");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ authorization: "Bearer tok", "content-type": "application/json" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual(body);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("takes an empty X-Clips as no clips", async () => {
    const { worker } = setup(async () => built({ "X-Triangles": "12", "X-Parts": "1", "X-Clips": "" }));
    expect(await worker.build({ body, timeoutMs: 5000 })).toMatchObject({ clips: [] });
  });

  it.each([
    ["a clip that is not one of ours", { "X-Triangles": "180", "X-Parts": "15", "X-Clips": "Run,Dance" }],
    ["a clip named twice", { "X-Triangles": "180", "X-Parts": "15", "X-Clips": "Run,Run" }],
    ["no X-Clips", { "X-Triangles": "180", "X-Parts": "15" }],
    ["no X-Triangles", { "X-Parts": "15", "X-Clips": "Run" }],
    ["a triangle count of 0", { "X-Triangles": "0", "X-Parts": "15", "X-Clips": "Run" }],
    ["a part count of 0", { "X-Triangles": "180", "X-Parts": "0", "X-Clips": "Run" }],
    ["a part count that is not a number", { "X-Triangles": "180", "X-Parts": "many", "X-Clips": "Run" }],
    ["a part count with a decimal point", { "X-Triangles": "180", "X-Parts": "1.5", "X-Clips": "Run" }],
  ])("a 200 with %s is unavailable", async (_label, headers) => {
    const { worker } = setup(async () => built(headers));
    const error = await failure(worker.build({ body, timeoutMs: 5000 }));
    expect(error).toBeInstanceOf(BlenderUnavailableError);
    expect((error as BlenderUnavailableError).status).toBe(200);
  });

  it("a 200 whose body is not a usable GLB is unavailable", async () => {
    const { worker } = setup(async () => ok({ "X-Triangles": "180", "X-Parts": "15", "X-Clips": "Run" }, new TextEncoder().encode("not a model")));
    const error = await failure(worker.build({ body, timeoutMs: 5000 }));
    expect(error).toBeInstanceOf(BlenderUnavailableError);
    expect((error as BlenderUnavailableError).status).toBe(200);
  });

  it("a 422 with { error: bad-recipe } is Blender refusing the recipe, and a 422 with { error: empty } is still empty", async () => {
    const recipe = setup(async () => refusal(422, "bad-recipe"));
    const refused = await failure(recipe.worker.build({ body, timeoutMs: 5000 }));
    expect(refused).toBeInstanceOf(BlenderRefusedError);
    expect((refused as BlenderRefusedError).code).toBe("bad-recipe");

    const empty = setup(async () => refusal(422, "empty"));
    expect(((await failure(empty.worker.build({ body, timeoutMs: 5000 }))) as BlenderRefusedError).code).toBe("empty");
  });

  it("a bad-recipe code on any other status is not believed", async () => {
    const { worker } = setup(async () => refusal(500, "bad-recipe"));
    const error = await failure(worker.build({ body, timeoutMs: 5000 }));
    expect(error).toBeInstanceOf(BlenderUnavailableError);
    expect((error as BlenderUnavailableError).status).toBe(500);
  });

  it("never sends a body that fails the recipe check: it is refused as bad-recipe and fetch is not called", async () => {
    const bad = structuredClone(body);
    bad.recipe.build.headSize = 2; // outside 0.3 to 0.8
    const { worker, calls } = setup(async () => built());
    const error = await failure(worker.build({ body: bad, timeoutMs: 5000 }));
    expect(error).toBeInstanceOf(BlenderRefusedError);
    expect((error as BlenderRefusedError).code).toBe("bad-recipe");
    expect(calls).toHaveLength(0);
  });
});
