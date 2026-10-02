import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSessionApi } from "@/lib/api/sessionHandlers";
import { MemoryAuth } from "@/lib/auth/memory";
import { SESSION_COOKIE } from "@/lib/auth/session";

const ORIGIN = "https://studio.example";
const punx = { uid: "u1", email: "a@punx.ai", emailVerified: true };

function setup() {
  const auth = new MemoryAuth();
  auth.addIdToken("good", punx);
  return { auth, api: makeSessionApi({ auth, domain: "punx.ai" }) };
}

function post(body: unknown, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request(ORIGIN + "/api/session", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function del(origin: string | null = ORIGIN, cookie?: string) {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = `${SESSION_COOKIE}=${cookie}`;
  return new Request(ORIGIN + "/api/session", { method: "DELETE", headers });
}

describe("starting a session", () => {
  it("answers 204 and sets the session cookie for an allowed address", async () => {
    const { api } = setup();
    const response = await api.start(post({ idToken: "good" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=session-cookie-1`);
  });

  it.each([
    ["no Origin", null],
    ["another site's Origin", "https://evil.example"],
  ])("refuses %s", async (_label, origin) => {
    const { api } = setup();
    const response = await api.start(post({ idToken: "good" }, origin));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Request not allowed" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([["not JSON at all", "{nope"], ["no token", {}], ["a token that is not a string", { idToken: 5 }], ["an empty token", { idToken: "" }]])(
    "answers 400 for %s",
    async (_label, body) => {
      const { api } = setup();
      const response = await api.start(post(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Send the sign-in token as JSON." });
    },
  );

  it("answers 403 for a verified address at another domain, with no cookie", async () => {
    const { auth, api } = setup();
    auth.addIdToken("outsider", { uid: "u2", email: "x@notpunx.ai", emailVerified: true });
    const response = await api.start(post({ idToken: "outsider" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only punx.ai email addresses can sign in" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers 401 for a token Firebase refuses", async () => {
    const { api } = setup();
    const response = await api.start(post({ idToken: "forged" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in again." });
  });
});

describe("when Firebase itself fails", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers 500 in plain words and logs the kind of failure, never its message", async () => {
    const { auth, api } = setup();
    auth.failure = Object.assign(new Error("Unexpected token in the private_key value"), { code: "app/invalid-credential" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await api.start(post({ idToken: "good" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong on our side" });
    expect(response.headers.get("set-cookie")).toBeNull();

    const text = JSON.stringify(logged.mock.calls);
    expect(text).toContain("app/invalid-credential");
    expect(text).not.toContain("private_key");
  });
});

describe("signing out", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses a sign-out that does not come from this site", async () => {
    const { api } = setup();
    expect((await api.end(del(null))).status).toBe(403);
    expect((await api.end(del("https://evil.example"))).status).toBe(403);
  });

  it("revokes the person's sessions and clears the cookie", async () => {
    const { auth, api } = setup();
    const started = await api.start(post({ idToken: "good" }));
    const cookie = started.headers.get("set-cookie")!.split(";")[0].slice(`${SESSION_COOKIE}=`.length);

    const response = await api.end(del(ORIGIN, cookie));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
    expect(auth.revokedUids.has("u1")).toBe(true);
  });

  it("clears the cookie even when Firebase fails, and logs it", async () => {
    const { auth, api } = setup();
    const cookie = auth.addSessionCookie("c1", punx);
    auth.failure = new Error("Firebase is down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await api.end(del(ORIGIN, cookie));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
    expect(logged).toHaveBeenCalled();
  });

  it("is quiet when there is no cookie at all", async () => {
    const { api } = setup();
    expect((await api.end(del())).status).toBe(204);
  });
});
