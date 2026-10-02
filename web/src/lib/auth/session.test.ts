import { describe, expect, it } from "vitest";
import { MemoryAuth } from "@/lib/auth/memory";
import {
  clearedSessionCookieHeader,
  endSession,
  readSessionCookie,
  requireUser,
  SESSION_MAX_AGE_MS,
  sessionCookieHeader,
  startSession,
} from "@/lib/auth/session";

const DOMAIN = "punx.ai";
const punx = { uid: "u1", email: "a@punx.ai", emailVerified: true };

describe("startSession", () => {
  it("opens a 5 day session for a verified punx.ai address", async () => {
    const auth = new MemoryAuth();
    auth.addIdToken("good", punx);
    const result = await startSession(auth, "good", DOMAIN);
    expect(result).toEqual({ ok: true, cookie: "session-cookie-1", maxAgeMs: 432_000_000 });
    expect(auth.lastMaxAgeMs).toBe(432_000_000);
    expect(SESSION_MAX_AGE_MS).toBe(432_000_000);
  });

  it.each([
    ["an unverified email", { uid: "u2", email: "a@punx.ai", emailVerified: false }],
    ["a lookalike domain that starts the same", { uid: "u3", email: "x@punx.ai.evil.com", emailVerified: true }],
    ["a lookalike domain that ends the same", { uid: "u4", email: "x@notpunx.ai", emailVerified: true }],
    ["no email at all", { uid: "u5", emailVerified: true }],
  ])("refuses %s and sets no cookie", async (_label, identity) => {
    const auth = new MemoryAuth();
    auth.addIdToken("t", identity);
    const result = await startSession(auth, "t", DOMAIN);
    expect(result).toEqual({ ok: false, status: 403, error: "Only punx.ai email addresses can sign in" });
    expect(auth.lastMaxAgeMs).toBeUndefined();
  });

  it("refuses everyone when no domain is configured", async () => {
    const auth = new MemoryAuth();
    auth.addIdToken("good", punx);
    expect(await startSession(auth, "good", "")).toMatchObject({ ok: false, status: 403 });
  });

  it("answers 401 for a token that does not verify", async () => {
    expect(await startSession(new MemoryAuth(), "nope", DOMAIN)).toEqual({ ok: false, status: 401, error: "Sign in again." });
  });

  it("answers 401 when the sign-in is too old to start a session", async () => {
    const auth = new MemoryAuth();
    auth.addIdToken("good", punx);
    auth.failCreateSessionCookie = true;
    expect(await startSession(auth, "good", DOMAIN)).toEqual({ ok: false, status: 401, error: "Sign in again." });
  });
});

describe("requireUser", () => {
  it("returns the person for a valid session of an allowed address", async () => {
    const auth = new MemoryAuth();
    const cookie = auth.addSessionCookie("c1", punx);
    expect(await requireUser(auth, cookie, DOMAIN)).toEqual({ uid: "u1", email: "a@punx.ai" });
  });

  it("returns null with no cookie, an unknown cookie, or a revoked one", async () => {
    const auth = new MemoryAuth();
    const cookie = auth.addSessionCookie("c1", punx);
    expect(await requireUser(auth, undefined, DOMAIN)).toBeNull();
    expect(await requireUser(auth, "", DOMAIN)).toBeNull();
    expect(await requireUser(auth, "unknown", DOMAIN)).toBeNull();
    await auth.revokeRefreshTokens("u1");
    expect(await requireUser(auth, cookie, DOMAIN)).toBeNull();
  });

  it("returns null when the address no longer passes the domain test", async () => {
    const auth = new MemoryAuth();
    const cookie = auth.addSessionCookie("c1", punx);
    expect(await requireUser(auth, cookie, "other.example")).toBeNull();
    expect(await requireUser(auth, auth.addSessionCookie("c2", { ...punx, emailVerified: false }), DOMAIN)).toBeNull();
  });
});

describe("endSession", () => {
  it("revokes the person's tokens", async () => {
    const auth = new MemoryAuth();
    const cookie = auth.addSessionCookie("c1", punx);
    await endSession(auth, cookie);
    expect(auth.revokedUids.has("u1")).toBe(true);
    expect(await requireUser(auth, cookie, DOMAIN)).toBeNull();
  });

  it("is quiet about a missing or invalid cookie", async () => {
    const auth = new MemoryAuth();
    await expect(endSession(auth, undefined)).resolves.toBeUndefined();
    await expect(endSession(auth, "garbage")).resolves.toBeUndefined();
    expect(auth.revokedUids.size).toBe(0);
  });
});

describe("the session cookie", () => {
  it("is HttpOnly, Secure, SameSite=Lax, for the whole site, for 5 days", () => {
    const header = sessionCookieHeader("abc.def", SESSION_MAX_AGE_MS);
    expect(header).toContain("session=abc.def");
    for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=432000"]) expect(header).toContain(part);
  });

  it("is cleared with Max-Age=0", () => {
    const header = clearedSessionCookieHeader();
    expect(header).toContain("session=;");
    expect(header).toContain("Max-Age=0");
    for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(header).toContain(part);
  });

  it("is read back from a Cookie header among other cookies", () => {
    const read = (cookie?: string) => readSessionCookie(new Request("https://x.example/", cookie ? { headers: { cookie } } : {}));
    expect(read("a=1; session=abc.def; b=2")).toBe("abc.def");
    expect(read("session=abc.def")).toBe("abc.def");
    expect(read("othersession=zzz")).toBeUndefined();
    expect(read("a=1")).toBeUndefined();
    expect(read(undefined)).toBeUndefined();
  });

  it("survives a value that needs encoding", () => {
    const header = sessionCookieHeader("a b;c", 1000);
    const value = header.split(";")[0].slice("session=".length);
    expect(readSessionCookie(new Request("https://x.example/", { headers: { cookie: `session=${value}` } }))).toBe("a b;c");
  });
});
