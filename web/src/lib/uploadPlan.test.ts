import { describe, expect, it } from "vitest";
import { planUploads } from "@/lib/uploadPlan";

const file = (name: string) => ({ name }) as File;

describe("planUploads", () => {
  it("matches each needed name to the chosen file with exactly that name", () => {
    const plan = planUploads(["hero.glb", "coin.glb"], [file("coin.glb"), file("hero.glb"), file("extra.glb")]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.uploads.map((u) => [u.name, u.file.name])).toEqual([["hero.glb", "hero.glb"], ["coin.glb", "coin.glb"]]);
  });

  it("lists every missing name in one sentence, before anything is uploaded", () => {
    expect(planUploads(["hero.glb", "obstacle.glb", "coin.glb"], [file("obstacle.glb")])).toEqual({
      ok: false,
      error: "Choose hero.glb, coin.glb",
    });
  });

  it("matches a chosen file whatever its letter case (Windows and macOS do not tell hero.glb from Hero.glb)", () => {
    const plan = planUploads(["Hero.GLB"], [file("hero.glb")]);
    expect(plan.ok).toBe(true);
    // The upload goes under the name the settings use, with the chosen file's contents.
    if (plan.ok) expect(plan.uploads.map((u) => [u.name, u.file.name])).toEqual([["Hero.GLB", "hero.glb"]]);
  });

  it("prefers the file whose name matches exactly when several differ only by case", () => {
    const plan = planUploads(["hero.glb"], [file("HERO.GLB"), file("hero.glb")]);
    if (plan.ok) expect(plan.uploads[0].file.name).toBe("hero.glb");
    else throw new Error(plan.error);
  });

  it("still reports a name that no chosen file matches, even ignoring case", () => {
    expect(planUploads(["hero.glb"], [file("coin.glb")])).toEqual({ ok: false, error: "Choose hero.glb" });
  });

  it("needs only one file when one name serves every role", () => {
    const plan = planUploads(["all.glb"], [file("all.glb")]);
    expect(plan.ok).toBe(true);
  });
});

describe("planUploads with a size limit", () => {
  const sized = (name: string, size: number) => ({ name, size }) as File;
  const FOUR_MB = 4 * 1024 * 1024;

  it("refuses a file over the limit, naming it, before anything is sent", () => {
    expect(planUploads(["hero.glb", "coin.glb"], [sized("hero.glb", FOUR_MB + 1), sized("coin.glb", 10)], FOUR_MB)).toEqual({
      ok: false,
      error: "hero.glb: larger than 4 MB",
    });
  });

  it("accepts a file of exactly the limit", () => {
    expect(planUploads(["hero.glb"], [sized("hero.glb", FOUR_MB)], FOUR_MB).ok).toBe(true);
  });

  it("reports missing files before oversize ones", () => {
    expect(planUploads(["hero.glb", "coin.glb"], [sized("hero.glb", FOUR_MB + 1)], FOUR_MB)).toEqual({ ok: false, error: "Choose coin.glb" });
  });
});
