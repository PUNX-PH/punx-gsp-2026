"use client";

// The preferences as something React can subscribe to. They live in localStorage (read through lib/canvas/prefs, which
// never throws and never trusts what it finds), and in memory too, so that a browser that blocks storage still lets the
// theme and the game view be changed for as long as the page is open.
import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, PREFS_KEY, type Prefs, loadPrefs, savePrefs } from "@/lib/canvas/prefs";

const listeners = new Set<() => void>();
let override: Prefs | null = null; // the latest value set in this page
let cachedRaw: string | null | undefined;
let cachedPrefs: Prefs = DEFAULT_PREFS;

function storage(): Storage | null {
  try {
    return window.localStorage;
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

// A stable object for as long as what is stored does not change, as useSyncExternalStore needs.
function snapshot(): Prefs {
  if (override) return override;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = loadPrefs({ getItem: () => raw });
  }
  return cachedPrefs;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function change(next: Partial<Prefs>) {
  override = { ...snapshot(), ...next };
  savePrefs(storage(), override);
  for (const listener of listeners) listener();
}

/** The preferences, and a way to change some of them. The defaults are used on the server and until the browser answers. */
export function usePrefs(): [Prefs, (change: Partial<Prefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PREFS);
  return [prefs, change];
}
