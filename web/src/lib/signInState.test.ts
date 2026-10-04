import { describe, expect, it } from "vitest";
import { googleSignInMessage, resolveLinkEmail } from "@/lib/signInState";

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

describe("googleSignInMessage (what to tell the person when the Google window does not finish)", () => {
  it("says nothing when the person closed the window or opened a second one: that is not a failure", () => {
    expect(googleSignInMessage("auth/popup-closed-by-user")).toBeNull();
    expect(googleSignInMessage("auth/cancelled-popup-request")).toBeNull();
  });

  it("tells the person what to do when the browser blocked the window", () => {
    expect(googleSignInMessage("auth/popup-blocked")).toBe("Your browser blocked the Google window. Allow pop-ups for this site and try again.");
  });

  it("says the site is not set up when Firebase does not know this address, without naming settings", () => {
    expect(googleSignInMessage("auth/unauthorized-domain")).toBe("Google sign-in is not set up for this address yet.");
  });

  it("points to the email link when the address already signs in another way", () => {
    expect(googleSignInMessage("auth/account-exists-with-different-credential")).toBe("That address already signs in another way. Use the email link instead.");
  });

  it("says the connection failed", () => {
    expect(googleSignInMessage("auth/network-request-failed")).toBe("Could not reach Google. Check your connection and try again.");
  });

  it("gives one plain sentence for any other code, or none, and never shows the code itself", () => {
    const generic = "Google sign-in did not work. Try again, or use the email link.";
    expect(googleSignInMessage("auth/internal-error")).toBe(generic);
    expect(googleSignInMessage(undefined)).toBe(generic);
    expect(googleSignInMessage("anything else")).toBe(generic);
  });
});
