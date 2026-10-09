import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "@/lib/auth/ports";
import { makeGlb } from "@/lib/testing/glb";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { RunError, type RunService } from "@/lib/runs/types";

const FIXTURES = fileURLToPath(new URL("../../../../fixtures/settings/", import.meta.url));
const validSettings = readFileSync(FIXTURES + "valid.json", "utf8");
const glb = (marker = 0) => makeGlb({ asset: { version: "2.0" }, extras: { marker } });

const alice: User = { uid: "alice", email: "alice@punx.ai" };
const bob: User = { uid: "bob", email: "bob@punx.ai" };

const HOUR = 3_600_000;
let clock = 1_000_000;
let ids = 0;
let records: MemoryRunRecords;
let files: MemoryFileStore;
let service: RunService;

beforeEach(() => {
  clock = 1_000_000;
  ids = 0;
  records = new MemoryRunRecords();
  files = new MemoryFileStore();
  service = makeRunService({ records, files, now: () => clock, newId: () => `run${++ids}` });
});

function settingsWith(roles: { hero: string; obstacle: string; collectible: string }): string {
  const base = JSON.parse(validSettings);
  base.roles = roles;
  return JSON.stringify(base);
}

async function failure(promise: Promise<unknown>): Promise<RunError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RunError);
  return error as RunError;
}

async function readyRun(user = alice) {
  const { id } = await service.createRun(user, validSettings);
  for (const name of ["hero.glb", "obstacle.glb", "coin.glb"]) await service.putFile(user, id, name, glb());
  return id;
}

describe("createRun", () => {
  it("returns an id and the distinct file names the settings need", async () => {
    expect(await service.createRun(alice, validSettings)).toEqual({ id: "run1", needed: ["hero.glb", "obstacle.glb", "coin.glb"] });
    const shared = await service.createRun(alice, settingsWith({ hero: "hero.glb", obstacle: "hero.glb", collectible: "coin.glb" }));
    expect(shared.needed).toEqual(["hero.glb", "coin.glb"]);
  });

  it("refuses invalid settings with the validator's own message", async () => {
    const unwinnable = readFileSync(FIXTURES + "invalid-unwinnable-jump.json", "utf8");
    const error = await failure(service.createRun(alice, unwinnable));
    expect(error.status).toBe(400);
    expect(error.message).toContain("settings.tuning.jumpHeight");
    expect(records.runs.size).toBe(0);
  });

  it("stores the settings without a byte-order mark", async () => {
    const { id } = await service.createRun(alice, "﻿" + validSettings);
    const stored = await files.get(id, "settings.json");
    expect(new TextDecoder().decode(stored!)).toBe(validSettings);
    expect((await records.get(id))!.files["settings.json"].size).toBe(new TextEncoder().encode(validSettings).length);
  });

  it("refuses a 21st run, counting pending ones, with the exact message", async () => {
    for (let i = 0; i < 20; i++) await service.createRun(alice, validSettings);
    const error = await failure(service.createRun(alice, validSettings));
    expect(error).toMatchObject({ status: 409, message: "You have 20 runs. Delete one first." });
    await expect(service.createRun(bob, validSettings)).resolves.toBeDefined(); // the cap is per person
  });

  it("deletes a pending run older than an hour, and keeps a younger one", async () => {
    const old = (await service.createRun(alice, validSettings)).id;
    clock += HOUR + 1;
    const young = (await service.createRun(alice, validSettings)).id;
    expect(records.runs.has(old)).toBe(false);
    expect([...files.files.keys()].some((k) => k.startsWith(`${old}/`))).toBe(false);
    expect(records.runs.has(young)).toBe(true);
  });

  it("frees a slot when a stale pending run is the 20th", async () => {
    for (let i = 0; i < 20; i++) await service.createRun(alice, validSettings);
    clock += HOUR + 1;
    await expect(service.createRun(alice, validSettings)).resolves.toBeDefined();
  });
});

describe("a run with an environment", () => {
  const environmentSettings = readFileSync(FIXTURES + "valid-environment.json", "utf8");
  const ALL = ["hero.glb", "obstacle.glb", "coin.glb", "scenery1.glb", "scenery2.glb", "scenery3.glb"];

  it("needs the scenery files too, and is ready only when all of them are stored", async () => {
    const { id, needed } = await service.createRun(alice, environmentSettings);
    expect(needed).toEqual(ALL);
    for (const name of ALL.slice(0, -1)) expect((await service.putFile(alice, id, name, glb())).status).toBe("pending");
    expect((await service.putFile(alice, id, "scenery3.glb", glb())).status).toBe("ready");
  });

  it("accepts scenery1.glb and refuses a scenery file the settings did not name", async () => {
    const { id } = await service.createRun(alice, environmentSettings);
    await service.putFile(alice, id, "scenery1.glb", glb());
    expect(await failure(service.putFile(alice, id, "scenery4.glb", glb()))).toMatchObject({
      status: 400,
      message: "scenery4.glb is not one of this run's files",
    });
  });
});

