"use client";

import {
  type Auth,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Mark } from "@/app/AppHeader";
import styles from "@/app/shell.module.css";
import { ThemedShell } from "@/app/graphs/ThemedShell";
import { isAllowedEmail } from "@/lib/access";
import { clientAuth } from "@/lib/firebaseClient";
import { googleSignInMessage, resolveLinkEmail } from "@/lib/signInState";

const DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "";
const REMEMBERED_EMAIL = "signInEmail";

type Status = "idle" | "sending" | "google" | "sent" | "finishing";

/**
 * Hands a Firebase ID token to the server for a session cookie, then forgets the sign-in on this side: the server session
 * is what counts, and nothing stays signed in in the browser. Returns what to tell the person, or null when it worked.
 */
async function startServerSession(auth: Auth, idToken: string, fallback: string): Promise<string | null> {
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? fallback;
  } finally {
    await signOut(auth);
  }
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const started = useRef(false); // an email link works once, and React may run an effect twice in development

  useEffect(() => {
    const auth = clientAuth();
    if (started.current || !isSignInWithEmailLink(auth, window.location.href)) return;
    started.current = true;

    void (async () => {
      const address = resolveLinkEmail(window.localStorage.getItem(REMEMBERED_EMAIL), () =>
        window.prompt("Confirm your email address to finish signing in"),
      );
      if (!address) {
        setError("Enter your email address below and ask for a new link.");
        return;
      }

      setStatus("finishing");
      try {
        const credential = await signInWithEmailLink(auth, address, window.location.href);
        const failure = await startServerSession(auth, await credential.user.getIdToken(), "Sign-in failed. Ask for a new link.");
        if (failure === null) {
          window.localStorage.removeItem(REMEMBERED_EMAIL);
          window.location.replace("/");
          return;
        }
        setError(failure);
      } catch {
        setError("This sign-in link is not valid any more. Ask for a new one.");
      }
      setStatus("idle");
    })();
  }, []);

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    setError("");
    const address = email.trim();
    if (DOMAIN === "") return setError("Sign-in is not set up yet.");
    if (!isAllowedEmail(address, DOMAIN)) return setError(`Only ${DOMAIN} email addresses can sign in`);

    setStatus("sending");
    try {
      await sendSignInLinkToEmail(clientAuth(), address, { url: `${window.location.origin}/sign-in`, handleCodeInApp: true });
      window.localStorage.setItem(REMEMBERED_EMAIL, address);
      setStatus("sent");
    } catch {
      setError("We could not send the link. Check the address and try again.");
      setStatus("idle");
    }
  }

  async function signInWithGoogle() {
    setError("");
    if (DOMAIN === "") return setError("Sign-in is not set up yet.");

    setStatus("google");
    try {
      const auth = clientAuth();
      const provider = new GoogleAuthProvider();
      // Only a hint for Google's account chooser. Who may sign in is decided by the server, from the verified address in the token.
      provider.setCustomParameters({ hd: DOMAIN, prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);
      const failure = await startServerSession(auth, await credential.user.getIdToken(), "Sign-in failed. Try again.");
      if (failure === null) {
        window.location.replace("/");
        return;
      }
      setError(failure);
    } catch (caught) {
      const message = googleSignInMessage((caught as { code?: string }).code);
      if (message) setError(message);
    }
    setStatus("idle");
  }

  return (
    <ThemedShell>
      <main className={styles.signin}>
        <section className={styles.signinCopy}>
          <span className={styles.brand}>
            <Mark />
            Game Studio
          </span>
          <h1 className={styles.heading}>Describe a game. Press Play.</h1>
          <p className={styles.lede}>Write what the game is, add a picture for its look, and Game Studio builds it as steps on a canvas you can change, then lets you play it.</p>

          {status === "finishing" && <p className={styles.notice}>Signing you in…</p>}
          {status === "sent" && <p className={styles.notice}>Check your inbox: we sent a sign-in link to {email.trim()}. Open it on this device.</p>}
          {(status === "idle" || status === "sending" || status === "google") && (
            <div className={styles.signinForm}>
              <button type="button" className={styles.google} onClick={signInWithGoogle} disabled={status !== "idle"}>
                {status === "google" ? "Opening Google…" : "Continue with Google"}
              </button>
              <p className={styles.or}>or</p>
              <form onSubmit={sendLink} className={styles.emailForm}>
                <div className={styles.field}>
                  <label htmlFor="email">Your {DOMAIN} email address</label>
                  <input id="email" className={styles.input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <button type="submit" className={styles.button} disabled={status !== "idle"}>
                  {status === "sending" ? "Sending…" : "Email me a sign-in link"}
                </button>
              </form>
            </div>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </section>
        <Diagram />
      </main>
    </ThemedShell>
  );
}

/**
 * The steps of a game as the editor draws them: a picture and the words go into Describe Game, which feeds the Game Template, which feeds the Preview.
 * The wires draw themselves once. It is decoration for a page the person has seen, so it is hidden from screen readers.
 */
function Diagram() {
  return (
    <aside className={styles.diagram} aria-hidden="true">
      <svg className={styles.wires} viewBox="0 0 100 70" preserveAspectRatio="none">
        <path className={styles.wire} data-wire="image" pathLength="100" d="M16 16 L16 26" />
        <path className={styles.wire} data-wire="palette" pathLength="100" d="M44 40 C50 40 50 13 56 13" />
        <path className={styles.wire} data-wire="settings" pathLength="100" d="M77 21 L77 44" />
      </svg>
      <div className={styles.node} style={{ left: "2%", top: "2.8%", width: "28%", height: "20%", ["--dot" as string]: "var(--wire-image)" }}>
        <span className={styles.nodeName}>Picture</span>
        <span className={styles.swatches}>
          {["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"].map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </span>
      </div>
      <div className={styles.node} style={{ left: "2%", top: "37%", width: "42%", height: "40%", ["--dot" as string]: "var(--wire-palette)" }}>
        <span className={styles.nodeName}>Describe Game</span>
        <span className={styles.typed}>A fox that jumps over logs and collects berries</span>
      </div>
      <div className={styles.node} style={{ left: "56%", top: "5.7%", width: "42%", height: "24%", ["--dot" as string]: "var(--wire-settings)" }}>
        <span className={styles.nodeName}>Game Template</span>
        <span className={styles.nodeBody}>Script game, 5 colors</span>
      </div>
      <div className={styles.node} style={{ left: "56%", top: "63%", width: "42%", height: "34%", ["--dot" as string]: "var(--accent)" }}>
        <span className={styles.nodeName}>Preview</span>
        <span className={styles.playMock}>Play</span>
      </div>
    </aside>
  );
}
