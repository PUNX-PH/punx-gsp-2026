// A quick end-to-end check of a running worker: node smoke.mjs <baseUrl> [identityToken]
//
// Against the real container on your machine: node smoke.mjs http://localhost:8080
// Against Cloud Run (private, so it needs a token): node smoke.mjs https://blender-worker-xxxx.a.run.app "$(gcloud auth print-identity-token)"
// With a token it also checks that a call with no token is refused. Each line shows how long the call took (the first call to Cloud Run
// after it has been idle includes the cold start). Exits 1 if any check failed.
import { readFileSync } from "node:fs";

const [baseUrl, token] = process.argv.slice(2);
if (!baseUrl) {
  console.error("usage: node smoke.mjs <baseUrl> [identityToken]");
  process.exit(2);
}
const base = baseUrl.replace(/\/+$/, "");
const authorised = token ? { authorization: `Bearer ${token}` } : {};
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

let failures = 0;
async function check(name, run) {
  const started = Date.now();
  try {
    await run();
    console.log(`ok    ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}: ${error.message}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const isGlb = (bytes) => Buffer.from(bytes).subarray(0, 4).toString("latin1") === "glTF";

await check("GET /healthz", async () => {
  const response = await fetch(`${base}/healthz`, { headers: authorised });
  expect(response.status === 200, `status ${response.status}`);
});

await check("POST /prepare, the cube OBJ", async () => {
  const response = await fetch(`${base}/prepare?format=obj&triangles=2000&color=original`, { method: "POST", headers: authorised, body: fixture("cube.obj") });
  expect(response.status === 200, `status ${response.status}`);
  const after = Number(response.headers.get("x-triangles-after"));
  expect(Number.isInteger(after) && after >= 1 && after <= 2000, `x-triangles-after is ${response.headers.get("x-triangles-after")}`);
  expect(isGlb(await response.arrayBuffer()), "the body is not a GLB");
});

await check("POST /prepare, an OBJ with nothing in it (422 empty)", async () => {
  const response = await fetch(`${base}/prepare?format=obj&triangles=2000&color=original`, { method: "POST", headers: authorised, body: fixture("empty.obj") });
  expect(response.status === 422, `status ${response.status}`);
  expect((await response.text()) === '{"error":"empty"}', "the body is not just the code");
});

await check("POST /shape, a sphere", async () => {
  const response = await fetch(`${base}/shape`, { method: "POST", headers: authorised, body: JSON.stringify({ shape: "sphere", color: "#06d6a0" }) });
  expect(response.status === 200, `status ${response.status}`);
  expect(Number(response.headers.get("x-triangles-after")) >= 1, "no triangle count");
  expect(isGlb(await response.arrayBuffer()), "the body is not a GLB");
});

if (token) {
  await check("a call with no token is refused (Cloud Run answers 401 or 403)", async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status === 401 || response.status === 403, `status ${response.status}`);
  });
}

console.log(failures === 0 ? "all checks passed" : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
