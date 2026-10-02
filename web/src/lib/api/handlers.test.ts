import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeApi } from "@/lib/api/handlers";
import { MemoryAuth } from "@/lib/auth/memory";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { RunError, type RunService } from "@/lib/runs/types";
import { makeGlb } from "@/lib/testing/glb";

const FIXTURES = fileURLToPath(new URL("../../../../fixtures/settings/", import.meta.url));
const validSettings = readFileSync(FIXTURES + "valid.json", "utf8");
const glb = (marker = 0) => makeGlb({ asset: { version: "2.0" }, extras: { marker } });

const ORIGIN = "https://studio.example";
const EXPIRED = { error: "Your session has expired. Sign in again." };

function setup() {
  const auth = new MemoryAuth();
  auth.addSessionCookie("alice-cookie", { uid: "alice", email: "alice@punx.ai", emailVerified: true });
  auth.addSessionCookie("bob-cookie", { uid: "bob", email: "bob@punx.ai", emailVerified: true });
  let n = 0;
  const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: Date.now, newId: () => `run${++n}` });
  return { auth, runs, api: makeApi({ auth, runs, domain: "punx.ai" }) };
}

interface Options {
  cookie?: string | null;
  origin?: string | null;
  body?: BodyInit | Uint8Array; // raw bytes are valid at runtime; TypeScript 5.7+ wants an ArrayBuffer-backed array
}

function request(method: string, path: string, { cookie = "alice-cookie", origin = ORIGIN, body }: Options = {}) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `__Host-session=${cookie}`;
  if (origin) headers.origin = origin;
  return new Request(ORIGIN + path, { method, headers, body: body as BodyInit | undefined });
}

const readJson = async (response: Response) => response.json();

describe("signed-out and expired sessions", () => {
  it("every handler answers 401 with the same message", async () => {
    const { api } = setup();
    const none = { cookie: null };
    for (const response of [
      await api.listRuns(request("GET", "/api/runs", none)),
      await api.createRun(request("POST", "/api/runs", { ...none, body: validSettings })),
      await api.deleteRun(request("DELETE", "/api/runs/run1", none), "run1"),
      await api.putFile(request("PUT", "/api/runs/run1/files/hero.glb", { ...none, body: glb() }), "run1", "hero.glb"),
      await api.getFile(request("GET", "/api/runs/run1/hero.glb", none), "run1", "hero.glb"),
    ]) {
      expect(response.status).toBe(401);
      expect(await readJson(response)).toEqual(EXPIRED);
    }
  });

  it("treats a revoked or unknown session as signed out", async () => {
    const { api, auth } = setup();
    await auth.revokeRefreshTokens("alice");
    expect((await api.listRuns(request("GET", "/api/runs"))).status).toBe(401);
    expect((await api.listRuns(request("GET", "/api/runs", { cookie: "forged" }))).status).toBe(401);
  });
});

describe("cross-site requests", () => {
  it.each([
    ["a missing Origin", null],
    ["another site's Origin", "https://evil.example"],
  ])("refuses a change that carries %s, even with a valid session", async (_label, origin) => {
    const { api } = setup();
    for (const response of [
      await api.createRun(request("POST", "/api/runs", { origin, body: validSettings })),
      await api.deleteRun(request("DELETE", "/api/runs/run1", { origin }), "run1"),
      await api.putFile(request("PUT", "/api/runs/run1/files/hero.glb", { origin, body: glb() }), "run1", "hero.glb"),
    ]) {
      expect(response.status).toBe(403);
      expect(await readJson(response)).toEqual({ error: "Request not allowed" });
    }
  });

  it("does not require an Origin for reads", async () => {
    const { api } = setup();
    expect((await api.listRuns(request("GET", "/api/runs", { origin: null }))).status).toBe(200);
  });
});

