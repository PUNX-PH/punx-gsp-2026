// An in-memory AuthPort for tests, behaving like Firebase where it matters: an unknown token is refused
// (AuthRejectedError), a session cookie stops working once its user's tokens are revoked, creating a cookie can be
// made to fail (a sign-in that is not recent, or an outage), and the whole service can be made to fail.
import { AuthRejectedError } from "@/lib/auth/errors";
import type { AuthPort, Identity } from "@/lib/auth/ports";

export class MemoryAuth implements AuthPort {
  readonly revokedUids = new Set<string>();
  /** When set, every call throws this (an outage, a bad key): a failure, not a refusal. */
  failure: Error | null = null;
  /** When set, createSessionCookie throws this (AuthRejectedError for a sign-in that is not recent). */
  createSessionCookieError: Error | null = null;
  lastMaxAgeMs: number | undefined;

  private readonly idTokens = new Map<string, Identity>();
  private readonly cookies = new Map<string, Identity>();
  private counter = 0;

  /** Registers an ID token the fake will accept, and returns it. */
  addIdToken(token: string, identity: Identity): string {
    this.idTokens.set(token, identity);
    return token;
  }

  async verifyIdToken(idToken: string): Promise<Identity> {
    if (this.failure) throw this.failure;
    const identity = this.idTokens.get(idToken);
    if (!identity) throw new AuthRejectedError();
    return identity;
  }

  async createSessionCookie(idToken: string, maxAgeMs: number): Promise<string> {
    if (this.failure) throw this.failure;
    if (this.createSessionCookieError) throw this.createSessionCookieError;
    const identity = await this.verifyIdToken(idToken);
    this.lastMaxAgeMs = maxAgeMs;
    const cookie = `session-cookie-${++this.counter}`;
    this.cookies.set(cookie, identity);
    return cookie;
  }

  async verifySessionCookie(cookie: string): Promise<Identity> {
    if (this.failure) throw this.failure;
    const identity = this.cookies.get(cookie);
    if (!identity || this.revokedUids.has(identity.uid)) throw new AuthRejectedError();
    return identity;
  }

  async revokeRefreshTokens(uid: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.revokedUids.add(uid);
  }

  /** Test shortcut: a session cookie for an identity, without going through an ID token. */
  addSessionCookie(cookie: string, identity: Identity): string {
    this.cookies.set(cookie, identity);
    return cookie;
  }
}
