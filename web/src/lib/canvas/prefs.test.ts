import { describe, expect, it } from "vitest";
import { clampRect, DEFAULT_PREFS, loadPrefs, moveRect, PREFS_KEY, type Prefs, resizeRect, savePrefs } from "@/lib/canvas/prefs";

const VIEWPORT = { width: 1200, height: 800 };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe("loadPrefs", () => {
  it("gives the defaults with no storage, nothing stored, or junk stored", () => {
    expect(DEFAULT_PREFS).toEqual({ theme: "dark", gameView: "docked", floating: { x: 24, y: 96, width: 320, height: 420 } });
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
    for (const junk of ["not json", "[]", "null", "5", '"dark"']) {
      expect(loadPrefs(memoryStorage({ [PREFS_KEY]: junk }))).toEqual(DEFAULT_PREFS);
    }
  });

  it("keeps the fields that are valid and defaults the one that is not", () => {
    const stored = { theme: "blue", gameView: "floating", floating: { x: 10, y: 20, width: 300, height: 200 } };
    expect(loadPrefs(memoryStorage({ [PREFS_KEY]: JSON.stringify(stored) }))).toEqual({
      theme: "dark",
      gameView: "floating",
      floating: { x: 10, y: 20, width: 300, height: 200 },
    });
    expect(loadPrefs(memoryStorage({ [PREFS_KEY]: JSON.stringify({ theme: "light", gameView: "tiny", floating: { x: "1" } }) }))).toEqual({
      theme: "light",
      gameView: "docked",
      floating: DEFAULT_PREFS.floating,
    });
    expect(loadPrefs(memoryStorage({ [PREFS_KEY]: JSON.stringify({ floating: { x: 1, y: 2, width: Infinity, height: 3 } }) })).floating).toEqual(DEFAULT_PREFS.floating);
  });

  it("gives the defaults when reading throws", () => {
    const broken = { getItem: () => { throw new Error("storage is blocked"); } };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
  });
});

describe("savePrefs", () => {
  it("writes the preferences as JSON under gsp.prefs, and they load back", () => {
    const storage = memoryStorage();
    const prefs: Prefs = { theme: "light", gameView: "full", floating: { x: 5, y: 6, width: 400, height: 300 } };
    savePrefs(storage, prefs);
    expect(PREFS_KEY).toBe("gsp.prefs");
    expect(JSON.parse(storage.data.get(PREFS_KEY)!)).toEqual(prefs);
    expect(loadPrefs(storage)).toEqual(prefs);
  });

  it("does not throw when writing fails (private mode, quota), or with no storage", () => {
    const broken = { setItem: () => { throw new Error("quota"); } };
    expect(() => savePrefs(broken, DEFAULT_PREFS)).not.toThrow();
    expect(() => savePrefs(null, DEFAULT_PREFS)).not.toThrow();
  });
});

describe("window geometry", () => {
  it("clampRect keeps a window at least 240 x 160 and inside the viewport", () => {
    expect(clampRect({ x: 0, y: 0, width: 100, height: 50 }, VIEWPORT)).toEqual({ x: 0, y: 0, width: 240, height: 160 });
    expect(clampRect({ x: 1100, y: 750, width: 300, height: 200 }, VIEWPORT)).toEqual({ x: 900, y: 600, width: 300, height: 200 });
    expect(clampRect({ x: -50, y: -9, width: 300, height: 200 }, VIEWPORT)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(clampRect({ x: 0, y: 0, width: 5000, height: 5000 }, VIEWPORT)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    expect(clampRect({ x: 30, y: 30, width: 300, height: 200 }, { width: 200, height: 100 })).toEqual({ x: 0, y: 0, width: 240, height: 160 });
  });

  it("moveRect moves by the drag and stops at the edges", () => {
    const rect = { x: 100, y: 100, width: 300, height: 200 };
    expect(moveRect(rect, 50, -30, VIEWPORT)).toEqual({ x: 150, y: 70, width: 300, height: 200 });
    expect(moveRect(rect, -500, -500, VIEWPORT)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(moveRect(rect, 5000, 5000, VIEWPORT)).toEqual({ x: 900, y: 600, width: 300, height: 200 });
  });

  it("resizeRect grows or shrinks from the corner, keeping the minimum and the viewport, and the top left where it is", () => {
    const rect = { x: 100, y: 100, width: 300, height: 200 };
    expect(resizeRect(rect, 60, 40, VIEWPORT)).toEqual({ x: 100, y: 100, width: 360, height: 240 });
    expect(resizeRect(rect, -500, -500, VIEWPORT)).toEqual({ x: 100, y: 100, width: 240, height: 160 });
    expect(resizeRect(rect, 5000, 5000, VIEWPORT)).toEqual({ x: 100, y: 100, width: 1100, height: 700 });
  });
});
