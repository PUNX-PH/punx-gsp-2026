// The packager: the private Cloud Run service that turns a finished game into something a person can install. The owner builds a Windows player and an
// Android player once with Unity (the same player the website runs, built for those platforms) and puts them in PLAYERS_DIR; this adds one game's
// files (settings.json, game.lua for a script game, and the entity models) to a copy of the player and hands it back. No Unity Editor runs here and nothing is compiled.
//
//   POST /package?platform=windows|android   body: {"files": [{"name": "settings.json", "data": "<base64>"}, ...]}
//   GET  /health
//
// Windows: the zip of the player with the game's files added under the player's StreamingAssets/game/. Android: the same inside the APK's assets/game/,
// with the old signature removed and a new one made by apksigner with the studio's keystore (the key is read from the environment and never leaves it).
// A good answer is 200 with the file as the body. Every failure is a status and a JSON body with a code and nothing else; nothing a tool or the system
// said is ever sent or logged. The body is checked again here (names, sizes, GLB headers, settings.json as JSON) because the caller is not trusted.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listZip, rebuildZip } from "./zip.mjs";

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_FILES_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 22; // settings.json, a script and up to twenty models
const MAX_SETTINGS_BYTES = 128 * 1024;
const FILE_NAME = /^(?:[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(?:json|glb)|game\.lua)$/;
const SCRIPT_FILE = "game.lua";
const MAX_SCRIPT_BYTES = 64 * 1024;
const SIGN_LIMIT_MS = 60_000;
const PLATFORMS = ["windows", "android"];
// What a signature is made of; the rest of META-INF (service files, version files) is the player's and stays.
const SIGNATURE_FILE = /^META-INF\/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))$/i;

class Refusal extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > max) {
      req.resume();
      reject(new Refusal(413, "too-big"));
      return;
    }
    const chunks = [];
    let total = 0;
    let finished = false;
    req.on("data", (chunk) => {
      if (finished) return;
      total += chunk.length;
      if (total > max) {
        finished = true;
        chunks.length = 0;
        reject(new Refusal(413, "too-big"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!finished) resolve(Buffer.concat(chunks));
    });
    req.on("error", () => {
      if (!finished) {
        finished = true;
        reject(new Refusal(400, "bad-request"));
      }
    });
  });
}

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** A game's script as the packager can check it: not empty, within its size, UTF-8 and with no NUL. (The website parses it and the player runs it in its own sandbox.) */
function isScriptText(data) {
  if (data.length === 0 || data.length > MAX_SCRIPT_BYTES || data.includes(0)) return false;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data).trim() !== "";
  } catch {
    return false;
  }
}

/** The game's files from the request body, checked; 400 for a body that is not the right shape, 422 for files that are not acceptable. */
function gameFiles(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Refusal(400, "bad-request");
  }
  const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObject(parsed) || Object.keys(parsed).join() !== "files" || !Array.isArray(parsed.files) || parsed.files.length === 0 || parsed.files.length > MAX_FILES) {
    throw new Refusal(400, "bad-request");
  }
  const seen = new Set();
  let total = 0;
  const files = parsed.files.map((f) => {
    if (!isObject(f) || Object.keys(f).sort().join() !== "data,name" || typeof f.name !== "string" || typeof f.data !== "string") throw new Refusal(400, "bad-request");
    if (!FILE_NAME.test(f.name) || seen.has(f.name)) throw new Refusal(422, "bad-files");
    seen.add(f.name);
    if (f.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data)) throw new Refusal(422, "bad-files");
    const data = Buffer.from(f.data, "base64");
    total += data.length;
    if (total > MAX_FILES_BYTES) throw new Refusal(413, "too-big");
    if (f.name.endsWith(".glb") && data.subarray(0, 4).toString("latin1") !== "glTF") throw new Refusal(422, "bad-files");
    if (f.name === SCRIPT_FILE && !isScriptText(data)) throw new Refusal(422, "bad-files");
    return { name: f.name, data };
  });
  const settings = files.find((f) => f.name === "settings.json");
  if (!settings || settings.data.length > MAX_SETTINGS_BYTES) throw new Refusal(422, "bad-files");
  let value;
  try {
    value = JSON.parse(settings.data.toString("utf8"));
    if (!isObject(value)) throw new Error("not an object");
  } catch {
    throw new Refusal(422, "bad-files");
  }
  // A script game is settings that name a script plus game.lua, and nothing else is: neither one without the other, and not together with a game of rules.
  const hasScript = files.some((f) => f.name === SCRIPT_FILE);
  if (hasScript !== Object.hasOwn(value, "script") || (hasScript && Object.hasOwn(value, "game"))) throw new Refusal(422, "bad-files");
  return files;
}

