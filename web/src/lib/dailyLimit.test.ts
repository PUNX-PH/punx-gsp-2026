import { describe, expect, it } from "vitest";
import { dailyLimit } from "@/lib/dailyLimit";

describe("dailyLimit", () => {
  it("takes a whole number of 0 or more", () => {
    expect(dailyLimit("5", 30)).toBe(5);
    expect(dailyLimit("0", 30)).toBe(0);
    expect(dailyLimit("600", 30)).toBe(600);
  });

  it.each([["empty", ""], ["text", "abc"], ["negative", "-5"], ["fractional", "1.5"], ["with spaces", " 7 "], ["scientific", "1e3"], ["unset", undefined]])(
    "falls back for a value that is %s",
    (_label, value) => {
      expect(dailyLimit(value, 30)).toBe(30);
    },
  );
});
