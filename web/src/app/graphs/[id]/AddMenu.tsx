"use client";

// The "Add step" menu: every kind of step with its plain name and help, or, from an open output, only the steps that fit.
// A step that cannot be added is listed but greyed, with the reason.
import styles from "@/app/graphs/[id]/editor.module.css";
import type { Choice } from "@/lib/canvas/addMenu";

export interface AddMenuProps {
  choices: Choice[];
  onPick: (choice: Choice) => void;
  onClose: () => void;
  /** Where to open it, in pixels from the top left of the editor. Defaults to near the top left. */
  anchor?: { x: number; y: number };
}

export function AddMenu({ choices, onPick, onClose, anchor }: AddMenuProps) {
  return (
    <div className={styles.menuBackdrop} onClick={onClose}>
      <div
        role="menu"
        aria-label="Add a step"
        className={styles.menu}
        style={anchor ? { left: anchor.x, top: anchor.y } : undefined}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
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
