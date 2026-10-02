// The HTTP side of runs: five handlers over the run service, each taking a Request and returning a Response, so they
// are tested without a server. Every handler goes through one guard: a change must come from the site's own origin,
// the caller must have a valid session, and any failure becomes a short message in plain words.
import { sameOrigin } from "@/lib/access";
import { describeFailure } from "@/lib/auth/errors";
import type { AuthPort, User } from "@/lib/auth/ports";
import { readSessionCookie, requireUser } from "@/lib/auth/session";
import { readBodyCapped, TooLargeError } from "@/lib/body";
import { type Run, RunError, type RunService } from "@/lib/runs/types";

const MAX_SETTINGS_BYTES = 16 * 1024;
const MAX_GLB_BYTES = 4 * 1024 * 1024;

export interface ApiDeps {
  auth: AuthPort;
  runs: RunService;
  domain: string;
}

const json = (status: number, body: unknown) => Response.json(body, { status });

// What the pages need to know about a run: never the owner's id.
function publicRun(run: Run) {
  return { id: run.id, status: run.status, createdAt: run.createdAt, needed: run.needed, files: Object.keys(run.files) };
}

export function makeApi({ auth, runs, domain }: ApiDeps) {
  async function guarded(
    req: Request,
    handler: string,
    options: { changes: boolean; runId?: string },
    work: (user: User) => Promise<Response>,
  ): Promise<Response> {
    if (options.changes && !sameOrigin(req)) return json(403, { error: "Request not allowed" });

    try {
      // A refused session is null (a 401). A failure of the identity service throws, and is a logged 500 below.
      const user = await requireUser(auth, readSessionCookie(req), domain);
      if (!user) return json(401, { error: "Your session has expired. Sign in again." });
      return await work(user);
    } catch (error) {
      if (error instanceof RunError) return json(error.status, { error: error.message });
      // The run id and the kind of failure, never the request body or the error's message: an upload's bytes and a
      // key quoted in a message must not reach the logs.
      console.error("run API failed", { handler, runId: options.runId, failure: describeFailure(error) });
      return json(500, { error: "Something went wrong on our side" });
    }
  }

  return {
    listRuns: (req: Request) =>
      guarded(req, "listRuns", { changes: false }, async (user) => {
        const found = await runs.listRuns(user);
        return json(200, { runs: found.map(publicRun) });
      }),

    createRun: (req: Request) =>
      guarded(req, "createRun", { changes: true }, async (user) => {
        let bytes: Uint8Array;
        try {
          bytes = await readBodyCapped(req, MAX_SETTINGS_BYTES);
        } catch (error) {
          if (error instanceof TooLargeError) return json(413, { error: "settings.json: larger than 16 KB" });
          throw error;
        }
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return json(400, { error: "settings: not valid JSON (the file is not UTF-8 text)" });
        }
        const { id, needed } = await runs.createRun(user, text);
        return json(201, { id, needed });
      }),

    deleteRun: (req: Request, id: string) =>
      guarded(req, "deleteRun", { changes: true, runId: id }, async (user) => {
        await runs.deleteRun(user, id);
        return new Response(null, { status: 204 });
      }),

    putFile: (req: Request, id: string, name: string) =>
      guarded(req, "putFile", { changes: true, runId: id }, async (user) => {
        let bytes: Uint8Array;
        try {
          bytes = await readBodyCapped(req, MAX_GLB_BYTES);
        } catch (error) {
          if (error instanceof TooLargeError) return json(413, { error: `${name}: larger than 4 MB` });
          throw error;
        }
        return json(200, publicRun(await runs.putFile(user, id, name, bytes)));
      }),

    getFile: (req: Request, id: string, file: string) =>
      guarded(req, "getFile", { changes: false, runId: id }, async (user) => {
        const { bytes, contentType } = await runs.readFile(user, id, file);
        return new Response(bytes as BodyInit, {
          status: 200,
          headers: { "Content-Type": contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private" },
        });
      }),
  };
}
