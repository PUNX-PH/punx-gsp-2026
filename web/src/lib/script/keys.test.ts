import { describe, expect, it } from "vitest";
import { scriptKey } from "./keys";

describe("scriptKey and the chosen view", () => {
  const base = { model: "m", uid: "u", description: "a shooter", pictureSha: null, models: [], attempt: 0 };

  it("is the same for auto as for no choice, so earlier games keep their answers", async () => {
    expect(await scriptKey({ ...base, perspective: "auto" })).toBe(await scriptKey(base));
  });

  it("is a different answer for each chosen view", async () => {
    const keys = await Promise.all(["first", "third", "top", "side"].map((perspective) => scriptKey({ ...base, perspective })));
    expect(new Set([...keys, await scriptKey(base)]).size).toBe(5);
  });
});
