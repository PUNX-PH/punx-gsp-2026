import { describe, expect, it } from "vitest";
import { isOwner } from "./owner";

describe("isOwner", () => {
  it("is true only for an email in OWNER_EMAILS, whatever its case or spacing", () => {
    const env = { OWNER_EMAILS: " Rey@punx.ai , boss@punx.ai " };
    expect(isOwner("rey@punx.ai", env)).toBe(true);
    expect(isOwner("BOSS@PUNX.AI", env)).toBe(true);
    expect(isOwner("someone@punx.ai", env)).toBe(false);
  });

  it("is false for everyone when the setting is missing or empty", () => {
    expect(isOwner("rey@punx.ai", {})).toBe(false);
    expect(isOwner("rey@punx.ai", { OWNER_EMAILS: "" })).toBe(false);
    expect(isOwner("", { OWNER_EMAILS: "," })).toBe(false);
  });
});
