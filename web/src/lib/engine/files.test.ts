import { describe, expect, it } from "vitest";
import { entityFile, mobileFile, pcFileOf } from "@/lib/engine/files";

describe("the phone variant of an entity file", () => {
  it("is named beside the file, and the name leads back to it", () => {
    expect(mobileFile(entityFile("fox"))).toBe("entity-fox.mobile.glb");
    expect(pcFileOf("entity-fox.mobile.glb")).toBe("entity-fox.glb");
    expect(pcFileOf("entity-fox.glb")).toBeNull();
    expect(pcFileOf("fox.mobile.glb.txt")).toBeNull();
  });
});