describe("createRun", () => {
  it("answers 201 with the id and the file names to upload", async () => {
    const { api } = setup();
    const response = await api.createRun(request("POST", "/api/runs", { body: validSettings }));
    expect(response.status).toBe(201);
    expect(await readJson(response)).toEqual({ id: "run1", needed: ["hero.glb", "obstacle.glb", "coin.glb"] });
  });

  it("refuses settings over 16 KB with 413, and invalid settings with the validator's message", async () => {
    const { api } = setup();
    const big = await api.createRun(request("POST", "/api/runs", { body: "x".repeat(16_385) }));
    expect(big.status).toBe(413);
    expect(await readJson(big)).toEqual({ error: "settings.json: larger than 16 KB" });

    const bad = await api.createRun(request("POST", "/api/runs", { body: readFileSync(FIXTURES + "invalid-unwinnable-jump.json", "utf8") }));
    expect(bad.status).toBe(400);
    expect((await readJson(bad)).error).toContain("settings.tuning.jumpHeight");
  });

  it("refuses a stray invalid byte inside an otherwise valid settings file instead of storing it altered", async () => {
    const { api } = setup();
    const withExtra = JSON.stringify({ ...JSON.parse(validSettings), note: "X" });
    const bytes = new TextEncoder().encode(withExtra);
    bytes[bytes.indexOf(0x58)] = 0xff; // the X inside the note
    const response = await api.createRun(request("POST", "/api/runs", { body: bytes }));
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toContain("not UTF-8 text");
  });

  it("refuses bytes that are not UTF-8 text", async () => {
    const { api } = setup();
    const response = await api.createRun(request("POST", "/api/runs", { body: new Uint8Array([0xff, 0xfe, 0xfd]) }));
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toContain("not valid JSON");
  });
});

describe("putFile", () => {
  async function created() {
    const s = setup();
    await s.api.createRun(request("POST", "/api/runs", { body: validSettings }));
    return s;
  }

  it("stores a GLB, reports the run, and refuses a repeat with 409", async () => {
    const { api } = await created();
    const put = (name: string, body: Uint8Array) => api.putFile(request("PUT", `/api/runs/run1/files/${name}`, { body }), "run1", name);

    const first = await put("hero.glb", glb());
    expect(first.status).toBe(200);
    expect(await readJson(first)).toMatchObject({ status: "pending", files: expect.arrayContaining(["settings.json", "hero.glb"]) });
    expect((await put("hero.glb", glb())).status).toBe(409);
    await put("obstacle.glb", glb());
    expect(await readJson(await put("coin.glb", glb()))).toMatchObject({ status: "ready" });
  });

  it("answers 413 for a file over 4 MB, naming it", async () => {
    const { api } = await created();
    const response = await api.putFile(request("PUT", "/api/runs/run1/files/hero.glb", { body: new Uint8Array(4 * 1024 * 1024 + 1) }), "run1", "hero.glb");
    expect(response.status).toBe(413);
    expect(await readJson(response)).toEqual({ error: "hero.glb: larger than 4 MB" });
  });

  it("answers 400 with the checker's message for a file that is not a GLB", async () => {
    const { api } = await created();
    const response = await api.putFile(request("PUT", "/api/runs/run1/files/hero.glb", { body: new Uint8Array(30) }), "run1", "hero.glb");
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "hero.glb: not a GLB file (wrong header)" });
  });

  it("answers 404 for someone else's run", async () => {
    const { api } = await created();
    const response = await api.putFile(request("PUT", "/api/runs/run1/files/hero.glb", { cookie: "bob-cookie", body: glb() }), "run1", "hero.glb");
    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: "Not found" });
  });
});

describe("getFile", () => {
  it("serves the owner's files with safe headers and the right type", async () => {
    const { api } = setup();
    await api.createRun(request("POST", "/api/runs", { body: validSettings }));
    for (const name of ["hero.glb", "obstacle.glb", "coin.glb"]) await api.putFile(request("PUT", `/api/runs/run1/files/${name}`, { body: glb() }), "run1", name);

    const settings = await api.getFile(request("GET", "/api/runs/run1/settings.json"), "run1", "settings.json");
    expect(settings.status).toBe(200);
    expect(settings.headers.get("content-type")).toBe("application/json");
    expect(settings.headers.get("x-content-type-options")).toBe("nosniff");
    expect(settings.headers.get("cache-control")).toBe("private");
    expect(await settings.text()).toBe(validSettings);

    const hero = await api.getFile(request("GET", "/api/runs/run1/hero.glb"), "run1", "hero.glb");
    expect(hero.headers.get("content-type")).toBe("model/gltf-binary");
    expect(Array.from(new Uint8Array(await hero.arrayBuffer()))).toEqual(Array.from(glb()));
  });

  it("answers the same 404 for someone else's run and for a file that is not there", async () => {
    const { api } = setup();
    await api.createRun(request("POST", "/api/runs", { body: validSettings }));
    for (const response of [
      await api.getFile(request("GET", "/api/runs/run1/settings.json", { cookie: "bob-cookie" }), "run1", "settings.json"),
      await api.getFile(request("GET", "/api/runs/run1/nope.glb"), "run1", "nope.glb"),
      await api.getFile(request("GET", "/api/runs/zzz/settings.json"), "zzz", "settings.json"),
    ]) {
      expect(response.status).toBe(404);
      expect(await readJson(response)).toEqual({ error: "Not found" });
    }
  });
});

