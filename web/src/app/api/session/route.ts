import { getSessionApi } from "@/lib/api/server";

/** Turns a Firebase ID token from the sign-in page into a session cookie, for allowed addresses only. */
export const POST = (req: Request) => getSessionApi().start(req);

/** Signs out: revokes the person's sessions and clears the cookie. */
export const DELETE = (req: Request) => getSessionApi().end(req);
