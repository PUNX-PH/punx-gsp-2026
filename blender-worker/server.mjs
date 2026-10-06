// The Blender worker's HTTP wrapper: the private Cloud Run service that Play calls (see web/src/lib/blender/client.ts for the
// other end). One request is one job, and each job runs a fresh headless Blender in a throwaway folder:
//
//   POST /prepare?format=glb|fbx|obj&triangles=100..5000&color=original|#rrggbb   body: the model file
//   POST /shape                                                                    body: {"shape": "...", "color": "#rrggbb"}
//   POST /build                                                                    body: {"recipe": {...}, "motions": {...}, "palette": [5 colors]}
//   GET  /health        (not /healthz: Cloud Run reserves some paths that end in "z" and answers them itself)
//
// A good answer is 200 with the GLB as the body and the triangle counts in X-Triangles-Before and X-Triangles-After (for /build:
// X-Triangles, X-Parts and X-Clips, the clips being a comma-separated list that may be empty). /build's body is JSON of at most 64 KiB
// that this wrapper checks again (recipe.mjs) before Blender ever starts: a body that fails is 422 "bad-recipe". Every
// failure is a status and a JSON body with a code and nothing else: nothing Blender or the system said is ever sent or logged. A code
// of 413, 415, 422, 500 or 504 means Blender ran and said no to the file; 503 "unavailable" means the service itself is broken (Blender
// could not be started, a missing library, no room for a job folder), which is never the person's file to blame.
// Nothing here trusts its input (the query, the body, the claimed format), and Blender is given only the one input file, with no
// secrets in its environment. Node built-ins only, so the image needs no `npm install`.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBuildBody } from "./recipe.mjs";

const SHAPES = ["cube", "sphere", "cone", "cylinder", "pyramid", "coin", "ring"];
const FORMATS = ["glb", "fbx", "obj"];
const TRIANGLES = { min: 100, max: 5000 };
const HEX = /^#[0-9a-f]{6}$/i;

const JOB_LIMIT_MS = 60_000;
const MAX_INPUT_BYTES = 32 * 1024 * 1024; // Cloud Run's HTTP/1 request limit; an upload to the web app stops at 4 MB long before this
const MAX_BUILD_BYTES = 64 * 1024; // a recipe is a few KB of JSON: anything near this is not one
const BUILD_CLIPS = ["Run", "Jump", "Loop"];

const GLB_MAGIC = "glTF";
const FBX_MAGIC = "Kaydara FBX Binary  ";
const OBJ_HEAD_BYTES = 64 * 1024;

// How the Blender scripts say why they stopped (anything else non-zero is a plain failure).
const EXIT_EMPTY = 3;
const EXIT_BAD_FORMAT = 4;
const EXIT_BAD_RECIPE = 5; // build.py found a rule the recipe breaks that only it can see (parts or triangles over the caps once built)
const EXIT_COULD_NOT_START = 127; // what the loader exits with when Blender cannot start (a missing library): not about the file

/** A refusal: an HTTP status and one of the codes the client knows. */
class Refusal extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const startsWith = (bytes, text) => bytes.length >= text.length && Buffer.from(text, "latin1").equals(bytes.subarray(0, text.length));

// The first bytes must be what the query says: GLB and FBX by their headers, OBJ as text (no NUL byte).
function matchesFormat(format, bytes) {
  if (format === "glb") return startsWith(bytes, GLB_MAGIC);
  if (format === "fbx") return startsWith(bytes, FBX_MAGIC);
  return !bytes.subarray(0, OBJ_HEAD_BYTES).includes(0);
}

function prepareParams(url) {
  const format = url.searchParams.get("format");
  const triangles = url.searchParams.get("triangles");
  const color = url.searchParams.get("color");
  const ok =
    FORMATS.includes(format) &&
    triangles !== null &&
    /^\d+$/.test(triangles) &&
    Number(triangles) >= TRIANGLES.min &&
    Number(triangles) <= TRIANGLES.max &&
    color !== null &&
    (color === "original" || HEX.test(color));
  if (!ok) throw new Refusal(400, "bad-request");
  return { format, triangles: Number(triangles), color };
}

