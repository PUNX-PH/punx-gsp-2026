"use client";

// Keeps a popup (the Add menu, a toast beside the pointer) inside the window. It measures the element after it is drawn and,
// if it runs off an edge, moves it back in (the geometry is lib/canvas/prefs.fitPoint). It only changes `left` and `top`, so
// the element has to be positioned with them. `key` names what the position depends on: it is measured again when that changes.
import { type RefObject, useLayoutEffect } from "react";
import { fitPoint } from "@/lib/canvas/prefs";

export function useFitInViewport(ref: RefObject<HTMLElement | null>, enabled: boolean, key: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const box = element.getBoundingClientRect();
    const fitted = fitPoint({ x: box.left, y: box.top }, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight });
    if (Math.abs(fitted.x - box.left) >= 0.5) element.style.left = `${fitted.x}px`;
    if (Math.abs(fitted.y - box.top) >= 0.5) element.style.top = `${fitted.y}px`;
  }, [ref, enabled, key]);
}
