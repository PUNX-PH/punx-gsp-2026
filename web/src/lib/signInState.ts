// Completing an email-link sign-in needs the address the link was sent to. It is remembered in the browser that
// asked for the link; a link opened on another device or browser has no remembered address, so the person is asked.

/** The address to complete sign-in with, or null if there is none (the person cancelled or left it blank). */
export function resolveLinkEmail(stored: string | null, ask: () => string | null): string | null {
  if (stored) return stored;
  const answer = ask()?.trim();
  return answer ? answer : null;
}
