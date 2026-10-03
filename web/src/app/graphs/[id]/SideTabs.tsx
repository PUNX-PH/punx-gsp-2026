"use client";

// The tabs along the top of the side panel, and the button that hides the panel. Hide is next to the tabs, not one of them.
import styles from "@/app/graphs/[id]/editor.module.css";

export interface SideTabsProps {
  /** The game is docked in this panel, so it has a tab of its own; otherwise there is only Settings. */
  docked: boolean;
  tab: "settings" | "game";
  onTab: (tab: "settings" | "game") => void;
  onHide: () => void;
}

export function SideTabs({ docked, tab, onTab, onHide }: SideTabsProps) {
  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label="Side panel" className={styles.tabList}>
        <button type="button" role="tab" aria-selected={!docked || tab === "settings"} onClick={() => onTab("settings")}>
          Settings
        </button>
        {docked && (
          <button type="button" role="tab" aria-selected={tab === "game"} onClick={() => onTab("game")}>
            Game
          </button>
        )}
      </div>
      <button type="button" className={styles.collapse} aria-label="Hide panel" onClick={onHide}>
        Hide
      </button>
    </div>
  );
}
