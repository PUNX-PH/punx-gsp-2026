// The session endpoints (sign in, sign out) as plain functions over a Request, so they are tested without a server.
// Signing in turns a Firebase ID token into a session cookie, for allowed addresses only; signing out revokes the
// person's sessions and clears the cookie.
import { sameOrigin } from "@/lib/access";
import { describeFailure } from "@/lib/auth/errors";
import type { AuthPort } from "@/lib/auth/ports";
import { clearedSessionCookieHeader, endSession, readSessionCookie, sessionCookieHeader, startSession } from "@/lib/auth/session";

const json = (status: number, body: unknown) => Response.json(body, { status });

export function makeSessionApi({ auth, domain }: { auth: AuthPort; domain: string }) {
  return {
    async start(req: Request): Promise<Response> {
      if (!sameOrigin(req)) return json(403, { error: "Request not allowed" });

      let idToken: unknown;
      try {
        idToken = ((await req.json()) as { idToken?: unknown }).idToken;
      } catch {
        return json(400, { error: "Send the sign-in token as JSON." });
      }
      if (typeof idToken !== "string" || idToken === "") return json(400, { error: "Send the sign-in token as JSON." });

      try {
        const result = await startSession(auth, idToken, domain);
        if (!result.ok) return json(result.status, { error: result.error });
        return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookieHeader(result.cookie, result.maxAgeMs) } });
      } catch (error) {
        // Firebase failed, or our setup for it is wrong. Say so, and log the kind of failure, not its message.
        console.error("sign-in failed", { failure: describeFailure(error) });
        return json(500, { error: "Something went wrong on our side" });
      }
    },

    async end(req: Request): Promise<Response> {
      if (!sameOrigin(req)) return json(403, { error: "Request not allowed" });

      try {
        await endSession(auth, readSessionCookie(req));
      } catch (error) {
        // The cookie is cleared anyway, so this browser is signed out; only the revocation did not happen.
        console.error("sign-out could not revoke the session", { failure: describeFailure(error) });
      }
      return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookieHeader() } });
    },
  };
}
