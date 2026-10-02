// Server-side wiring of the auth logic to the real world: configuration from the environment, the real Firebase
// adapter, and the current request's cookie. Pages and routes call currentUser() / requireUser themselves; no page
// relies on anything else to keep a signed-out visitor out.
import { cookies } from "next/headers";
import { getAuthPort } from "@/lib/auth/firebaseAdmin";
import type { User } from "@/lib/auth/ports";
import { requireUser, SESSION_COOKIE } from "@/lib/auth/session";

/** The allowed email domain. Unset means nobody is allowed: a missing setting locks the site. */
export function allowedDomain(): string {
  return process.env.ALLOWED_EMAIL_DOMAIN ?? "";
}

/** The signed-in person for a server component, or null. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  return requireUser(getAuthPort(), store.get(SESSION_COOKIE)?.value, allowedDomain());
}
