import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryUsageLimits } from "@/lib/ai/memory";
import { makePackager } from "@/lib/export/client";
import { makeExportService } from "@/lib/export/service";
import { ExportError, type PackedGame, type Packager, PackagerNotSetUpError, PackagerRefusedError, PackagerUnavailableError } from "@/lib/export/types";
import { padPalette } from "@/lib/graph/nodes/describeGame";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { makeGlb } from "@/lib/testing/glb";

const alice = { uid: "alice", email: "alice@punx.ai" };
const NOW = Date.parse("2026-10-08T12:00:00Z");
const runner = JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "engine", "fixtures", "specs", "runner.json"), "utf8"));

function gameSettings(model?: string) {
  const game = structuredClone(runner);
  game.entities.spike.model = "box"; // Game Template draws a model without a file as a box, so a stored game has none that it lacks
  if (model) game.entities.hero.model = model;
  return JSON.stringify({
    schemaVersion: 1, template: "runner", palette: padPalette(game.look.palette),
    roles: { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb" },
    tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 }, game,
  });
}
const runnerSettings = JSON.stringify({
  schemaVersion: 1, template: "runner", palette: padPalette(runner.look.palette),
  roles: { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb" }, tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 },
});

async function storedRun(settings: string, files: Record<string, Uint8Array> = {}) {
  let n = 0;
  const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: () => NOW, newId: () => `run${++n}` });
  const { id } = await runs.createRun(alice, settings);
  for (const [name, bytes] of Object.entries(files)) await runs.putFile(alice, id, name, bytes);
  return { runs, id };
}

const packed: PackedGame = { bytes: new Uint8Array([0x50, 0x4b, 1]), fileName: "game-windows.zip", contentType: "application/zip" };
function fakePackager(result: PackedGame | Error = packed) {
  const calls: { platform: string; files: { name: string; size: number }[] }[] = [];
  const packager: Packager = {
    async pack(platform, files) {
      calls.push({ platform, files: files.map((f) => ({ name: f.name, size: f.bytes.length })) });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { packager, calls };
}
function service(runs: Awaited<ReturnType<typeof storedRun>>["runs"], packager: Packager, over: { perPerson?: number; total?: number } = {}) {
  const limits = new MemoryUsageLimits();
  const logs: object[] = [];
  const s = makeExportService({ runs, packager, limits, perPerson: over.perPerson ?? 20, total: over.total ?? 200, now: () => NOW, log: (i) => logs.push(i) });
  return { s, limits, logs };
}
const count = (limits: MemoryUsageLimits) => Math.max(0, ...limits.counts.values());
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ExportError);
    return e as ExportError;
  }
  throw new Error("expected a failure");
};

describe("the export service", () => {
  it("packs the stored game: its settings and its entities' files, as the run holds them, and counts one download", async () => {
    const glb = makeGlb({ asset: { version: "2.0" } });
    const { runs, id } = await storedRun(gameSettings("heroArt"), { "entity-hero.glb": glb });
    const { packager, calls } = fakePackager();
    const { s, limits, logs } = service(runs, packager);
    expect(await s.exportGame(alice, id, "windows")).toBe(packed);
    expect(calls).toHaveLength(1);
    expect(calls[0].platform).toBe("windows");
    expect(calls[0].files.map((f) => f.name)).toEqual(["settings.json", "entity-hero.glb"]);
    expect(calls[0].files[1].size).toBe(glb.length);
    expect(count(limits)).toBe(1);
    expect(JSON.stringify(logs)).toContain("packed");
  });

  it("refuses a runner game (no game spec), calling nothing and counting nothing", async () => {
    const { runs, id } = await storedRun(runnerSettings, { "hero.glb": makeGlb({ asset: { version: "2.0" } }), "obstacle.glb": makeGlb({ asset: { version: "2.0" } }), "collectible.glb": makeGlb({ asset: { version: "2.0" } }) });
    const { packager, calls } = fakePackager();
    const { s, limits } = service(runs, packager);
    const error = await failure(s.exportGame(alice, id, "android"));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/Only a game made with Describe Game/);
    expect(calls).toHaveLength(0);
    expect(count(limits)).toBe(0);
  });

  it("says the game is gone when its run is gone, or belongs to someone else", async () => {
    const { runs, id } = await storedRun(gameSettings());
    const { packager } = fakePackager();
    const { s } = service(runs, packager);
    expect((await failure(s.exportGame(alice, "missing", "windows"))).status).toBe(404);
    expect((await failure(s.exportGame({ uid: "mallory", email: "m@punx.ai" }, id, "windows"))).status).toBe(404);
  });

  it("refuses when the person's or the site's daily downloads are used up", async () => {
    const { runs, id } = await storedRun(gameSettings());
    const person = service(runs, fakePackager().packager, { perPerson: 0 });
    expect((await failure(person.s.exportGame(alice, id, "windows"))).message).toBe("You have used today's downloads. Try again tomorrow.");
    const site = service(runs, fakePackager().packager, { total: 0 });
    expect((await failure(site.s.exportGame(alice, id, "windows"))).message).toBe("Downloads are busy today. Try again tomorrow.");
  });

  it("gives the count back, and says plainly, when the packager is not set up, refused, down or something unexpected happened", async () => {
    const { runs, id } = await storedRun(gameSettings());
    for (const [error, status, message] of [
      [new PackagerNotSetUpError(), 503, "Building for a computer (Windows) is not set up on this site yet."],
      [new PackagerRefusedError("not-set-up"), 503, "Building for a computer (Windows) is not set up on this site yet."],
      [new PackagerRefusedError("bad-files"), 503, "The packaging service did not answer. Try again."],
      [new PackagerUnavailableError(502), 503, "The packaging service did not answer. Try again."],
      [new TypeError("boom"), 503, "The packaging service did not answer. Try again."],
    ] as const) {
      const { s, limits } = service(runs, fakePackager(error).packager);
      const e = await failure(s.exportGame(alice, id, "windows"));
      expect([e.status, e.message]).toEqual([status, message]);
      expect(count(limits)).toBe(0);
    }
  });
});

