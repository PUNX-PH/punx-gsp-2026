// Two very different things can go wrong when asking Firebase about a credential, and they must not be confused:
// Firebase can REFUSE it (expired, revoked, forged, user disabled), which means "sign in again"; or the call can
// FAIL (a bad service-account key, a missing permission, an outage), which is our problem and has to be loud and
// logged. Treating every failure as a refusal would show a broken deployment as an endless sign-in loop.

/** Thrown by an AuthPort when the identity service refused a credential. Any other error is a failure. */
export class AuthRejectedError extends Error {
  constructor() {
    super("credential refused");
    this.name = "AuthRejectedError";
  }
}

// The codes firebase-admin uses when it refuses a token or cookie (see firebase-admin/lib/auth/error.js).
const REJECTION_CODES = new Set([
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
  "auth/session-cookie-expired",
  "auth/session-cookie-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
  "auth/argument-error",
]);

/** True when an error from firebase-admin means the credential was refused, not that the call failed. */
export function isRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && REJECTION_CODES.has(code);
}

/**
 * What may be written to a log about a failure: its kind and code, never its message. Messages can quote the input,
 * and for a bad service-account key the input is the key.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return "a thrown value that is not an Error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? `${error.name} ${code}` : error.name;
}
