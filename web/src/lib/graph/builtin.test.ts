import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtinModel } from "@/lib/graph/builtin";
import type { Role } from "@/lib/graph/types";
import { checkGlb } from "@/lib/glb";

const SAMPLES = fileURLToPath(new URL("../../../../unity/runner-template/Assets/StreamingAssets/sample/", import.meta.url));
const SAMPLE_FILE: Record<Role, string> = { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "coin.glb" };

describe("the built-in models", () => {
  it.each(Object.keys(SAMPLE_FILE) as Role[])("%s is the Unity sample, byte for byte, and a valid GLB", (role) => {
    const bytes = builtinModel(role);
    expect(Buffer.from(bytes).equals(readFileSync(SAMPLES + SAMPLE_FILE[role]))).toBe(true);
    expect(checkGlb(`${role}.glb`, bytes)).toEqual({ ok: true });
  });

  it("gives a fresh copy each time, so one caller cannot change what the next one gets", () => {
    const first = builtinModel("hero");
    const original = first.slice();
    first.fill(0);
    expect(builtinModel("hero")).toEqual(original);
  });
});