describe("a phone variant of a file", () => {
  it("is accepted beside a file the run needs, does not change when the run is ready, and is refused for a file it does not", async () => {
    const { id, needed } = await service.createRun(alice, environmentSettingsFor());
    for (const name of needed) await service.putFile(alice, id, name, glb());
    expect((await service.listRuns(alice))[0].status).toBe("ready");
    await service.putFile(alice, id, "hero.mobile.glb", glb(1));
    expect((await service.readFile(alice, id, "hero.mobile.glb")).contentType).toBe("model/gltf-binary");
    expect(await failure(service.putFile(alice, id, "dragon.mobile.glb", glb()))).toMatchObject({ status: 400, message: "dragon.mobile.glb is not one of this run's files" });
    expect(await failure(service.putFile(alice, id, "hero.mobile.glb", glb()))).toMatchObject({ status: 409 });
  });
});

function environmentSettingsFor(): string {
  return validSettings;
}

describe("listRuns", () => {
  it("returns only the caller's runs, newest first, and removes stale pending ones", async () => {
    const a1 = await readyRun();
    clock += 1000;
    const a2 = (await service.createRun(alice, validSettings)).id;
    await service.createRun(bob, validSettings);
    expect((await service.listRuns(alice)).map((r) => r.id)).toEqual([a2, a1]);

    clock += HOUR + 1;
    expect((await service.listRuns(alice)).map((r) => r.id)).toEqual([a1]); // the pending one is gone; the ready one stays
  });
});

