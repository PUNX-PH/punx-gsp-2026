import { describe, expect, it } from "vitest";
import { two } from "@/lib/smoke";

describe("test runner", () => {
  it("resolves the @ alias and runs a test", () => {
    expect(1 + 1).toBe(two);
  });
});
