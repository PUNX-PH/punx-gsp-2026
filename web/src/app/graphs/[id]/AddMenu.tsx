"use client";

// The "Add step" menu: every kind of step with its plain name and help, or, from an open output, only the steps that fit.
// A step that cannot be added is listed but greyed, with the reason.
import { useEffect, useRef } from "react";
import styles from "@/app/graphs/[id]/editor.module.css";
import { useFitInViewport } from "@/app/graphs/[id]/useFitInViewport";
import type { Choice } from "@/lib/canvas/addMenu";

export interface AddMenuProps {
  choices: Choice[];
  onPick: (choice: Choice) => void;
  onClose: () => void;
  /** Where to open it, in pixels from the top left of the editor. Defaults to near the top left. */
  anchor?: { x: number; y: number };
}

export function AddMenu({ choices, onPick, onClose, anchor }: AddMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useFitInViewport(menu, true, `${anchor?.x}:${anchor?.y}:${choices.length}`); // a menu opened near an edge is moved back inside the window

  // Opens with the first choice focused (so the keyboard works at once), closes on Escape wherever the focus is, and hands
  // the focus back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className={styles.menuBackdrop} onClick={onClose}>
      <div
        ref={menu}
        role="menu"
        aria-label="Add a step"
        className={styles.menu}
        style={anchor ? { left: anchor.x, top: anchor.y } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {choices.length === 0 ? (
          <p className={styles.menuEmpty}>No step fits here.</p>
        ) : (
          choices.map((choice) => (
            <button key={choice.type} type="button" role="menuitem" className={styles.menuItem} disabled={Boolean(choice.disabledReason)} onClick={() => onPick(choice)}>
              <span className={styles.menuName}>{choice.label}</span>
              <span className={styles.menuHelp}>{choice.help}</span>
              {choice.disabledReason && <span className={styles.menuReason}>{choice.disabledReason}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
