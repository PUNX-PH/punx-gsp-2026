import { describe, expect, it } from "vitest";
import { MemoryAuth } from "@/lib/auth/memory";
import { makeGraphApi } from "@/lib/graph/api";
import { makeGraphService } from "@/lib/graph/service";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import { ExportError, type ExportService, type PackedGame } from "@/lib/export/types";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";

const ORIGIN = "https://studio.example";
const packed: PackedGame = { bytes: new Uint8Array([0x50, 0x4b, 3, 4, 9]), fileName: "game-windows.zip", contentType: "application/zip" };

async function setup(exporter?: ExportService) {
  const auth = new MemoryAuth();
  auth.addSessionCookie("alice-cookie", { uid: "alice", email: "alice@punx.ai", emailVerified: true });
  auth.addSessionCookie("bob-cookie", { uid: "bob", email: "bob@punx.ai", emailVerified: true });
  const records = new MemoryGraphRecords();
  let graphs = 0;
  let runs = 0;
  const runService = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: Date.now, newId: () => `run${++runs}` });
  const service = makeGraphService({ records, files: new MemoryGraphFiles(), runs: runService, now: Date.now, newId: () => `g${++graphs}`, exporter });
  const api = makeGraphApi({ auth, graphs: service, domain: "punx.ai" });
  const created = await api.createGraph(new Request(`${ORIGIN}/api/graphs`, { method: "POST", headers: { cookie: "__Host-session=alice-cookie", origin: ORIGIN }, body: JSON.stringify({ starter: true }) }));
  expect(created.status).toBe(201);
  return { api, records };
}

const post = (platform: string | null, over: { cookie?: string | null; origin?: string | null } = {}) => {
  const headers: Record<string, string> = {};
  const cookie = over.cookie === undefined ? "alice-cookie" : over.cookie;
  const origin = over.origin === undefined ? ORIGIN : over.origin;
  if (cookie) headers.cookie = `__Host-session=${cookie}`;
  if (origin) headers.origin = origin;
  return new Request(`${ORIGIN}/api/graphs/g1/export${platform === null ? "" : `?platform=${platform}`}`, { method: "POST", headers });
};

function fakeExporter(result: PackedGame | Error = packed) {
  const calls: { uid: string; runId: string; platform: string }[] = [];
  const exporter: ExportService = {
    async exportGame(user, runId, platform) {
      calls.push({ uid: user.uid, runId, platform });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { exporter, calls };
}

describe("the export download", () => {
  it("hands the packed file back as a download of the graph's last game", async () => {
    const { exporter, calls } = fakeExporter();
    const { api, records } = await setup(exporter);
    await records.setLastRunId("g1", "run42");
    const response = await api.exportGame(post("windows"), "g1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="game-windows.zip"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(packed.bytes);
    expect(calls).toEqual([{ uid: "alice", runId: "run42", platform: "windows" }]);
  });

  it("is for signed-in people from this site only, and only for their own graphs", async () => {
    const { exporter, calls } = fakeExporter();
    const { api, records } = await setup(exporter);
    await records.setLastRunId("g1", "run42");
    expect((await api.exportGame(post("windows", { cookie: null }), "g1")).status).toBe(401);
    expect((await api.exportGame(post("windows", { origin: "https://evil.example" }), "g1")).status).toBe(403);
    expect((await api.exportGame(post("windows", { cookie: "bob-cookie" }), "g1")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("needs a platform it knows", async () => {
    const { api } = await setup(fakeExporter().exporter);
    for (const platform of [null, "ios", "windows,android", ""]) expect((await api.exportGame(post(platform), "g1")).status).toBe(400);
  });

  it("says to press Play first when the graph has no game yet", async () => {
    const { api } = await setup(fakeExporter().exporter);
    const response = await api.exportGame(post("android"), "g1");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "There is no game to build yet. Press Play first." });
  });

  it("says plainly when downloads are not set up on the site", async () => {
    const { api, records } = await setup(undefined);
    await records.setLastRunId("g1", "run42");
    const response = await api.exportGame(post("android"), "g1");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Building for an Android phone is not set up on this site yet." });
  });

  it("passes the export service's own sentences and statuses on, a gone game as a conflict", async () => {
    for (const [error, status] of [[new ExportError(429, "You have used today's downloads. Try again tomorrow."), 429], [new ExportError(409, "Only a game made with Describe Game can be built for a computer or a phone. Turn on Make a game, then press Play."), 409], [new ExportError(404, "Your game is no longer stored. Press Play to make it again."), 409], [new ExportError(503, "The packaging service did not answer. Try again."), 503]] as const) {
      const { api, records } = await setup(fakeExporter(error).exporter);
      await records.setLastRunId("g1", "run42");
      const response = await api.exportGame(post("windows"), "g1");
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: string }).error).toBe(error.message);
    }
  });

  it("turns anything unexpected into the plain server error, with nothing of it in the answer", async () => {
    const { api, records } = await setup(fakeExporter(new TypeError("secret detail")).exporter);
    await records.setLastRunId("g1", "run42");
    const response = await api.exportGame(post("windows"), "g1");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
