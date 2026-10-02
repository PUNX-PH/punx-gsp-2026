import { describe, expect, it } from "vitest";
import { isAllowedEmail, sameOrigin } from "@/lib/access";

describe("isAllowedEmail", () => {
  it.each([["a@punx.ai"], ["A@PUNX.AI"], ["first.last+tag@punx.ai"]])("accepts %s", (email) => {
    expect(isAllowedEmail(email, "punx.ai")).toBe(true);
  });

  it.each([
    ["a lookalike with the domain as a prefix", "x@punx.ai.evil.com"],
    ["a different domain that ends the same way", "x@notpunx.ai"],
    ["a subdomain", "x@sub.punx.ai"],
    ["a trailing space", "x@punx.ai "],
    ["a leading space", " x@punx.ai"],
    ["two at signs", "a@b@punx.ai"],
    ["no local part", "@punx.ai"],
    ["no at sign", "punx.ai"],
    ["the domain with a trailing dot", "x@punx.ai."],
    ["an empty string", ""],
  ])("refuses %s", (_label, email) => {
    expect(isAllowedEmail(email, "punx.ai")).toBe(false);
  });

  it("refuses null and undefined", () => {
    expect(isAllowedEmail(null, "punx.ai")).toBe(false);
    expect(isAllowedEmail(undefined, "punx.ai")).toBe(false);
  });

  it("compares against the configured domain, whatever its case", () => {
    expect(isAllowedEmail("a@punx.ai", "PUNX.AI")).toBe(true);
    expect(isAllowedEmail("a@other.org", "punx.ai")).toBe(false);
  });
});

describe("sameOrigin", () => {
  const post = (url: string, origin?: string) =>
    new Request(url, { method: "POST", headers: origin === undefined ? {} : { origin } });

  it("accepts a request whose Origin is the site's own", () => {
    expect(sameOrigin(post("https://studio.punx.ai/api/runs", "https://studio.punx.ai"))).toBe(true);
    expect(sameOrigin(post("http://localhost:3000/api/runs", "http://localhost:3000"))).toBe(true);
  });

  it.each([
    ["a missing Origin header", undefined],
    ["the string null", "null"],
    ["another host", "https://evil.example"],
    ["another scheme", "http://studio.punx.ai"],
    ["another port", "https://studio.punx.ai:8443"],
    ["a lookalike host", "https://studio.punx.ai.evil.example"],
  ])("refuses %s", (_label, origin) => {
    expect(sameOrigin(post("https://studio.punx.ai/api/runs", origin))).toBe(false);
  });
});
