// Two small checks every state-changing request and every sign-in goes through.

/**
 * True only for an address of the form local@domain whose domain is exactly the allowed one (case-insensitive).
 * Lookalikes fail: x@punx.ai.evil.com, x@notpunx.ai, x@sub.punx.ai, a second @, spaces, a trailing dot.
 */
export function isAllowedEmail(email: string | null | undefined, domain: string): boolean {
  // An unset domain refuses everyone: a missing setting must lock the site, not open it.
  if (domain === "" || typeof email !== "string" || /\s/.test(email)) return false;
  const parts = email.toLowerCase().split("@");
  return parts.length === 2 && parts[0] !== "" && parts[1] === domain.toLowerCase();
}

/**
 * A second defence against cross-site requests: the Origin header must be the site's own origin. A missing
 * header counts as a failure, since browsers always send Origin on POST, PUT and DELETE.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && origin === new URL(req.url).origin;
}
