import { describe, expect, it } from "vitest";
import { AuthRejectedError, describeFailure, isRejection } from "@/lib/auth/errors";

describe("isRejection (a credential Firebase refused, as opposed to Firebase or our setup failing)", () => {
  it.each([
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/invalid-id-token",
    "auth/session-cookie-expired",
    "auth/session-cookie-revoked",
    "auth/user-disabled",
    "auth/user-not-found",
    "auth/argument-error",
  ])("treats %s as a rejected credential", (code) => {
    expect(isRejection({ code })).toBe(true);
  });

  it.each([
    ["a bad service-account key", "app/invalid-credential"],
    ["a credential the project refuses", "auth/invalid-credential"],
    ["a missing permission", "auth/insufficient-permission"],
    ["an outage inside Firebase", "auth/internal-error"],
    ["a timeout", "auth/network-timeout"],
    ["a project that does not exist", "auth/project-not-found"],
  ])("treats %s (%s) as a failure on our side", (_label, code) => {
    expect(isRejection({ code })).toBe(false);
  });

  it("treats anything without a string code as a failure", () => {
    expect(isRejection(new Error("boom"))).toBe(false);
    expect(isRejection({ code: 7 })).toBe(false);
    expect(isRejection(null)).toBe(false);
    expect(isRejection(undefined)).toBe(false);
  });

  it("recognises its own error class", () => {
    expect(new AuthRejectedError()).toBeInstanceOf(Error);
    expect(new AuthRejectedError().name).toBe("AuthRejectedError");
  });
});

describe("describeFailure (what may go in a log)", () => {
  it("gives the kind and the code, never the message", () => {
    const error = Object.assign(new Error('Unexpected token in {"private_key":"-----BEGIN"}'), { code: "auth/internal-error" });
    const text = describeFailure(error);
    expect(text).toBe("Error auth/internal-error");
    expect(text).not.toContain("private_key");
  });

  it("copes with an error without a code, a numeric code, and a thrown non-error", () => {
    expect(describeFailure(new TypeError("x"))).toBe("TypeError");
    expect(describeFailure(Object.assign(new Error("x"), { code: 7 }))).toBe("Error 7");
    expect(describeFailure("a string")).toBe("a thrown value that is not an Error");
  });
});
