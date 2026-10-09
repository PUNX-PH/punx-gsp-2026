// The Blender worker as the web app sees it: one HTTP call per job to the private Cloud Run service (see blender-worker/server.mjs),
// with a Google ID token. A job's GLB comes back as the body, with its triangle counts (and, for a build, its part count and clip names)
// in headers. Everything that comes back is
// untrusted: the GLB is checked the way every other GLB in the app is, the counts must be real numbers, and nothing a failing
// response says is kept: a refusal is only ever a code, and anything else is just "not available" (plus the HTTP status).
import {
  BlenderRefusedError,
  BlenderUnavailableError,
  type BlenderWorker,
  type BuiltGlb,
  type MadeModel,
} from "@/lib/blender/types";
import { CLIP_NAMES, type ClipName } from "@/lib/builder/kinds";
import { checkBuildBody } from "@/lib/builder/recipes";
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
const REFUSALS = { "too-big": 413, "bad-format": 415, empty: 422, "bad-recipe": 422, timeout: 504, failed: 500 } as const;
type Code = keyof typeof REFUSALS;
const isCode = (value: unknown): value is Code => typeof value === "string" && Object.hasOwn(REFUSALS, value);

const WHOLE_NUMBER = /^\d+$/;
const KNOWN_CLIPS = new Set<string>(Object.values(CLIP_NAMES));

/** A header that is a whole number of 1 or more, or null. */
function count(value: string | null): number | null {
  return value !== null && WHOLE_NUMBER.test(value) && Number(value) >= 1 ? Number(value) : null;
}

/** The clip names a build lists (comma-separated, possibly none), or null when the header is missing or lists a name twice or one we do not know. */
function clipNames(value: string | null): ClipName[] | null {
  if (value === null) return null;
  const names = value === "" ? [] : value.split(",");
  if (new Set(names).size !== names.length || !names.every((name) => KNOWN_CLIPS.has(name))) return null;
  return names as ClipName[];
}

export function makeBlenderWorker(deps: BlenderClientDeps): BlenderWorker {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const doFetch = deps.fetch ?? fetch;

  // One call: the token, the POST, the status, and a body that is a GLB a game could use. What the headers say is the caller's to check.
  async function fetchGlb(path: string, contentType: string, body: BodyInit, timeoutMs: number): Promise<{ bytes: Uint8Array; headers: Headers }> {
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

    if (bytes.length === 0 || !checkGlb("model", bytes).ok) throw new BlenderUnavailableError(200); // an answer, but not one a game could use
    return { bytes, headers: response.headers };
  }

  async function call(path: string, contentType: string, body: BodyInit, timeoutMs: number): Promise<MadeModel> {
    const { bytes, headers } = await fetchGlb(path, contentType, body, timeoutMs);
    const after = count(headers.get("x-triangles-after"));
    if (after === null) throw new BlenderUnavailableError(200);
    const before = headers.get("x-triangles-before");
    return { bytes, trianglesBefore: before !== null && WHOLE_NUMBER.test(before) ? Number(before) : null, trianglesAfter: after };
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
    build: async (input): Promise<BuiltGlb> => {
      // The worker checks the body again, but a body we know it will refuse is not worth a call (or a charge against the person's limit).
      if (checkBuildBody(input.body) !== null) throw new BlenderRefusedError("bad-recipe");
      const { bytes, headers } = await fetchGlb("/build", "application/json", JSON.stringify(input.body), input.timeoutMs);
      const triangles = count(headers.get("x-triangles"));
      const parts = count(headers.get("x-parts"));
      const clips = clipNames(headers.get("x-clips"));
      if (triangles === null || parts === null || clips === null) throw new BlenderUnavailableError(200);
      // A High build and a freeform model also say how many shared vertices the GLB holds, and an answer without it is not usable; a Standard build has none.
      const counted = input.body.recipe.kind === "model" || ("quality" in input.body.recipe && input.body.recipe.quality === "high");
      if (!counted) return { bytes, triangles, parts, clips };
      const vertices = count(headers.get("x-vertices"));
      if (vertices === null) throw new BlenderUnavailableError(200);
      return { bytes, triangles, parts, clips, vertices };
    },
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
