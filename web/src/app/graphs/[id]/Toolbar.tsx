"use client";

// The bar along the top: the graph's name, what saving is doing, adding a step, the theme, and the Play button.
import styles from "@/app/graphs/[id]/editor.module.css";
import { PlusIcon } from "@/app/graphs/[id]/icons";
import type { SaveState } from "@/lib/canvas/autosave";
import type { Theme } from "@/lib/canvas/prefs";

export interface ToolbarProps {
  name: string;
  save: SaveState;
  theme: Theme;
  /** False while there is nothing to play, so Play is switched off. */
  canPlay: boolean;
  playing: boolean;
  onPlay: () => void;
  onAddStep: () => void;
  onTheme: (theme: Theme) => void;
  onRetry: () => void;
}

const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

function saveText(save: SaveState): string {
  if (save.status === "error") return `Couldn't save: ${save.message}`;
  return save.status === "dirty" || save.status === "saving" ? "Saving…" : "Saved";
}

export function Toolbar({ name, save, theme, canPlay, playing, onPlay, onAddStep, onTheme, onRetry }: ToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Editor">
      <h1 className={styles.graphName}>{name}</h1>
      <p className={styles.saveState} data-state={save.status} role="status">
        {saveText(save)}
        {save.status === "error" && save.retryable && (
          <button type="button" className={styles.linkButton} onClick={onRetry}>
            Retry
          </button>
        )}
      </p>
      <span className={styles.spacer} />
      <button type="button" className={styles.secondary} onClick={onAddStep}>
        <PlusIcon />
        Add step
      </button>
      <div className={styles.segmented} role="group" aria-label="Theme">
        {THEMES.map((option) => (
          <button key={option.id} type="button" data-theme-option={option.id} aria-pressed={theme === option.id} onClick={() => onTheme(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      <button type="button" data-action="play" className={styles.play} disabled={!canPlay || playing} onClick={onPlay}>
        {playing ? "Playing…" : "Play"}
      </button>
    </div>
  );
}
