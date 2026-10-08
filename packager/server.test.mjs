import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createPackager } from "./server.mjs";
import { emptyZip, listZip, readStored, rebuildZip } from "./zip.mjs";

let dir;
let fakeLog;
let server;
let base;

// A fake apksigner: checks it is called the way apksigner is, remembers how, and "signs" by copying the file.
// (The packager gives the signer almost no environment, so the log and the failure switch are files, not variables.)
const fake = (logPath, failPath) => `
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const at = (flag) => args[args.indexOf(flag) + 1];
if (args[0] !== "sign" || !at("--ks") || at("--ks-pass") !== "env:KEYSTORE_PASS" || !process.env.KEYSTORE_PASS) process.exit(2);
writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({ ks: at("--ks"), pass: process.env.KEYSTORE_PASS, input: args.at(-1) }));
if (existsSync(${JSON.stringify(failPath)})) process.exit(1);
copyFileSync(args.at(-1), at("--out"));
`;

const b64 = (text) => Buffer.from(text).toString("base64");
const GLB = Buffer.concat([Buffer.from("glTF"), Buffer.from([2, 0, 0, 0])]).toString("base64");
const body = (files) => JSON.stringify({ files });
const post = (platform, files, raw) => fetch(`${base}/package?platform=${platform}`, { method: "POST", body: raw ?? body(files) });
const ok = [{ name: "settings.json", data: b64('{"schemaVersion":1}') }, { name: "entity-hero.glb", data: GLB }];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "packager-test-"));
  fakeLog = path.join(dir, "fake.log");
  const signer = path.join(dir, "fake-apksigner.mjs");
  await writeFile(signer, fake(fakeLog, path.join(dir, "fail")));
  const windows = rebuildZip(emptyZip(), { add: [{ name: "Runner.exe", data: Buffer.from("MZ") }, { name: "Runner_Data/app.info", data: Buffer.from("info") }] });
  const android = rebuildZip(emptyZip(), { add: [{ name: "AndroidManifest.xml", data: Buffer.from("m") }, { name: "META-INF/CERT.RSA", data: Buffer.from("old") }, { name: "META-INF/MANIFEST.MF", data: Buffer.from("old") }, { name: "META-INF/services/lib.Thing", data: Buffer.from("keep") }, { name: "META-INF/lib.version", data: Buffer.from("1") }] });
  await writeFile(path.join(dir, "windows.zip"), windows);
  await writeFile(path.join(dir, "android.apk"), android);
  await writeFile(path.join(dir, "players.json"), JSON.stringify({ windows: { file: "windows.zip", gamePath: "Runner_Data/StreamingAssets/game/" }, android: { file: "android.apk", gamePath: "assets/game/" } }));
  server = createPackager({ playersDir: dir, apksigner: process.execPath, apksignerArgs: [signer], keystorePath: "/secrets/studio.keystore", keystorePass: "s3cret-pass", workRoot: dir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

test("health", async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test("windows: the player's zip with the game's files under its StreamingAssets/game folder", async () => {
  const res = await post("windows", ok);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.equal(res.headers.get("x-file-name"), "game-windows.zip");
  const zip = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(listZip(zip).entries.map((e) => e.name), ["Runner.exe", "Runner_Data/app.info", "Runner_Data/StreamingAssets/game/settings.json", "Runner_Data/StreamingAssets/game/entity-hero.glb"]);
  assert.equal(readStored(zip, "Runner_Data/StreamingAssets/game/settings.json").toString(), '{"schemaVersion":1}');
});

test("android: the old signature files are removed (the rest of META-INF stays), the game goes under assets/game, and apksigner signs with the studio's key from the environment", async () => {
  const res = await post("android", ok);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.android.package-archive");
  assert.equal(res.headers.get("x-file-name"), "game-android.apk");
  const apk = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(listZip(apk).entries.map((e) => e.name), ["AndroidManifest.xml", "META-INF/services/lib.Thing", "META-INF/lib.version", "assets/game/settings.json", "assets/game/entity-hero.glb"]);
  const call = JSON.parse(await readFile(fakeLog, "utf8"));
  assert.equal(call.ks, "/secrets/studio.keystore");
  assert.equal(call.pass, "s3cret-pass");
});

test("android without a keystore is not set up, and a signer that fails is a plain failure that says nothing of it", async () => {
  const bare = createPackager({ playersDir: dir, apksigner: process.execPath, workRoot: dir });
  await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
  const res = await fetch(`http://127.0.0.1:${bare.address().port}/package?platform=android`, { method: "POST", body: body(ok) });
  bare.close();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { code: "not-set-up" });

  await writeFile(path.join(dir, "fail"), "1");
  const failed = await post("android", ok);
  await rm(path.join(dir, "fail"));
  assert.equal(failed.status, 500);
  const text = await failed.text();
  assert.deepEqual(JSON.parse(text), { code: "failed" });
  assert.ok(!text.includes("s3cret"));
});

test("refuses an unknown platform, a body that is not the right shape, and unknown routes", async () => {
  assert.equal((await post("ios", ok)).status, 400);
  assert.equal((await post("windows", null, "not json")).status, 400);
  assert.equal((await post("windows", null, JSON.stringify({ files: ok, extra: 1 }))).status, 400);
  assert.equal((await post("windows", [])).status, 400);
  assert.equal((await post("windows", [{ name: "settings.json" }])).status, 400);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test("refuses file names that could escape or overwrite, duplicates, a missing settings.json, bad GLBs and bad settings", async () => {
  const set = { name: "settings.json", data: b64("{}") };
  for (const name of ["../settings.json", "a/b.json", "/etc/passwd.json", "settings.JSON", "x.exe", ".json", "a b.glb", "entity-" + "x".repeat(70) + ".glb"]) {
    const res = await post("windows", [set, { name, data: GLB }]);
    assert.equal(res.status, 422, name);
  }
  assert.equal((await post("windows", [set, set])).status, 422);
  assert.equal((await post("windows", [{ name: "entity-a.glb", data: GLB }])).status, 422);
  assert.equal((await post("windows", [set, { name: "entity-a.glb", data: b64("not a glb") }])).status, 422);
  assert.equal((await post("windows", [{ name: "settings.json", data: b64("[1,2]") }])).status, 422);
  assert.equal((await post("windows", [{ name: "settings.json", data: b64("{broken") }])).status, 422);
  assert.equal((await post("windows", [{ name: "settings.json", data: "!!!not base64!!!" }])).status, 422);
});

test("refuses a body over the limit before reading it, and files over their limit", async () => {
  const big = await fetch(`${base}/package?platform=windows`, { method: "POST", body: Buffer.alloc(33 * 1024 * 1024, 65) });
  assert.equal(big.status, 413);
  const chunk = Buffer.concat([Buffer.from("glTF"), Buffer.alloc(5 * 1024 * 1024)]).toString("base64");
  const files = [{ name: "settings.json", data: b64("{}") }, ...Array.from({ length: 6 }, (_, i) => ({ name: `entity-${i}.glb`, data: chunk }))];
  assert.equal((await post("windows", files)).status, 413);
});

test("is not set up until a player is installed for the platform", async () => {
  const empty = await mkdtemp(path.join(tmpdir(), "packager-empty-"));
  const bare = createPackager({ playersDir: empty, workRoot: empty });
  await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
  const res = await fetch(`http://127.0.0.1:${bare.address().port}/package?platform=windows`, { method: "POST", body: body(ok) });
  bare.close();
  await rm(empty, { recursive: true, force: true });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { code: "not-set-up" });
});

// ---- a script game: settings.json that names a script, game.lua, and any models

const LUA = "function update(dt) end";
const scriptSettings = { name: "settings.json", data: b64('{"schemaVersion":1,"script":{"file":"game.lua","models":[]}}') };
const lua = (text = LUA) => ({ name: "game.lua", data: b64(text) });

test("windows and android: a script game's game.lua and models go in next to its settings", async () => {
  const win = await post("windows", [scriptSettings, lua(), { name: "entity-hero.glb", data: GLB }]);
  assert.equal(win.status, 200);
  const zip = Buffer.from(await win.arrayBuffer());
  assert.deepEqual(listZip(zip).entries.map((e) => e.name), ["Runner.exe", "Runner_Data/app.info", "Runner_Data/StreamingAssets/game/settings.json", "Runner_Data/StreamingAssets/game/game.lua", "Runner_Data/StreamingAssets/game/entity-hero.glb"]);
  assert.equal(readStored(zip, "Runner_Data/StreamingAssets/game/game.lua").toString(), LUA);
  const droid = await post("android", [scriptSettings, lua()]);
  assert.equal(droid.status, 200);
  const apk = Buffer.from(await droid.arrayBuffer());
  assert.ok(listZip(apk).entries.some((e) => e.name === "assets/game/game.lua"));
});

test("refuses a game.lua that is too big, not UTF-8, empty or has a NUL, and one that does not go with its settings", async () => {
  assert.equal((await post("windows", [scriptSettings, lua("-- " + "x".repeat(70_000))])).status, 422);
  assert.equal((await post("windows", [scriptSettings, { name: "game.lua", data: Buffer.from([0xff, 0xfe, 0x66]).toString("base64") }])).status, 422);
  assert.equal((await post("windows", [scriptSettings, lua("   ")])).status, 422);
  assert.equal((await post("windows", [scriptSettings, lua("a\0b")])).status, 422);
  // settings that name a script need game.lua, and a game.lua needs settings that name it
  assert.equal((await post("windows", [scriptSettings])).status, 422);
  assert.equal((await post("windows", [{ name: "settings.json", data: b64('{"schemaVersion":1}') }, lua()])).status, 422);
  assert.equal((await post("windows", [{ name: "settings.json", data: b64('{"script":{"file":"game.lua","models":[]},"game":{}}') }, lua()])).status, 422);
});

test("refuses other Lua names and paths: only game.lua", async () => {
  for (const name of ["other.lua", "../game.lua", "game.LUA", "a/game.lua", "game.lua.json", "main.lua"]) {
    assert.equal((await post("windows", [scriptSettings, { name, data: b64(LUA) }])).status, 422, name);
  }
  assert.equal((await post("windows", [scriptSettings, lua(), lua()])).status, 422);
});
