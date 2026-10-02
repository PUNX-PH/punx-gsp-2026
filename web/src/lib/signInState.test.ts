import { describe, expect, it } from "vitest";
import { resolveLinkEmail } from "@/lib/signInState";

describe("resolveLinkEmail (the email link opened on a device that did not ask for it)", () => {
  it("uses the remembered address without asking", () => {
    const ask = () => {
      throw new Error("should not ask");
    };
    expect(resolveLinkEmail("a@punx.ai", ask)).toBe("a@punx.ai");
  });

  it("asks when no address was remembered, and uses the answer, trimmed", () => {
    expect(resolveLinkEmail(null, () => "  a@punx.ai ")).toBe("a@punx.ai");
    expect(resolveLinkEmail("", () => "a@punx.ai")).toBe("a@punx.ai");
  });

  it("returns null when the person cancels or leaves the answer blank", () => {
    expect(resolveLinkEmail(null, () => null)).toBeNull();
    expect(resolveLinkEmail(null, () => "   ")).toBeNull();
  });
});
