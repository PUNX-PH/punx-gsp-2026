// Server sessions: turning a Firebase ID token into a session cookie, and checking that cookie on every request.
// The domain rule (a verified address at exactly the allowed domain) is applied when the session starts and again
// on every request, so a change in who is allowed, or a revoked user, takes effect at once.
import { isAllowedEmail } from "@/lib/access";
import { AuthRejectedError } from "@/lib/auth/errors";
import type { AuthPort, User } from "@/lib/auth/ports";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export type StartResult =
  | { ok: true; cookie: string; maxAgeMs: number }
  | { ok: false; status: 401 | 403; error: string };

const SIGN_IN_AGAIN: StartResult = { ok: false, status: 401, error: "Sign in again." };

export async function startSession(auth: AuthPort, idToken: string, domain: string): Promise<StartResult> {
  let identity;
  try {
    identity = await auth.verifyIdToken(idToken);
  } catch (error) {
    if (error instanceof AuthRejectedError) return SIGN_IN_AGAIN;
    throw error; // a failure of the identity service is not the person's sign-in problem
  }

  if (!identity.emailVerified || !isAllowedEmail(identity.email, domain)) {
    return { ok: false, status: 403, error: `Only ${domain} email addresses can sign in` };
  }

  try {
    return { ok: true, cookie: await auth.createSessionCookie(idToken, SESSION_MAX_AGE_MS), maxAgeMs: SESSION_MAX_AGE_MS };
  } catch (error) {
    if (error instanceof AuthRejectedError) return SIGN_IN_AGAIN; // the sign-in was not recent enough
    throw error;
  }
}

/**
 * The signed-in person, or null when there is no valid session; callers turn null into a 401 or a redirect. A failure
 * of the identity service is not "no session": it is thrown, so it is reported instead of looking like a sign-out.
 */
export async function requireUser(auth: AuthPort, cookie: string | undefined, domain: string): Promise<User | null> {
  if (!cookie) return null;
  try {
    const identity = await auth.verifySessionCookie(cookie);
    if (!identity.emailVerified || !identity.email || !isAllowedEmail(identity.email, domain)) return null;
    return { uid: identity.uid, email: identity.email };
  } catch (error) {
    if (error instanceof AuthRejectedError) return null;
    throw error;
  }
}

/** Signs the person out everywhere. Quiet when the cookie is missing or already refused; a service failure is thrown. */
export async function endSession(auth: AuthPort, cookie: string | undefined): Promise<void> {
  if (!cookie) return;
  try {
    const identity = await auth.verifySessionCookie(cookie);
    await auth.revokeRefreshTokens(identity.uid);
  } catch (error) {
    if (error instanceof AuthRejectedError) return; // nothing to end
    throw error;
  }
}

export function sessionCookieHeader(value: string, maxAgeMs: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${Math.floor(maxAgeMs / 1000)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/** The session cookie's value from a request's Cookie header, or undefined. */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
