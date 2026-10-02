import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<Rule[]> {
  return (await nextConfig.headers!()) as Rule[];
}

const valueOf = (rule: Rule, key: string) => rule.headers.find((h) => h.key === key)?.value;

describe("next.config headers", () => {
  it("still sends the Brotli headers for the three kinds of Unity file", async () => {
    const unity = (await rules()).filter((r) => r.source.includes("unityweb"));
    expect(unity).toHaveLength(3);
    expect(unity.map((r) => valueOf(r, "Content-Type")).sort()).toEqual(["application/javascript", "application/octet-stream", "application/wasm"]);
    for (const rule of unity) expect(valueOf(rule, "Content-Encoding")).toBe("br");
  });

  it("sends the security headers on every route", async () => {
    const all = (await rules()).find((r) => r.source === "/:path*");
    expect(all, "a catch-all rule for /:path*").toBeDefined();
    expect(valueOf(all!, "X-Frame-Options")).toBe("SAMEORIGIN");
    expect(valueOf(all!, "Content-Security-Policy")).toBe("frame-ancestors 'self'");
    expect(valueOf(all!, "X-Content-Type-Options")).toBe("nosniff");
    expect(valueOf(all!, "Referrer-Policy")).toBe("same-origin");
  });
});