describe("listRuns and deleteRun", () => {
  it("lists only the caller's runs, then deletes one with 204", async () => {
    const { api } = setup();
    await api.createRun(request("POST", "/api/runs", { body: validSettings }));
    await api.createRun(request("POST", "/api/runs", { cookie: "bob-cookie", body: validSettings }));

    const mine = await readJson(await api.listRuns(request("GET", "/api/runs")));
    expect(mine.runs.map((r: { id: string }) => r.id)).toEqual(["run1"]);
    expect(mine.runs[0]).toMatchObject({ status: "pending", needed: ["hero.glb", "obstacle.glb", "coin.glb"] });
    expect(mine.runs[0]).not.toHaveProperty("ownerUid");

    expect((await api.deleteRun(request("DELETE", "/api/runs/run1"), "run1")).status).toBe(204);
    expect((await readJson(await api.listRuns(request("GET", "/api/runs")))).runs).toEqual([]);
    expect((await api.deleteRun(request("DELETE", "/api/runs/run2"), "run2")).status).toBe(404); // bob's
  });
});

describe("an unexpected failure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers 500 in plain words, and logs the run id but never the file", async () => {
    const { auth } = setup();
    const broken: RunService = {
      createRun: async () => {
        throw new Error("boom");
      },
      putFile: async () => {
        throw new Error("boom");
      },
      readFile: async () => {
        throw new RunError(404, "Not found");
      },
      listRuns: async () => [],
      deleteRun: async () => undefined,
    };
    const api = makeApi({ auth, runs: broken, domain: "punx.ai" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await api.putFile(
      request("PUT", "/api/runs/run42/files/hero.glb", { body: new TextEncoder().encode("SECRETBYTES-in-the-upload") }),
      "run42",
      "hero.glb",
    );
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: "Something went wrong on our side" });

    const text = JSON.stringify(logged.mock.calls);
    expect(text).toContain("run42");
    expect(text).toContain("putFile");
    expect(text).not.toContain("SECRETBYTES");
  });
});

describe("a failure of the identity service (not a refused session)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a logged 500, never a 401 that sends people to sign in again", async () => {
    const { api, auth } = setup();
    auth.failure = Object.assign(new Error("Firebase says: the private_key is bad"), { code: "app/invalid-credential" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await api.listRuns(request("GET", "/api/runs"));
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: "Something went wrong on our side" });

    const text = JSON.stringify(logged.mock.calls);
    expect(text).toContain("app/invalid-credential");
    expect(text).not.toContain("private_key");
  });

  it("logs the kind of failure and never the message when the run service throws", async () => {
    const { auth } = setup();
    const broken: RunService = {
      createRun: async () => undefined as never,
      putFile: async () => {
        throw new Error("boom with SECRET-IN-THE-MESSAGE");
      },
      readFile: async () => undefined as never,
      listRuns: async () => [],
      deleteRun: async () => undefined,
    };
    const api = makeApi({ auth, runs: broken, domain: "punx.ai" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await api.putFile(request("PUT", "/api/runs/run7/files/hero.glb", { body: new Uint8Array(4) }), "run7", "hero.glb");
    const text = JSON.stringify(logged.mock.calls);
    expect(text).toContain("run7");
    expect(text).not.toContain("SECRET-IN-THE-MESSAGE");
  });
});
