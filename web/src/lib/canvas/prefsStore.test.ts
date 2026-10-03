import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, PREFS_KEY } from "@/lib/canvas/prefs";
import { createPrefsStore } from "@/lib/canvas/prefsStore";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    data,
  };
}

describe("createPrefsStore", () => {
  it("gives the defaults when nothing is stored, and the same object until something changes", () => {
    const store = createPrefsStore(() => memoryStorage());
    expect(store.get()).toEqual(DEFAULT_PREFS);
    expect(store.get()).toBe(store.get());
  });

  it("changes some preferences, keeps the rest, stores them, and tells its listeners", () => {
    const storage = memoryStorage();
    const store = createPrefsStore(() => storage);
    const heard = vi.fn();
    store.subscribe(heard);

    store.set({ theme: "light" });

    expect(store.get()).toEqual({ ...DEFAULT_PREFS, theme: "light" });
    expect(JSON.parse(storage.data.get(PREFS_KEY)!)).toEqual({ ...DEFAULT_PREFS, theme: "light" });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = createPrefsStore(() => memoryStorage());
    const heard = vi.fn();
    store.subscribe(heard)();
    store.set({ theme: "light" });
    expect(heard).not.toHaveBeenCalled();
  });

  it("can show a change without storing it yet (a window being dragged), and stores the last one", () => {
    const storage = memoryStorage();
    const store = createPrefsStore(() => storage);
    const heard = vi.fn();
    store.subscribe(heard);

    store.set({ floating: { x: 1, y: 1, width: 300, height: 200 } }, { persist: false });
    store.set({ floating: { x: 2, y: 2, width: 300, height: 200 } }, { persist: false });
    expect(store.get().floating.x).toBe(2);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(storage.setItem).not.toHaveBeenCalled();

    store.set({ floating: { x: 3, y: 3, width: 300, height: 200 } });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("still changes for as long as the page is open when storage is blocked or refuses to write", () => {
    const blocked = createPrefsStore(() => null);
    blocked.set({ theme: "light" });
    expect(blocked.get().theme).toBe("light");

    const throwing = createPrefsStore(() => {
      throw new Error("SecurityError");
    });
    throwing.set({ gameView: "full" });
    expect(throwing.get().gameView).toBe("full");

    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    const refusing = createPrefsStore(() => full);
    refusing.set({ theme: "light" });
    expect(refusing.get().theme).toBe("light");
  });

  it("shows what another tab stored once told (the storage event), instead of this page's older value", () => {
    const storage = memoryStorage();
    const store = createPrefsStore(() => storage);
    store.set({ theme: "light" });

    // Another tab stores its own preferences.
    storage.data.set(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, theme: "dark", gameView: "floating" }));
    expect(store.get().theme).toBe("light"); // nothing has told this page yet

    const heard = vi.fn();
    store.subscribe(heard);
    store.refresh();

    expect(store.get()).toMatchObject({ theme: "dark", gameView: "floating" });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
