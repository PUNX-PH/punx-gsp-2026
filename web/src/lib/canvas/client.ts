// The editor's calls to the graph API, and what each answer means to the person. Only the browser's `fetch` is used, so
// these run in a test with a stand-in. Every failure becomes a plain sentence; a 401 is always "sign in again".
import type { SaveResult } from "@/lib/canvas/autosave";
import type { PlayResponse } from "@/lib/canvas/runView";
import type { NodeOutcome } from "@/lib/graph/runner";
import type { AssetInfo, Graph, Problem } from "@/lib/graph/types";

export const SESSION_EXPIRED = "Your session has expired. Sign in again.";
const SERVER_FAULT = "Something went wrong on our side";
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const graphUrl = (id: string) => `/api/graphs/${encodeURIComponent(id)}`;

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => ({}));
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

// Characters that change the direction text is drawn in. In a file name they could reorder the rest of a sentence it sits in.
const DIRECTION_MARKS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const MAX_NAME_CHARS = 60;

/** A file name as it may appear inside a sentence: no direction marks, and short enough (by characters, never half of one). */
function plainName(name: string): string {
  const chars = Array.from(name.replace(DIRECTION_MARKS, ""));
  return chars.length > MAX_NAME_CHARS ? `${chars.slice(0, MAX_NAME_CHARS - 1).join("")}…` : chars.join("");
}

const sentence = (body: Record<string, unknown>) => (typeof body.error === "string" ? body.error.replace(DIRECTION_MARKS, "") : SERVER_FAULT);

/** Saves the whole graph. A refusal (400, 413) is the server's own sentence and is not worth retrying; a fault or a network failure is. */
export async function saveGraph(id: string, graph: Graph): Promise<SaveResult> {
  try {
    const response = await fetch(graphUrl(id), { method: "PUT", body: JSON.stringify({ graph }) });
    if (response.ok) return { ok: true };
    if (response.status === 401) return { ok: false, message: SESSION_EXPIRED, retryable: false };
    return { ok: false, message: sentence(await bodyOf(response)), retryable: response.status >= 500 };
  } catch {
    return { ok: false, message: "Couldn't reach the server.", retryable: true };
  }
}

export type UploadResult =
  | { ok: true; sha256: string; info: AssetInfo }
  | { ok: false; message: string; expired: boolean };

/** Uploads a picture or a model to the graph. A file over 4 MB is refused here, before anything is sent. */
export async function uploadFile(id: string, file: File): Promise<UploadResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, message: `${plainName(file.name)}: larger than 4 MB`, expired: false };
  try {
    const response = await fetch(`${graphUrl(id)}/assets?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
    if (response.status === 401) return { ok: false, message: SESSION_EXPIRED, expired: true };
    const body = await bodyOf(response);
    if (!response.ok || typeof body.sha256 !== "string") return { ok: false, message: sentence(body), expired: false };
    return {
      ok: true,
      sha256: body.sha256,
      info: {
        name: String(body.name ?? file.name),
        size: Number(body.size ?? file.size),
        kind: body.kind === "model" ? "model" : "image",
        contentType: "", // the editor never reads it
        width: typeof body.width === "number" ? body.width : undefined,
        height: typeof body.height === "number" ? body.height : undefined,
        uploadedAt: Date.now(),
      },
    };
  } catch {
    return { ok: false, message: "The upload did not finish. Check your connection and try again.", expired: false };
  }
}

export type PlayOutcome = PlayResponse | { kind: "expired" } | { kind: "failed"; message: string };

/** Plays the saved graph. */
export async function playGraph(id: string): Promise<PlayOutcome> {
  try {
    const response = await fetch(`${graphUrl(id)}/play`, { method: "POST" });
    if (response.status === 401) return { kind: "expired" };
    const body = await bodyOf(response);
    if (response.status === 422 && Array.isArray(body.problems)) return { kind: "invalid", problems: body.problems as Problem[] };
    if (response.ok && (body.state === "done" || body.state === "failed") && Array.isArray(body.order) && typeof body.nodes === "object" && body.nodes !== null) {
      return {
        kind: "ran",
        state: body.state,
        order: body.order as string[],
        nodes: body.nodes as Record<string, NodeOutcome>,
        ...(typeof body.runId === "string" ? { runId: body.runId } : {}),
      };
    }
    return { kind: "failed", message: sentence(body) };
  } catch {
    return { kind: "failed", message: "Couldn't reach the server." };
  }
}