describe("the packager client", () => {
  const files = [{ name: "settings.json", bytes: new TextEncoder().encode("{}") }];
  const zipBytes = new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(30).fill(0)]);
  const client = (respond: (url: string, init: RequestInit) => Response | Promise<Response>) =>
    makePackager({ baseUrl: "https://packager.example/", getIdToken: async () => "tok", fetch: (async (url: string, init: RequestInit) => respond(url, init)) as typeof fetch });
  const answer = (status: number, body: BodyInit, type: string) => new Response(body, { status, headers: { "content-type": type } });

  it("posts the files as base64 with the token, and returns the packed file", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const c = client((url, init) => ((seen = { url, init }), answer(200, zipBytes, "application/zip")));
    const result = await c.pack("windows", files);
    expect(result).toMatchObject({ fileName: "game-windows.zip", contentType: "application/zip" });
    expect(seen!.url).toBe("https://packager.example/package?platform=windows");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(seen!.init.body as string)).toEqual({ files: [{ name: "settings.json", data: Buffer.from("{}").toString("base64") }] });
  });

  it("names an Android file for its platform", async () => {
    const result = await client(() => answer(200, zipBytes, "application/vnd.android.package-archive")).pack("android", files);
    expect(result.fileName).toBe("game-android.apk");
  });

  it("believes a refusal code only on the status it comes with, and treats anything else as not answering", async () => {
    await expect(client(() => answer(422, '{"code":"bad-files"}', "application/json")).pack("windows", files)).rejects.toBeInstanceOf(PackagerRefusedError);
    await expect(client(() => answer(200, '{"code":"bad-files"}', "application/json")).pack("windows", files)).rejects.toBeInstanceOf(PackagerUnavailableError);
    await expect(client(() => answer(502, '{"code":"bad-files"}', "application/json")).pack("windows", files)).rejects.toMatchObject({ status: 502 });
    await expect(client(() => answer(500, "<html>oops</html>", "text/html")).pack("windows", files)).rejects.toBeInstanceOf(PackagerUnavailableError);
  });

  it("does not accept a 200 that is not a zip of the right kind, and keeps nothing a failure said", async () => {
    await expect(client(() => answer(200, "not a zip at all, plain text here", "application/zip")).pack("windows", files)).rejects.toBeInstanceOf(PackagerUnavailableError);
    await expect(client(() => answer(200, zipBytes, "text/plain")).pack("windows", files)).rejects.toBeInstanceOf(PackagerUnavailableError);
    const failing = makePackager({ baseUrl: "https://p.example", getIdToken: async () => "SECRET-TOKEN", fetch: (async () => { throw new Error("connect to https://p.example with SECRET-TOKEN failed"); }) as typeof fetch });
    const error = await failing.pack("windows", files).catch((e: Error) => e);
    expect(error).toBeInstanceOf(PackagerUnavailableError);
    expect(String((error as Error).message)).not.toContain("SECRET");
  });
});