function shapeParams(bytes) {
  let body;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Refusal(400, "bad-request");
  }
  const keys = typeof body === "object" && body !== null && !Array.isArray(body) ? Object.keys(body).sort().join(",") : "";
  if (keys !== "color,shape" || typeof body.shape !== "string" || !SHAPES.includes(body.shape) || typeof body.color !== "string" || !HEX.test(body.color)) {
    throw new Refusal(400, "bad-request");
  }
  return { shape: body.shape, color: body.color.toLowerCase() };
}

// The whole body, up to `max` bytes: refused by its declared length before any of it is read, and again as it streams (a body with no
// length). Past the cap the rest is thrown away as it arrives, never kept.
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

/**
 * The worker as an http.Server (not listening yet). `blenderBin` is the Blender program; `extraArgs` go before Blender's own
 * arguments (the tests use them to run a fake); `scriptsDir` holds prepare.py and shape.py; `workRoot` is where throwaway job
 * folders are made.
 */
export function createWorker(options) {
  const { blenderBin, scriptsDir } = options;
  const extraArgs = options.extraArgs ?? [];
  const workRoot = options.workRoot ?? tmpdir();
  const jobLimitMs = options.jobLimitMs ?? JOB_LIMIT_MS;
  const maxInputBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;
  const log = options.log ?? (() => {});

  // Blender sees no secret: not the wrapper's own environment, only what it needs to start in a folder of its own.
  const blenderEnv = (dir) => ({
    HOME: dir,
    TMPDIR: dir,
    LANG: "C.UTF-8",
    PATH: "/usr/bin:/bin",
    ...(process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  });

  function runBlender(cwd, script, scriptArgs) {
    return new Promise((resolve) => {
      let timedOut = false;
      const args = [...extraArgs, "-b", "--factory-startup", "--disable-autoexec", "-noaudio", "--python-exit-code", "1", "-P", script, "--", ...scriptArgs];
      const child = spawn(blenderBin, args, { cwd, env: blenderEnv(cwd), stdio: "ignore" }); // its output is never kept
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, jobLimitMs);
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ code: -1, timedOut: false, notStarted: true }); // Blender is missing or cannot be run
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, timedOut });
      });
    });
  }

  // One job: a folder of its own, Blender once, then the folder is removed whatever happened. A build job also gets `recipe`, the
  // already-checked body, written to a file of our own name.
  async function runJob(script, input, scriptArgs, job = {}) {
    const dir = await mkdtemp(path.join(workRoot, "job-"));
    try {
      const out = path.join(dir, "out.glb");
      const stats = path.join(dir, "stats.json");
      const args = [];
      if (input) {
        const inputPath = path.join(dir, `input.${input.format}`); // a name of ours: nothing the person typed reaches a path
        await writeFile(inputPath, input.bytes);
        args.push("--in", inputPath, "--format", input.format);
      }
      if (job.recipe) {
        const recipePath = path.join(dir, "recipe.json");
        await writeFile(recipePath, JSON.stringify(job.recipe));
        args.push("--recipe", recipePath);
      }
      args.push(...scriptArgs, "--out", out, "--stats", stats);

      const { code, timedOut, notStarted } = await runBlender(dir, path.join(scriptsDir, script), args);
      if (notStarted || code === EXIT_COULD_NOT_START) throw new Refusal(503, "unavailable");
      if (timedOut) throw new Refusal(504, "timeout");
      if (code === EXIT_EMPTY) throw new Refusal(422, "empty");
      if (code === EXIT_BAD_FORMAT) throw new Refusal(415, "bad-format");
      if (job.recipe && code === EXIT_BAD_RECIPE) throw new Refusal(422, "bad-recipe");
      if (code !== 0) throw new Refusal(500, "failed");

      let glb;
      let counts;
      try {
        glb = await readFile(out);
        counts = JSON.parse(await readFile(stats, "utf8"));
      } catch {
        throw new Refusal(500, "failed"); // Blender said it was done but left nothing usable
      }
      if (job.recipe) {
        const { triangles, parts, clips, vertices } = counts ?? {};
        const clipsOk = Array.isArray(clips) && new Set(clips).size === clips.length && clips.every((c) => BUILD_CLIPS.includes(c));
        if (glb.length === 0 || !Number.isInteger(triangles) || triangles < 1 || !Number.isInteger(parts) || parts < 1 || !clipsOk) throw new Refusal(500, "failed");
        // A High build also reports how many shared vertices the GLB holds (it is what the game decodes); without it the answer is not usable.
        if (job.recipe.recipe?.quality === "high") {
          if (!Number.isInteger(vertices) || vertices < 1) throw new Refusal(500, "failed");
          return { glb, triangles, parts, clips, vertices };
        }
        return { glb, triangles, parts, clips };
      }
      const after = counts?.after;
      if (glb.length === 0 || !Number.isInteger(after) || after < 1) throw new Refusal(500, "failed");
      const before = Number.isInteger(counts.before) && counts.before >= 0 ? counts.before : null;
      return { glb, before, after };
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }

  function sendModel(res, { glb, before, after }) {
    res.writeHead(200, {
      "content-type": "model/gltf-binary",
      "content-length": glb.length,
      "x-triangles-after": String(after),
      ...(before === null ? {} : { "x-triangles-before": String(before) }),
    });
    res.end(glb);
  }

  function sendBuild(res, { glb, triangles, parts, clips, vertices }) {
    res.writeHead(200, {
      "content-type": "model/gltf-binary",
      "content-length": glb.length,
      "x-triangles": String(triangles),
      "x-parts": String(parts),
      "x-clips": clips.join(","),
      ...(vertices === undefined ? {} : { "x-vertices": String(vertices) }),
    });
    res.end(glb);
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const wanted = { "/health": "GET", "/prepare": "POST", "/shape": "POST", "/build": "POST" }[url.pathname];
    if (!wanted) throw new Refusal(404, "bad-request");
    if (req.method !== wanted) throw new Refusal(405, "bad-request");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    if (url.pathname === "/prepare") {
      const { format, triangles, color } = prepareParams(url);
      const bytes = await readBody(req, maxInputBytes);
      if (bytes.length === 0) throw new Refusal(422, "empty");
      if (!matchesFormat(format, bytes)) throw new Refusal(415, "bad-format");
      sendModel(res, await runJob("prepare.py", { bytes, format }, ["--triangles", String(triangles), "--color", color]));
      return;
    }

    if (url.pathname === "/build") {
      const bytes = await readBody(req, MAX_BUILD_BYTES); // too big is refused before any of it is parsed
      let body;
      try {
        body = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new Refusal(400, "bad-request");
      }
      if (checkBuildBody(body) !== null) throw new Refusal(422, "bad-recipe"); // the caller is not trusted: Blender never sees a body that fails
      sendBuild(res, await runJob("build.py", null, [], { recipe: body }));
      return;
    }

    const { shape, color } = shapeParams(await readBody(req, maxInputBytes));
    sendModel(res, await runJob("shape.py", null, ["--shape", shape, "--color", color]));
  }

  return createServer((req, res) => {
    const started = Date.now();
    handle(req, res)
      .catch((error) => {
        // Anything the wrapper did not expect is the service's trouble, not a verdict on the file.
        const refusal = error instanceof Refusal ? error : new Refusal(503, "unavailable");
        if (res.headersSent) res.destroy();
        else {
          req.resume(); // a body nobody will read is thrown away, not buffered
          reply(res, refusal.status, { error: refusal.code });
        }
      })
      .finally(() => log({ method: req.method, path: new URL(req.url ?? "/", "http://localhost").pathname, status: res.statusCode, ms: Date.now() - started }));
  });
}

// Run as the main file (the container's command): listen on Cloud Run's port, and stop cleanly when told to.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = createWorker({
    blenderBin: process.env.BLENDER_BIN ?? "blender",
    scriptsDir: path.join(here, "scripts"),
    log: (info) => console.log(JSON.stringify(info)),
  });
  server.listen(Number(process.env.PORT ?? 8080));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
