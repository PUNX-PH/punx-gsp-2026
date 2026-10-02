"use client";

import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink, signOut } from "firebase/auth";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { isAllowedEmail } from "@/lib/access";
import { clientAuth } from "@/lib/firebaseClient";
import { resolveLinkEmail } from "@/lib/signInState";

const DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "";
const REMEMBERED_EMAIL = "signInEmail";

type Status = "idle" | "sending" | "sent" | "finishing";

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
        const idToken = await credential.user.getIdToken();
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        await signOut(auth); // the server session is what counts; keep nothing signed in on the client
        if (response.ok) {
          window.localStorage.removeItem(REMEMBERED_EMAIL);
          window.location.replace("/");
          return;
        }
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Sign-in failed. Ask for a new link.");
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

  return (
    <main className="page">
      <h1>Sign in</h1>
      {status === "finishing" && <p>Signing you in…</p>}
      {status === "sent" && <p>Check your inbox: we sent a sign-in link to {email.trim()}. Open it on this device.</p>}
      {(status === "idle" || status === "sending") && (
        <form onSubmit={sendLink} className="page">
          <label htmlFor="email">Your {DOMAIN} email address</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
