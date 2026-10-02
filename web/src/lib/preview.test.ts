import { describe, expect, it } from "vitest";
import { pickTemplate, previewUrl } from "@/lib/preview";

describe("pickTemplate", () => {
  it("uses the mobile build on a touch screen and the desktop build otherwise", () => {
    expect(pickTemplate(true)).toBe("runner-mobile");
    expect(pickTemplate(false)).toBe("runner-desktop");
  });
});

describe("previewUrl", () => {
  it("points the template at the run's settings file on the same site", () => {
    expect(previewUrl("abc", "runner-desktop")).toBe("/templates/runner-desktop/index.html?settings=/api/runs/abc/settings.json");
    expect(previewUrl("abc", "runner-mobile")).toBe("/templates/runner-mobile/index.html?settings=/api/runs/abc/settings.json");
  });

  it("encodes a run id so it cannot change the path or add a query", () => {
    const url = previewUrl("a/b?c", "runner-desktop");
    expect(url).toContain("/api/runs/a%2Fb%3Fc/settings.json");
    expect(url.split("?")).toHaveLength(2); // only the one query string
  });
});
