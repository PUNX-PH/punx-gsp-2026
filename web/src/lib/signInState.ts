// Completing an email-link sign-in needs the address the link was sent to. It is remembered in the browser that
// asked for the link; a link opened on another device or browser has no remembered address, so the person is asked.

/** The address to complete sign-in with, or null if there is none (the person cancelled or left it blank). */
export function resolveLinkEmail(stored: string | null, ask: () => string | null): string | null {
  if (stored) return stored;
  const answer = ask()?.trim();
  return answer ? answer : null;
}

// Signing in with Google opens a window. What went wrong with it is told in one plain sentence; the Firebase code is never shown.
const GOOGLE_MESSAGES: Record<string, string | null> = {
  // Closing the window, or opening a second one over the first, is the person's own doing, not a failure.
  "auth/popup-closed-by-user": null,
  "auth/cancelled-popup-request": null,
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/unauthorized-domain": "Google sign-in is not set up for this address yet.",
  "auth/account-exists-with-different-credential": "That address already signs in another way. Use the email link instead.",
  "auth/network-request-failed": "Could not reach Google. Check your connection and try again.",
};
const GOOGLE_GENERIC = "Google sign-in did not work. Try again, or use the email link.";

/** The sentence for a failed Google sign-in, or null when nothing should be said (the person closed the window). */
export function googleSignInMessage(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(GOOGLE_MESSAGES, code) ? GOOGLE_MESSAGES[code] : GOOGLE_GENERIC;
}
