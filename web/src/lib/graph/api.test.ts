import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAuth } from "@/lib/auth/memory";
import { makeGraphApi } from "@/lib/graph/api";
import { type GraphService, makeGraphService } from "@/lib/graph/service";
import { starterGraph } from "@/lib/graph/starter";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { makePng } from "@/lib/testing/images";

const ORIGIN = "https://studio.example";
const EXPIRED = { error: "Your session has expired. Sign in again." };

function setup() {
  const auth = new MemoryAuth();
  auth.addSessionCookie("alice-cookie", { uid: "alice", email: "alice@punx.ai", emailVerified: true });
  auth.addSessionCookie("bob-cookie", { uid: "bob", email: "bob@punx.ai", emailVerified: true });
  let graphs = 0;
  let runs = 0;
  const runService = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: Date.now, newId: () => `run${++runs}` });
  const service = makeGraphService({ records: new MemoryGraphRecords(), files: new MemoryGraphFiles(), runs: runService, now: Date.now, newId: () => `g${++graphs}` });
  return { auth, service, api: makeGraphApi({ auth, graphs: service, domain: "punx.ai" }) };
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
const asJson = (value: unknown) => JSON.stringify(value);

/** Alice's first graph is "g1", made from the starter. */
async function withGraph() {
  const context = setup();
  const created = await context.api.createGraph(request("POST", "/api/graphs", { body: asJson({ starter: true }) }));
  expect(created.status).toBe(201);
  return context;
}

describe("signed-out and expired sessions", () => {
  it("every handler answers 401 with the same message", async () => {
    const { api } = setup();
    const none = { cookie: null };
    const png = new Uint8Array(4);
    for (const response of [
      await api.listGraphs(request("GET", "/api/graphs", none)),
      await api.createGraph(request("POST", "/api/graphs", { ...none, body: "{}" })),
      await api.getGraph(request("GET", "/api/graphs/g1", none), "g1"),
      await api.saveGraph(request("PUT", "/api/graphs/g1", { ...none, body: "{}" }), "g1"),
      await api.deleteGraph(request("DELETE", "/api/graphs/g1", none), "g1"),
      await api.addAsset(request("POST", "/api/graphs/g1/assets?name=a.png", { ...none, body: png }), "g1"),
      await api.getAsset(request("GET", "/api/graphs/g1/assets/abc", none), "g1", "abc"),
      await api.play(request("POST", "/api/graphs/g1/play", none), "g1"),
    ]) {
      expect(response.status).toBe(401);
      expect(await readJson(response)).toEqual(EXPIRED);
    }
  });

  it("treats a revoked or forged session as signed out", async () => {
    const { api, auth } = setup();
    await auth.revokeRefreshTokens("alice");
    expect((await api.listGraphs(request("GET", "/api/graphs"))).status).toBe(401);
    expect((await api.listGraphs(request("GET", "/api/graphs", { cookie: "forged" }))).status).toBe(401);
  });
});

describe("cross-site requests", () => {
  const changes: [string, (api: ReturnType<typeof setup>["api"], origin: string | null) => Promise<Response>][] = [
    ["createGraph", (api, origin) => api.createGraph(request("POST", "/api/graphs", { origin, body: "{}" }))],
    ["saveGraph", (api, origin) => api.saveGraph(request("PUT", "/api/graphs/g1", { origin, body: asJson({ graph: starterGraph() }) }), "g1")],
    ["deleteGraph", (api, origin) => api.deleteGraph(request("DELETE", "/api/graphs/g1", { origin }), "g1")],
    ["addAsset", (api, origin) => api.addAsset(request("POST", "/api/graphs/g1/assets?name=a.png", { origin, body: new Uint8Array(4) }), "g1")],
    ["play", (api, origin) => api.play(request("POST", "/api/graphs/g1/play", { origin }), "g1")],
  ];

  it.each(changes.flatMap(([name, run]) => [[name, "a missing Origin", null, run] as const, [name, "another site's Origin", "https://evil.example", run] as const]))(
    "%s refuses a change that carries %s, even with a valid session",
    async (_name, _label, origin, run) => {
      const { api, service } = await withGraph();
      const response = await run(api, origin);
      expect(response.status).toBe(403);
      expect(await readJson(response)).toEqual({ error: "Request not allowed" });
      expect((await service.getGraph({ uid: "alice", email: "alice@punx.ai" }, "g1")).graph).toEqual(starterGraph()); // untouched, and still there
    },
  );
});

