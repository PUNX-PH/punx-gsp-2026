// What the app needs from an identity service. The Firebase Admin adapter implements it for real
// (firebaseAdmin.ts); tests use the in-memory MemoryAuth.
//
// Every method throws AuthRejectedError (auth/errors.ts) when the service REFUSES a credential, and lets any other
// error through when the call FAILS: callers treat the first as "signed out" and the second as a fault to report.

export interface Identity {
  uid: string;
  email?: string;
  emailVerified: boolean;
}

export interface AuthPort {
  /** Verifies a Firebase ID token from the sign-in page. Throws if it is invalid, expired or revoked. */
  verifyIdToken(idToken: string): Promise<Identity>;
  /** Exchanges a recent ID token for a server session cookie valid for maxAgeMs. Throws if the sign-in is not recent. */
  createSessionCookie(idToken: string, maxAgeMs: number): Promise<string>;
  /** Verifies a session cookie, including whether it was revoked. Throws if it is invalid, expired or revoked. */
  verifySessionCookie(cookie: string): Promise<Identity>;
  /** Ends every session of a user. */
  revokeRefreshTokens(uid: string): Promise<void>;
}

/** A signed-in person who passed the domain check. */
export interface User {
  uid: string;
  email: string;
}
