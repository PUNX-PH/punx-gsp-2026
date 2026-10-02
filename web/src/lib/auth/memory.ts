// An in-memory AuthPort for tests, behaving like Firebase where it matters: unknown tokens throw, a session cookie
// stops working once its user's tokens are revoked, and creating a cookie can be made to fail (a sign-in that is
// not recent).
import type { AuthPort, Identity } from "@/lib/auth/ports";

export class MemoryAuth implements AuthPort {
  readonly revokedUids = new Set<string>();
  failCreateSessionCookie = false;
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
    const identity = this.idTokens.get(idToken);
    if (!identity) throw new Error("invalid ID token");
    return identity;
  }

  async createSessionCookie(idToken: string, maxAgeMs: number): Promise<string> {
    if (this.failCreateSessionCookie) throw new Error("sign-in is not recent");
    const identity = await this.verifyIdToken(idToken);
    this.lastMaxAgeMs = maxAgeMs;
    const cookie = `session-cookie-${++this.counter}`;
    this.cookies.set(cookie, identity);
    return cookie;
  }

  async verifySessionCookie(cookie: string): Promise<Identity> {
    const identity = this.cookies.get(cookie);
    if (!identity || this.revokedUids.has(identity.uid)) throw new Error("invalid session cookie");
    return identity;
  }

  async revokeRefreshTokens(uid: string): Promise<void> {
    this.revokedUids.add(uid);
  }

  /** Test shortcut: a session cookie for an identity, without going through an ID token. */
  addSessionCookie(cookie: string, identity: Identity): string {
    this.cookies.set(cookie, identity);
    return cookie;
  }
}