describe("creating, listing and reading graphs", () => {
  it("creates a graph from the starter and never shows who owns it", async () => {
    const { api } = setup();
    const response = await api.createGraph(request("POST", "/api/graphs", { body: asJson({ name: "My game", starter: true }) }));
    expect(response.status).toBe(201);
    const body = await readJson(response);
    expect(body).toMatchObject({ id: "g1", name: "My game", lastRunId: null, assets: {} });
    expect(body.graph).toEqual(starterGraph());
    expect(JSON.stringify(body)).not.toMatch(/ownerUid|ownerEmail|alice/);
  });

  it("accepts an empty body as 'an empty graph', and refuses text that is not JSON", async () => {
    const { api } = setup();
    const empty = await api.createGraph(request("POST", "/api/graphs"));
    expect(empty.status).toBe(201);
    expect((await readJson(empty)).graph.nodes).toEqual([]);
    expect((await api.createGraph(request("POST", "/api/graphs", { body: "{nope" }))).status).toBe(400);
  });

  it("lists the caller's graphs and reads one", async () => {
    const { api } = await withGraph();
    const list = await readJson(await api.listGraphs(request("GET", "/api/graphs")));
    expect(list.graphs).toHaveLength(1);
    expect(list.graphs[0]).toMatchObject({ id: "g1", name: "Untitled game" });
    expect(JSON.stringify(list)).not.toMatch(/ownerUid|ownerEmail/);

    const one = await api.getGraph(request("GET", "/api/graphs/g1"), "g1");
    expect(one.status).toBe(200);
    expect((await readJson(one)).graph).toEqual(starterGraph());
  });

  it("deletes a graph", async () => {
    const { api } = await withGraph();
    expect((await api.deleteGraph(request("DELETE", "/api/graphs/g1"), "g1")).status).toBe(204);
    expect((await api.getGraph(request("GET", "/api/graphs/g1"), "g1")).status).toBe(404);
  });
});

describe("someone else's graph", () => {
  it("is the same 404 from every handler as a graph that does not exist", async () => {
    const { api } = await withGraph();
    const bob = { cookie: "bob-cookie" };
    const responses = [
      await api.getGraph(request("GET", "/api/graphs/g1", bob), "g1"),
      await api.saveGraph(request("PUT", "/api/graphs/g1", { ...bob, body: asJson({ graph: starterGraph() }) }), "g1"),
      await api.deleteGraph(request("DELETE", "/api/graphs/g1", bob), "g1"),
      await api.addAsset(request("POST", "/api/graphs/g1/assets?name=a.png", { ...bob, body: new Uint8Array(4) }), "g1"),
      await api.getAsset(request("GET", "/api/graphs/g1/assets/abc", bob), "g1", "abc"),
      await api.play(request("POST", "/api/graphs/g1/play", bob), "g1"),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await readJson(response)).toEqual({ error: "Not found" });
    }
    // and it is still alice's, untouched
    expect((await api.getGraph(request("GET", "/api/graphs/g1"), "g1")).status).toBe(200);
  });
});

describe("saving a graph", () => {
  it("saves and returns the graph", async () => {
    const { api } = await withGraph();
    const graph = starterGraph();
    graph.nodes[2].params = { tuning: { speed: 7, jumpHeight: 2.5, obstacleSpacing: 14 } };
    const response = await api.saveGraph(request("PUT", "/api/graphs/g1", { body: asJson({ name: "Renamed", graph }) }), "g1");
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ name: "Renamed", graph });
  });

  it("answers 400 for text that is not JSON, and for a graph that does not parse", async () => {
    const { api } = await withGraph();
    const notJson = await api.saveGraph(request("PUT", "/api/graphs/g1", { body: "{nope" }), "g1");
    expect(notJson.status).toBe(400);
    expect(await readJson(notJson)).toEqual({ error: "The graph is not valid JSON." });

    const bad = await api.saveGraph(request("PUT", "/api/graphs/g1", { body: asJson({ graph: { schemaVersion: 2, nodes: [], edges: [] } }) }), "g1");
    expect(bad.status).toBe(400);
    expect((await readJson(bad)).error).toContain("schemaVersion");
  });

  it("refuses a body over 64 KB", async () => {
    const { api } = await withGraph();
    const response = await api.saveGraph(request("PUT", "/api/graphs/g1", { body: asJson({ name: "x".repeat(70 * 1024), graph: starterGraph() }) }), "g1");
    expect(response.status).toBe(413);
    expect(await readJson(response)).toEqual({ error: "The graph is larger than 64 KB" });
  });
});

