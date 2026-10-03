// The preferences as a small store a page can subscribe to (the React hook is in app/graphs/[id]/prefsStore.ts). They live
// in storage, read through ./prefs (which never throws and never trusts what it finds), and in memory too, so that a browser
// that blocks storage still lets the theme and the game view be changed for as long as the page is open.
import { DEFAULT_PREFS, PREFS_KEY, type Prefs, loadPrefs, savePrefs } from "@/lib/canvas/prefs";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export interface PrefsStore {
  /** The preferences: the same object until they change, as useSyncExternalStore needs. */
  get(): Prefs;
  /** Changes some of them. `persist: false` shows the change without storing it yet (a window being dragged). */
  set(next: Partial<Prefs>, options?: { persist?: boolean }): void;
  subscribe(listener: () => void): () => void;
  /** Another tab changed the stored preferences: forget what this page changed in memory, and read them again. */
  refresh(): void;
}

export function createPrefsStore(getStorage: () => PrefsStorage | null): PrefsStore {
  const listeners = new Set<() => void>();
  let override: Prefs | null = null; // the latest value set in this page
  let cachedRaw: string | null | undefined;
  let cachedPrefs: Prefs = DEFAULT_PREFS;

  function storage(): PrefsStorage | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function readRaw(): string | null {
    try {
      return storage()?.getItem(PREFS_KEY) ?? null;
    } catch {
      return null;
    }
  }

  function get(): Prefs {
    if (override) return override;
    const raw = readRaw();
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedPrefs = loadPrefs({ getItem: () => raw });
    }
    return cachedPrefs;
  }

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    get,
    set(next, { persist = true } = {}) {
      override = { ...get(), ...next };
      if (persist) savePrefs(storage(), override);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    refresh() {
      override = null;
      notify();
    },
  };
}
