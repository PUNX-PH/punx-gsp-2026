import { sameOrigin } from "@/lib/access";
import { getAuthPort } from "@/lib/auth/firebaseAdmin";
import { allowedDomain } from "@/lib/auth/server";
import { clearedSessionCookieHeader, endSession, readSessionCookie, sessionCookieHeader, startSession } from "@/lib/auth/session";

const json = (status: number, body: unknown) => Response.json(body, { status });

/** Turns a Firebase ID token from the sign-in page into a session cookie, for allowed addresses only. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Request not allowed" });

  let idToken: unknown;
  try {
    idToken = ((await req.json()) as { idToken?: unknown }).idToken;
  } catch {
    return json(400, { error: "Send the sign-in token as JSON." });
  }
  if (typeof idToken !== "string" || idToken === "") return json(400, { error: "Send the sign-in token as JSON." });

  const result = await startSession(getAuthPort(), idToken, allowedDomain());
  if (!result.ok) return json(result.status, { error: result.error });
  return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookieHeader(result.cookie, result.maxAgeMs) } });
}

/** Signs out: revokes the person's sessions and clears the cookie. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "Request not allowed" });
  await endSession(getAuthPort(), readSessionCookie(req));
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookieHeader() } });
}
