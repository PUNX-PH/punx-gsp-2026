"use client";

// A short message that goes away by itself: at the bottom of the window, or, when `at` is given, beside the pointer (where a
// wire was refused), moved back inside the window if that is near an edge.
import { useRef } from "react";
import styles from "@/app/graphs/[id]/editor.module.css";
import { useFitInViewport } from "@/app/graphs/[id]/useFitInViewport";

export function Toast({ message, at, seq }: { message: string; at: { x: number; y: number } | null; seq: number }) {
  const element = useRef<HTMLParagraphElement>(null);
  useFitInViewport(element, at !== null, `${at?.x}:${at?.y}:${seq}`);
  return (
    <p
      ref={element}
      role="alert"
      className={styles.toast}
      style={at ? { left: at.x + 12, top: at.y + 12, bottom: "auto", transform: "none" } : undefined}
    >
      {message}
    </p>
  );
}
