"use client";

// The preferences as something React can subscribe to: the store in lib/canvas/prefsStore, on the browser's localStorage,
// told when another tab changes what is stored.
import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, type Prefs } from "@/lib/canvas/prefs";
import { type PrefsStore, createPrefsStore } from "@/lib/canvas/prefsStore";

const store = createPrefsStore(() => window.localStorage);

function subscribe(onChange: () => void): () => void {
  const stop = store.subscribe(onChange);
  const onStorage = () => store.refresh();
  window.addEventListener("storage", onStorage);
  return () => {
    stop();
    window.removeEventListener("storage", onStorage);
  };
}

/** The preferences, and a way to change some of them. The defaults are used on the server and until the browser answers. */
export function usePrefs(): [Prefs, PrefsStore["set"]] {
  const prefs = useSyncExternalStore(subscribe, store.get, () => DEFAULT_PREFS);
  return [prefs, store.set];
}
