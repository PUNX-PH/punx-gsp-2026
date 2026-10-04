// The Blender worker as the web app sees it: one HTTP call per job to the private Cloud Run service (see blender-worker/server.mjs),
// with a Google ID token. A job's GLB comes back as the body, with its triangle counts in two headers. Everything that comes back is
// untrusted: the GLB is checked the way every other GLB in the app is, the counts must be real numbers, and nothing a failing
// response says is kept: a refusal is only ever a code, and anything else is just "not available" (plus the HTTP status).
import {
  BlenderRefusedError,
  BlenderUnavailableError,
  type BlenderWorker,
  type MadeModel,
} from "@/lib/blender/types";
import { checkGlb } from "@/lib/glb";

export interface BlenderClientDeps {
  /** The worker's address, for example https://blender-worker-xxxx.a.run.app (a slash at the end is fine). */
  baseUrl: string;
  /** A Google ID token for that address, from the invoker-only service account. */
  getIdToken: () => Promise<string>;
  fetch?: typeof fetch;
}

// The codes the worker uses when Blender ran and said no, and the one status each comes with. A code on any other status is not
// believed: it means something else answered (a proxy, an error page).
const REFUSALS = { "too-big": 413, "bad-format": 415, empty: 422, timeout: 504, failed: 500 } as const;
type Code = keyof typeof REFUSALS;
const isCode = (value: unknown): value is Code => typeof value === "string" && Object.hasOwn(REFUSALS, value);

const WHOLE_NUMBER = /^\d+$/;

export function makeBlenderWorker(deps: BlenderClientDeps): BlenderWorker {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const doFetch = deps.fetch ?? fetch;

  async function call(path: string, contentType: string, body: BodyInit, timeoutMs: number): Promise<MadeModel> {
    let response: Response;
    let bytes: Uint8Array;
    try {
      const token = await deps.getIdToken();
      response = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": contentType },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) throw await failureOf(response);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof BlenderRefusedError || error instanceof BlenderUnavailableError) throw error;
      throw new BlenderUnavailableError(); // no connection, no token, a timeout: nothing the error says is kept
    }

    const after = response.headers.get("x-triangles-after");
    if (bytes.length === 0 || !checkGlb("model", bytes).ok || after === null || !WHOLE_NUMBER.test(after) || Number(after) < 1) {
      throw new BlenderUnavailableError(200); // an answer, but not one a game could use
    }
    const before = response.headers.get("x-triangles-before");
    return { bytes, trianglesBefore: before !== null && WHOLE_NUMBER.test(before) ? Number(before) : null, trianglesAfter: Number(after) };
  }

  return {
    prepare: (input) =>
      call(
        `/prepare?${new URLSearchParams({ format: input.format, triangles: String(input.triangles), color: input.color ?? "original" })}`,
        "application/octet-stream",
        input.bytes as BodyInit,
        input.timeoutMs,
      ),
    shape: (input) => call("/shape", "application/json", JSON.stringify({ shape: input.shape, color: input.color }), input.timeoutMs),
  };
}

// A non-200 response is a refusal only when it is the worker's own { error: code } on that code's status.
async function failureOf(response: Response): Promise<BlenderRefusedError | BlenderUnavailableError> {
  try {
    const code = ((await response.json()) as { error?: unknown } | null)?.error;
    if (isCode(code) && REFUSALS[code] === response.status) return new BlenderRefusedError(code);
  } catch {
    // not JSON: treated as not available, below
  }
  return new BlenderUnavailableError(response.status);
}