describe("putFile", () => {
  it("refuses a name that is not one of the run's files, settings.json included", async () => {
    const { id } = await service.createRun(alice, validSettings);
    for (const name of ["other.glb", "settings.json", "../hero.glb"]) {
      expect(await failure(service.putFile(alice, id, name, glb()))).toMatchObject({ status: 400 });
    }
  });

  it("refuses a bad GLB with the checker's message and stores nothing", async () => {
    const { id } = await service.createRun(alice, validSettings);
    const error = await failure(service.putFile(alice, id, "hero.glb", new Uint8Array(20)));
    expect(error).toMatchObject({ status: 400, message: "hero.glb: not a GLB file (wrong header)" });
    expect(files.files.has(`${id}/hero.glb`)).toBe(false);
  });

  it("refuses a second upload of a stored file", async () => {
    const { id } = await service.createRun(alice, validSettings);
    await service.putFile(alice, id, "hero.glb", glb());
    expect(await failure(service.putFile(alice, id, "hero.glb", glb()))).toMatchObject({ status: 409, message: "hero.glb was already uploaded" });
  });

  it("answers 404 for someone else's run and for a missing one", async () => {
    const { id } = await service.createRun(alice, validSettings);
    expect(await failure(service.putFile(bob, id, "hero.glb", glb()))).toMatchObject({ status: 404, message: "Not found" });
    expect(await failure(service.putFile(alice, "nope", "hero.glb", glb()))).toMatchObject({ status: 404, message: "Not found" });
  });

  it("becomes ready on the last needed file, and not before", async () => {
    const { id } = await service.createRun(alice, validSettings);
    expect((await service.putFile(alice, id, "hero.glb", glb())).status).toBe("pending");
    expect((await service.putFile(alice, id, "obstacle.glb", glb())).status).toBe("pending");
    expect((await service.putFile(alice, id, "coin.glb", glb())).status).toBe("ready");
  });

  it("ends up ready with every file when three uploads run at once", async () => {
    const { id, needed } = await service.createRun(alice, validSettings);
    await Promise.all(needed.map((name) => service.putFile(alice, id, name, glb())));
    const run = (await records.get(id))!;
    expect(run.status).toBe("ready");
    expect(Object.keys(run.files).sort()).toEqual(["coin.glb", "hero.glb", "obstacle.glb", "settings.json"]);
    expect(run.needed).toEqual(["hero.glb", "obstacle.glb", "coin.glb"]);
  });

  it("lets one of two simultaneous uploads of the same file win, and keeps the winner's bytes", async () => {
    const { id } = await service.createRun(alice, validSettings);
    const first = glb(1);
    const second = glb(2);
    const results = await Promise.allSettled([service.putFile(alice, id, "hero.glb", first), service.putFile(alice, id, "hero.glb", second)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ status: 409 });

    const stored = (await files.get(id, "hero.glb"))!;
    const winnerBytes = results[0].status === "fulfilled" ? first : second;
    expect(Array.from(stored)).toEqual(Array.from(winnerBytes));
    expect((await records.get(id))!.files["hero.glb"].sha256).toBe(createHash("sha256").update(winnerBytes).digest("hex"));
  });

  it("is ready after one upload when a single file serves every role", async () => {
    const { id, needed } = await service.createRun(alice, settingsWith({ hero: "all.glb", obstacle: "all.glb", collectible: "all.glb" }));
    expect(needed).toEqual(["all.glb"]);
    expect((await service.putFile(alice, id, "all.glb", glb())).status).toBe("ready");
  });

  it("records each file's size and SHA-256", async () => {
    const { id } = await service.createRun(alice, validSettings);
    const bytes = glb(9);
    const run = await service.putFile(alice, id, "hero.glb", bytes);
    expect(run.files["hero.glb"]).toEqual({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  });
});

describe("readFile", () => {
  it("gives the owner the bytes with the right content type", async () => {
    const id = await readyRun();
    const hero = await service.readFile(alice, id, "hero.glb");
    expect(hero.contentType).toBe("model/gltf-binary");
    expect(Array.from(hero.bytes)).toEqual(Array.from(glb()));
    const settings = await service.readFile(alice, id, "settings.json");
    expect(settings.contentType).toBe("application/json");
    expect(new TextDecoder().decode(settings.bytes)).toBe(validSettings);
  });

  it("keeps the GLB content type for an upper-case extension", async () => {
    const { id } = await service.createRun(alice, settingsWith({ hero: "Hero.GLB", obstacle: "obstacle.glb", collectible: "coin.glb" }));
    await service.putFile(alice, id, "Hero.GLB", glb());
    expect((await service.readFile(alice, id, "Hero.GLB")).contentType).toBe("model/gltf-binary");
  });

  it("serves only what the run's own record lists, never an object that merely exists in storage", async () => {
    const id = await readyRun();
    await files.put(id, "secret.glb", glb(), "model/gltf-binary"); // in storage, but not in the run's record
    expect(await failure(service.readFile(alice, id, "secret.glb"))).toMatchObject({ status: 404, message: "Not found" });
  });

  it("answers the same 404 for someone else's run, a missing run, and a name that is not stored", async () => {
    const id = await readyRun();
    const { id: pending } = await service.createRun(alice, validSettings);
    for (const attempt of [
      service.readFile(bob, id, "hero.glb"),
      service.readFile(alice, "nope", "hero.glb"),
      service.readFile(alice, id, "secret.glb"),
      service.readFile(alice, pending, "hero.glb"), // needed but not uploaded yet
    ]) {
      expect(await failure(attempt)).toMatchObject({ status: 404, message: "Not found" });
    }
  });
});

describe("deleteRun", () => {
  it("removes the record and its files, for the owner only", async () => {
    const id = await readyRun();
    expect(await failure(service.deleteRun(bob, id))).toMatchObject({ status: 404 });
    expect(records.runs.has(id)).toBe(true);

    await service.deleteRun(alice, id);
    expect(records.runs.has(id)).toBe(false);
    expect([...files.files.keys()].filter((k) => k.startsWith(`${id}/`))).toEqual([]);
  });
});

describe("run ids and file names are never trusted as keys", () => {
  it.each([["a slash", "a/b"], ["a reserved Firestore id", "__name__"], ["an empty id", ""], ["a path", "../other"], ["a very long id", "x".repeat(200)], ["a space", "run 1"]])(
    "answers the uniform 404 for an id with %s, without asking the record store",
    async (_label, badId) => {
      const asked: string[] = [];
      const get = records.get.bind(records);
      records.get = async (id) => {
        asked.push(id);
        return get(id);
      };
      for (const attempt of [service.readFile(alice, badId, "hero.glb"), service.putFile(alice, badId, "hero.glb", glb()), service.deleteRun(alice, badId)]) {
        expect(await failure(attempt)).toMatchObject({ status: 404, message: "Not found" });
      }
      expect(asked).toEqual([]);
    },
  );

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("does not serve %s as if it were a stored file", async (name) => {
    const id = await readyRun();
    let looked = 0;
    const get = files.get.bind(files);
    files.get = async (runId, fileName) => {
      looked++;
      return get(runId, fileName);
    };
    expect(await failure(service.readFile(alice, id, name))).toMatchObject({ status: 404, message: "Not found" });
    expect(looked).toBe(0); // refused before any path was built for the file store
  });
});
