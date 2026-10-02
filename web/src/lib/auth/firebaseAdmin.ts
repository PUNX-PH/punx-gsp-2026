// The Firebase Admin implementation of AuthPort, and the one place the Admin app is created. Nothing runs at import
// time, so the app builds without credentials; they are read from the environment on first use.
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { AuthPort, Identity } from "@/lib/auth/ports";

let app: App | undefined;

/** The shared Admin app (also used for Firestore and Cloud Storage). Needs FIREBASE_SERVICE_ACCOUNT. */
export function adminApp(): App {
  if (app) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  app =
    getApps()[0] ??
    initializeApp({ credential: cert(JSON.parse(raw)), storageBucket: process.env.FIREBASE_STORAGE_BUCKET });
  return app;
}

function toIdentity(token: { uid: string; email?: string; email_verified?: boolean }): Identity {
  return { uid: token.uid, email: token.email, emailVerified: token.email_verified === true };
}

export function getAuthPort(): AuthPort {
  const auth = () => getAuth(adminApp());
  return {
    async verifyIdToken(idToken) {
      return toIdentity(await auth().verifyIdToken(idToken, true));
    },
    async createSessionCookie(idToken, maxAgeMs) {
      return auth().createSessionCookie(idToken, { expiresIn: maxAgeMs });
    },
    async verifySessionCookie(cookie) {
      return toIdentity(await auth().verifySessionCookie(cookie, true));
    },
    async revokeRefreshTokens(uid) {
      await auth().revokeRefreshTokens(uid);
    },
  };
}
