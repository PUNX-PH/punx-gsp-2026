// The Firebase Admin implementation of AuthPort, and the one place the Admin app is created. Nothing runs at import
// time, so the app builds without credentials; they are read from the environment on first use.
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { AuthRejectedError, isRejection } from "@/lib/auth/errors";
import type { AuthPort, Identity } from "@/lib/auth/ports";

let app: App | undefined;

/** The shared Admin app (also used for Firestore and Cloud Storage). Needs FIREBASE_SERVICE_ACCOUNT. */
export function adminApp(): App {
  if (app) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");

  let credentials: unknown;
  try {
    credentials = JSON.parse(raw);
  } catch {
    // Not the parser's own message: it can quote the start of the key.
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
  }
  app = getApps()[0] ?? initializeApp({ credential: cert(credentials as Parameters<typeof cert>[0]), storageBucket: process.env.FIREBASE_STORAGE_BUCKET });
  return app;
}

function toIdentity(token: { uid: string; email?: string; email_verified?: boolean }): Identity {
  return { uid: token.uid, email: token.email, emailVerified: token.email_verified === true };
}

// A refused credential becomes AuthRejectedError; any other failure (a bad key, a missing permission, an outage) is
// let through so it is reported as a fault, not mistaken for a signed-out visitor.
async function refusing<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw isRejection(error) ? new AuthRejectedError() : error;
  }
}

export function getAuthPort(): AuthPort {
  const auth = () => getAuth(adminApp());
  return {
    verifyIdToken: (idToken) => refusing(async () => toIdentity(await auth().verifyIdToken(idToken, true))),
    createSessionCookie: (idToken, maxAgeMs) => refusing(() => auth().createSessionCookie(idToken, { expiresIn: maxAgeMs })),
    verifySessionCookie: (cookie) => refusing(async () => toIdentity(await auth().verifySessionCookie(cookie, true))),
    revokeRefreshTokens: (uid) => refusing(() => auth().revokeRefreshTokens(uid)),
  };
}