async function loadPlayer(playersDir, platform) {
  let entry;
  try {
    const all = JSON.parse(await readFile(path.join(playersDir, "players.json"), "utf8"));
    entry = all[platform];
  } catch {
    throw new Refusal(503, "not-set-up");
  }
  const ok = entry && typeof entry.file === "string" && /^[A-Za-z0-9._-]+$/.test(entry.file) && typeof entry.gamePath === "string" && entry.gamePath.endsWith("/") && !entry.gamePath.includes("..") && !entry.gamePath.startsWith("/");
  if (!ok) throw new Refusal(503, "not-set-up");
  let bytes;
  try {
    bytes = await readFile(path.join(playersDir, entry.file));
    listZip(bytes);
  } catch {
    throw new Refusal(503, "not-set-up");
  }
  return { bytes, gamePath: entry.gamePath };
}

function sign(options, inPath, outPath) {
  return new Promise((resolve, reject) => {
    execFile(
      options.apksigner,
      [...(options.apksignerArgs ?? []), "sign", "--ks", options.keystorePath, "--ks-pass", "env:KEYSTORE_PASS", "--out", outPath, inPath],
      { timeout: SIGN_LIMIT_MS, env: { PATH: process.env.PATH ?? "", KEYSTORE_PASS: options.keystorePass ?? "" }, windowsHide: true },
      (error) => (error ? reject(new Refusal(500, "failed")) : resolve()),
    );
  });
}

/**
 * The packager as an http.Server (not listening yet). `playersDir` holds players.json ({ windows: { file, gamePath }, android: { file, gamePath } })
 * and the player files; `apksigner` is the signing program (and `apksignerArgs` go before its own arguments: the tests run a fake); `keystorePath`
 * and `keystorePass` are the studio's key; `workRoot` is where throwaway folders are made.
 */
export function createPackager(options) {
  const workRoot = options.workRoot ?? tmpdir();
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") return reply(res, 200, { ok: true });
      if (req.method !== "POST" || url.pathname !== "/package") throw new Refusal(404, "not-found");
      const platform = url.searchParams.get("platform");
      if (!PLATFORMS.includes(platform)) throw new Refusal(400, "bad-request");

      const files = gameFiles(await readBody(req, MAX_BODY_BYTES));
      const player = await loadPlayer(options.playersDir, platform);
      const android = platform === "android";
      if (android && !options.keystorePath) throw new Refusal(503, "not-set-up");

      const packed = rebuildZip(player.bytes, {
        drop: (name) => android && SIGNATURE_FILE.test(name),
        add: files.map((f) => ({ name: player.gamePath + f.name, data: f.data })),
      });

      let out = packed;
      if (android) {
        const dir = await mkdtemp(path.join(workRoot, "pack-"));
        try {
          await writeFile(path.join(dir, "game.apk"), packed);
          await sign(options, path.join(dir, "game.apk"), path.join(dir, "signed.apk"));
          out = await readFile(path.join(dir, "signed.apk"));
        } catch (error) {
          throw error instanceof Refusal ? error : new Refusal(500, "failed");
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
      res.writeHead(200, {
        "content-type": android ? "application/vnd.android.package-archive" : "application/zip",
        "content-length": out.length,
        "x-file-name": android ? "game-android.apk" : "game-windows.zip",
      });
      res.end(out);
    } catch (error) {
      if (error instanceof Refusal) return reply(res, error.status, { code: error.code });
      console.error("packager failed", { kind: error instanceof Error ? error.name : typeof error }); // never the message: it could quote a path or a key
      reply(res, 500, { code: "failed" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createPackager({
    playersDir: process.env.PLAYERS_DIR ?? "/players",
    apksigner: process.env.APKSIGNER ?? "apksigner",
    keystorePath: process.env.KEYSTORE_PATH,
    keystorePass: process.env.KEYSTORE_PASS,
  });
  server.listen(Number(process.env.PORT ?? 8080));
}
