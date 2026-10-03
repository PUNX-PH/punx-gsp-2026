// The one guard every API handler goes through: a change must come from the site's own origin, the caller must have a
// valid session, and any failure becomes a short message in plain words. Shared by the run API and the graph API;
// each says which of its own errors are safe to show.
import { sameOrigin } from "@/lib/access";
import { describeFailure } from "@/lib/auth/errors";
import type { AuthPort, User } from "@/lib/auth/ports";
import { readSessionCookie, requireUser } from "@/lib/auth/session";

export const json = (status: number, body: unknown) => Response.json(body, { status });

export interface GuardDeps {
  auth: AuthPort;
  domain: string;
  /** Names the API in the log, e.g. "run API". */
  label: string;
  /** What the id in a log line is called, e.g. "runId". */
  idName: string;
  /** A failure that is safe to show the person, as its status and message; null for anything else. */
  publicError(error: unknown): { status: number; message: string } | null;
}

export function makeGuard({ auth, domain, label, idName, publicError }: GuardDeps) {
  return async function guarded(
    req: Request,
    handler: string,
    options: { changes: boolean; id?: string },
    work: (user: User) => Promise<Response>,
  ): Promise<Response> {
    if (options.changes && !sameOrigin(req)) return json(403, { error: "Request not allowed" });

    try {
      // A refused session is null (a 401). A failure of the identity service throws, and is a logged 500 below.
      const user = await requireUser(auth, readSessionCookie(req), domain);
      if (!user) return json(401, { error: "Your session has expired. Sign in again." });
      return await work(user);
    } catch (error) {
      const shown = publicError(error);
      if (shown) return json(shown.status, { error: shown.message });
      // The id and the kind of failure, never the request body or the error's message: an upload's bytes and a key
      // quoted in a message must not reach the logs.
      console.error(`${label} failed`, { handler, [idName]: options.id, failure: describeFailure(error) });
      return json(500, { error: "Something went wrong on our side" });
    }
  };
}
