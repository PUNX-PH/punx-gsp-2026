import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "@/lib/auth/ports";
import { EXAMPLE_GAMES } from "@/lib/script/examples";
import { makeGlb } from "@/lib/testing/glb";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { RunError, type RunService } from "@/lib/runs/types";

const FIXTURES = fileURLToPath(new URL("../../../../fixtures/settings/", import.meta.url));
const settings = (models: string[]) => JSON.stringify({ ...JSON.parse(readFileSync(FIXTURES + "valid.json", "utf8")), script: { file: "game.lua", models } });
const glb = () => makeGlb({ asset: { version: "2.0" } });
const text = (s: string) => new TextEncoder().encode(s);

const alice: User = { uid: "alice", email: "alice@punx.ai" };
let service: RunService;
let files: MemoryFileStore;
let ids = 0;

beforeEach(() => {
  ids = 0;
  files = new MemoryFileStore();
  service = makeRunService({ records: new MemoryRunRecords(), files, now: () => 1_000_000, newId: () => `run${++ids}` });
});

async function failure(promise: Promise<unknown>): Promise<RunError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RunError);
  return error as RunError;
}

describe("a run of a script game", () => {
  it("needs game.lua and the entity files, and is ready when they are all there", async () => {
    const { id, needed } = await service.createRun(alice, settings(["hero"]));
    expect(needed).toEqual(["game.lua", "entity-hero.glb"]);
    expect((await service.putFile(alice, id, "game.lua", text(EXAMPLE_GAMES.flier))).status).toBe("pending");
    expect((await service.putFile(alice, id, "entity-hero.glb", glb())).status).toBe("ready");
  });

  it("is ready with game.lua alone when the script names no models", async () => {
    const { id } = await service.createRun(alice, settings([]));
    expect((await service.putFile(alice, id, "game.lua", text(EXAMPLE_GAMES.catcher))).status).toBe("ready");
  });

  it("serves game.lua back as text", async () => {
    const { id } = await service.createRun(alice, settings([]));
    await service.putFile(alice, id, "game.lua", text(EXAMPLE_GAMES.runner));
    const read = await service.readFile(alice, id, "game.lua");
    expect(new TextDecoder().decode(read.bytes)).toBe(EXAMPLE_GAMES.runner);
    expect(read.contentType).toMatch(/^text\/plain/);
  });

  it("refuses a game.lua that does not pass the script check, with the reason, and stores nothing", async () => {
    const { id } = await service.createRun(alice, settings([]));
    const error = await failure(service.putFile(alice, id, "game.lua", text("function update(dt)\n  os.exit()\nend")));
    expect(error.status).toBe(400);
    expect(error.message).toContain("game.lua");
    expect(error.message).toContain("`os`");
    expect(await files.get(id, "game.lua")).toBeNull();
  });

  it("refuses a game.lua that is not valid UTF-8, one that is empty, and one that is over 64 KiB", async () => {
    const { id } = await service.createRun(alice, settings([]));
    expect((await failure(service.putFile(alice, id, "game.lua", new Uint8Array([0xff, 0xfe, 0x66])))).message).toMatch(/UTF-8/);
    expect((await failure(service.putFile(alice, id, "game.lua", text("   ")))).message).toMatch(/empty/);
    expect((await failure(service.putFile(alice, id, "game.lua", text("-- " + "x".repeat(70_000) + "\nfunction update(dt) end")))).message).toMatch(/bytes/);
  });

  it("still checks the entity files as GLBs, and takes no GLB as game.lua's content", async () => {
    const { id } = await service.createRun(alice, settings(["hero"]));
    expect((await failure(service.putFile(alice, id, "entity-hero.glb", text("not a model")))).status).toBe(400);
    expect((await failure(service.putFile(alice, id, "game.lua", glb()))).status).toBe(400);
  });

  it("does not accept game.lua in a run that is not a script game", async () => {
    const plain = JSON.parse(readFileSync(FIXTURES + "valid.json", "utf8"));
    const { id } = await service.createRun(alice, JSON.stringify(plain));
    expect((await failure(service.putFile(alice, id, "game.lua", text(EXAMPLE_GAMES.flier)))).status).toBe(400);
  });
});
