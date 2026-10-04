// The browser side of Firebase: only sign-in uses it (the email link and Google). The web config is public by design (it names the
// project; it grants nothing), and is inlined at build time from NEXT_PUBLIC_FIREBASE_* variables.
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

export function clientAuth() {
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      });
  return getAuth(app);
}
