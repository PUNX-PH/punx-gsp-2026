"use client";

import { useSyncExternalStore } from "react";
import { pickTemplate, previewUrl } from "@/lib/preview";

const TOUCH_SCREEN = "(pointer: coarse)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(TOUCH_SCREEN);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function PreviewFrame({ runId }: { runId: string }) {
  // Decided in the browser: the mobile build for a touch screen, the desktop build otherwise. On the server the
  // answer is unknown (null), so nothing is rendered until the browser has answered.
  const touchScreen = useSyncExternalStore<boolean | null>(subscribe, () => window.matchMedia(TOUCH_SCREEN).matches, () => null);
  if (touchScreen === null) return null;

  return (
    <iframe
      src={previewUrl(runId, pickTemplate(touchScreen))}
      title="Game preview"
      allow="fullscreen"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0 }}
    />
  );
}
