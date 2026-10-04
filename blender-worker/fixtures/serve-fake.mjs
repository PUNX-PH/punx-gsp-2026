// Starts the worker's wrapper with the fake Blender in place of the real one, for trying smoke.mjs (or the web app) without Blender:
//   node fixtures/serve-fake.mjs [port]      then      node smoke.mjs http://localhost:<port>
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "../server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 8080);
createWorker({
  blenderBin: process.execPath,
  extraArgs: [path.join(here, "fake-blender.mjs")],
  scriptsDir: path.join(here, "..", "scripts"),
  log: (info) => console.log(JSON.stringify(info)),
}).listen(port, "127.0.0.1", () => console.log(`fake-Blender worker on http://127.0.0.1:${port}`));