describe("files", () => {
  it("takes a picture, says what it is, and gives it back with safe headers", async () => {
    const { api } = await withGraph();
    const bytes = await makePng(30, 20, [10, 20, 30]);

    const uploaded = await api.addAsset(request("POST", "/api/graphs/g1/assets?name=photo.png", { body: bytes }), "g1");
    expect(uploaded.status).toBe(201);
    const info = await readJson(uploaded);
    expect(info).toMatchObject({ name: "photo.png", size: bytes.length, kind: "image", width: 30, height: 20 });
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/);

    const fetched = await api.getAsset(request("GET", `/api/graphs/g1/assets/${info.sha256}`), "g1", info.sha256);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("Content-Type")).toBe("image/png");
    expect(fetched.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(fetched.headers.get("Cache-Control")).toBe("private");
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(bytes);
  });

  it("refuses an upload over 4 MB, naming the file", async () => {
    const { api } = await withGraph();
    const response = await api.addAsset(request("POST", "/api/graphs/g1/assets?name=photo.png", { body: new Uint8Array(4 * 1024 * 1024 + 1) }), "g1");
    expect(response.status).toBe(413);
    expect(await readJson(response)).toEqual({ error: "photo.png: larger than 4 MB" });
  });

  it("answers 400 for a file that is not a picture or a model", async () => {
    const { api } = await withGraph();
    const response = await api.addAsset(request("POST", "/api/graphs/g1/assets?name=photo.png", { body: new TextEncoder().encode("not a picture") }), "g1");
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "photo.png: not a PNG, JPEG or GLB file" });
  });
});

describe("Play", () => {
  it("answers 422 with the problems when the graph is not finished", async () => {
    const { api } = await withGraph();
    const response = await api.play(request("POST", "/api/graphs/g1/play"), "g1");
    expect(response.status).toBe(422);
    expect(await readJson(response)).toEqual({ problems: [{ node: "n1", message: "Reference Image: choose a picture." }] });
  });

  it("runs the saved graph and answers 200 with the states and the run", async () => {
    const { api } = await withGraph();
    const uploaded = await readJson(
      await api.addAsset(request("POST", "/api/graphs/g1/assets?name=photo.png", { body: await makePng(40, 40, [200, 40, 40]) }), "g1"),
    );
    const graph = starterGraph();
    graph.nodes[0].params = { asset: uploaded.sha256 };
    expect((await api.saveGraph(request("PUT", "/api/graphs/g1", { body: asJson({ graph }) }), "g1")).status).toBe(200);

    const response = await api.play(request("POST", "/api/graphs/g1/play"), "g1");

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toMatchObject({ state: "done", order: ["n1", "n2", "n3", "n4"], runId: "run1" });
    expect(body.nodes.n5).toEqual({ state: "not-used" });
    expect(body.nodes.n2.state).toBe("done");
    expect(JSON.stringify(body)).not.toMatch(/ownerUid|ownerEmail/);
  });
});

describe("a failure that is not the person's fault", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a plain 500 that logs the handler, the id and the kind of failure, and never the message", async () => {
    const { auth, service } = setup();
    const broken: GraphService = {
      ...service,
      getGraph: async () => {
        throw new Error("boom with secret-bytes");
      },
    };
    const api = makeGraphApi({ auth, graphs: broken, domain: "punx.ai" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await api.getGraph(request("GET", "/api/graphs/g42"), "g42");

    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: "Something went wrong on our side" });
    const text = JSON.stringify(logged.mock.calls);
    expect(text).toContain("getGraph");
    expect(text).toContain("g42");
    expect(text).not.toContain("secret-bytes");
  });
});
