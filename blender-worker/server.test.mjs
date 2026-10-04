// The wrapper's tests: a real HTTP server, with a fake Blender (fixtures/fake-blender.mjs) in place of the real one.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorker } from "./server.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-blender.mjs", import.meta.url));
const cleanups = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()();
});

async function start(options = {}) {
  const scratch = mkdtempSync(path.join(tmpdir(), "bw-test-"));
  const workRoot = path.join(scratch, "work");
  mkdirSync(workRoot);
  const server = createWorker({
    blenderBin: process.execPath,
    extraArgs: [FAKE, "--startedfile", path.join(scratch, "started"), "--pidfile", path.join(scratch, "pid"), ...(options.extraArgs ?? [])],
    scriptsDir: path.join(scratch, "scripts"),
    workRoot,
    jobLimitMs: 5000,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(scratch, { recursive: true, force: true });
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    workRoot,
    started: () => existsSync(path.join(scratch, "started")),
    pid: () => Number(readFileSync(path.join(scratch, "pid"), "utf8")),
    jobFolders: () => readdirSync(workRoot).length,
  };
}

const obj = (marker = "") => `${marker}\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`;
const post = (t, query, body) => fetch(`${t.base}/prepare?${query}`, { method: "POST", body });
const prepare = (t, body = obj(), query = "format=obj&triangles=2000&color=original") => post(t, query, body);
const errorBody = async (response) => JSON.parse(await response.text());

describe("the routes", () => {
  it("answers /healthz without running Blender", async () => {
    const t = await start();
    const response = await fetch(`${t.base}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(t.started(), false);
  });

  it("refuses other paths (404) and other methods (405), with only an error code", async () => {
    const t = await start();
    const missing = await fetch(`${t.base}/nope`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await errorBody(missing), { error: "bad-request" });
    const wrong = await fetch(`${t.base}/prepare`);
    assert.equal(wrong.status, 405);
    assert.deepEqual(await errorBody(wrong), { error: "bad-request" });
    assert.equal((await fetch(`${t.base}/shape`)).status, 405);
    assert.equal((await fetch(`${t.base}/healthz`, { method: "POST" })).status, 405);
  });
});

describe("POST /prepare", () => {
  it("runs Blender on the file and returns the GLB with its triangle counts", async () => {
    const t = await start();
    const response = await prepare(t);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "model/gltf-binary");
    assert.equal(response.headers.get("x-triangles-before"), "9400");
    assert.equal(response.headers.get("x-triangles-after"), "2000");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.subarray(0, 4).toString("latin1"), "glTF");
    assert.equal(t.started(), true);
  });

  it("takes a color as well as the model's own colors, and all three formats", async () => {
    const t = await start();
    assert.equal((await prepare(t, obj(), "format=obj&triangles=100&color=%23ff6f59")).status, 200);
    assert.equal((await prepare(t, Buffer.concat([Buffer.from("glTF"), Buffer.alloc(8)]), "format=glb&triangles=5000&color=original")).status, 200);
    const fbx = Buffer.concat([Buffer.from("Kaydara FBX Binary  "), Buffer.alloc(30)]);
    assert.equal((await prepare(t, fbx, "format=fbx&triangles=2000&color=%23FFFFFF")).status, 200);
  });

  for (const query of [
    "format=obj&triangles=99&color=original",
    "format=obj&triangles=5001&color=original",
    "format=obj&triangles=abc&color=original",
    "format=obj&triangles=20.5&color=original",
    "format=obj&triangles=2000&color=red",
    "format=obj&triangles=2000&color=%23fff",
    "format=obj&triangles=2000",
    "format=obj&color=original",
    "format=stl&triangles=2000&color=original",
    "triangles=2000&color=original",
  ]) {
    it(`refuses the query ${query} with 400 bad-request, and never starts Blender`, async () => {
      const t = await start();
      const response = await prepare(t, obj(), query);
      assert.equal(response.status, 400);
      assert.deepEqual(await errorBody(response), { error: "bad-request" });
      assert.equal(t.started(), false);
    });
  }

  it("refuses a body over the cap, by its declared length and as it streams, and never starts Blender", async () => {
    const t = await start({ maxInputBytes: 50 });
    const declared = await prepare(t, obj("x".repeat(200)));
    assert.equal(declared.status, 413);
    assert.deepEqual(await errorBody(declared), { error: "too-big" });

    const chunks = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(obj("y".repeat(30))));
        controller.enqueue(new TextEncoder().encode("z".repeat(100)));
        controller.close();
      },
    });
    const streamed = await fetch(`${t.base}/prepare?format=obj&triangles=2000&color=original`, { method: "POST", body: chunks, duplex: "half" });
    assert.equal(streamed.status, 413);
    assert.equal(t.started(), false);
  });

  it("answers an empty body 422 empty", async () => {
    const t = await start();
    const response = await prepare(t, "");
    assert.equal(response.status, 422);
    assert.deepEqual(await errorBody(response), { error: "empty" });
  });

  it("refuses bytes that do not match the claimed format, 415 bad-format, before starting Blender", async () => {
    const t = await start();
    for (const [query, body] of [
      ["format=fbx&triangles=2000&color=original", obj()],
      ["format=glb&triangles=2000&color=original", obj()],
      ["format=obj&triangles=2000&color=original", Buffer.concat([Buffer.from("v 0 0 0\n"), Buffer.from([0, 1, 2])])],
    ]) {
      const response = await post(t, query, body);
      assert.equal(response.status, 415);
      assert.deepEqual(await errorBody(response), { error: "bad-format" });
    }
    assert.equal(t.started(), false);
  });

  it("maps what Blender does to a code: empty, unreadable, crashed, and no output at all", async () => {
    const t = await start();
    for (const [marker, status, code] of [
      ["EMPTY", 422, "empty"],
      ["BROKEN", 415, "bad-format"],
      ["CRASH", 500, "failed"],
      ["NOOUT", 500, "failed"],
    ]) {
      const response = await prepare(t, obj(marker));
      assert.equal(response.status, status, marker);
      assert.deepEqual(await errorBody(response), { error: code }, marker);
    }
  });

  it("kills a Blender that runs past the job limit, and answers 504 timeout", async () => {
    const t = await start({ jobLimitMs: 300 });
    const response = await prepare(t, obj("SLEEP"));
    assert.equal(response.status, 504);
    assert.deepEqual(await errorBody(response), { error: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.throws(() => process.kill(t.pid(), 0), { code: "ESRCH" }); // really gone
  });

  it("does not pass its own environment on to Blender (no secret reaches it)", async () => {
    process.env.SECRET_TEST = "do-not-leak";
    cleanups.push(() => delete process.env.SECRET_TEST);
    const t = await start();
    const response = await prepare(t);
    assert.equal(response.status, 200); // the fake exits 7 if it sees any variable with SECRET in its name
  });

  it("leaves no job folder behind, whatever happened", async () => {
    const t = await start({ jobLimitMs: 300 });
    for (const marker of ["", "EMPTY", "BROKEN", "CRASH", "NOOUT", "SLEEP"]) {
      await prepare(t, obj(marker));
      assert.equal(t.jobFolders(), 0, `after ${marker || "a good job"}`);
    }
    await prepare(t, obj(), "format=obj&triangles=1&color=original"); // refused before any folder is made
    assert.equal(t.jobFolders(), 0);
  });

  it("answers errors with only the code, nothing Blender or the system said", async () => {
    const t = await start();
    const response = await prepare(t, obj("CRASH"));
    assert.equal(await response.text(), '{"error":"failed"}');
  });
});

describe("POST /shape", () => {
  const shape = (t, body) => fetch(`${t.base}/shape`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

  it("runs Blender and returns the GLB, for each of the seven shapes", async () => {
    const t = await start();
    for (const name of ["cube", "sphere", "cone", "cylinder", "pyramid", "coin", "ring"]) {
      const response = await shape(t, { shape: name, color: "#06d6a0" });
      assert.equal(response.status, 200, name);
      assert.equal(response.headers.get("x-triangles-after"), "80");
      assert.equal(response.headers.get("x-triangles-before"), null);
    }
  });

  it("refuses a bad shape, a bad color, a missing field, extra fields and a body that is not JSON, 400 bad-request", async () => {
    const t = await start();
    for (const body of [
      { shape: "torus", color: "#06d6a0" },
      { shape: "cube", color: "red" },
      { shape: "cube" },
      { color: "#06d6a0" },
      { shape: "cube", color: "#06d6a0", extra: 1 },
      { shape: ["cube"], color: "#06d6a0" },
      "not json",
      "[]",
      "null",
    ]) {
      const response = await shape(t, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.deepEqual(await errorBody(response), { error: "bad-request" });
    }
    assert.equal(t.started(), false);
  });

  it("refuses a body over the cap", async () => {
    const t = await start({ maxInputBytes: 20 });
    const response = await shape(t, { shape: "cube", color: "#06d6a0" });
    assert.equal(response.status, 413);
  });
});
