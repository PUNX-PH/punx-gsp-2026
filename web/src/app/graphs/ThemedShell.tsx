"use client";

// Gives a page the editor's colors and the person's saved theme (dark until the browser has answered).
import type { ReactNode } from "react";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { usePrefs } from "@/app/graphs/[id]/prefsStore";

export function ThemedShell({ children }: { children: ReactNode }) {
  const [prefs] = usePrefs();
  return (
    <div className={cx(styles.editor, styles.listShell)} data-theme={prefs.theme}>
      {children}
    </div>
  );
}
