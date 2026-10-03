"use client";

// Where the game plays. The frame is the same Unity template the Preview page shows; the panel puts it where the person
// chose: docked in the side panel, in a window they can drag and resize, or full screen.
import type { PointerEvent, ReactNode } from "react";
import styles from "@/app/graphs/[id]/editor.module.css";
import { type GameView, moveRect, type Rect, resizeRect } from "@/lib/canvas/prefs";
import { pickTemplate, previewUrl } from "@/lib/preview";

/** The game itself: an iframe of the template for this run, or a note that there is nothing to show yet. */
export function GameFrame({ runId, outOfDate, coarsePointer }: { runId: string | null; outOfDate: boolean; coarsePointer: boolean | null }) {
  if (!runId) return <p className={styles.gameEmpty}>Press Play to see your game here.</p>;
  if (coarsePointer === null) return null; // which template to use is not known until the browser has answered
  return (
    <>
      {outOfDate && (
        <p role="status" className={styles.outOfDate}>
          Out of date: press Play.
        </p>
      )}
      <iframe className={styles.gameFrame} src={previewUrl(runId, pickTemplate(coarsePointer))} title="Your game" allow="fullscreen" />
    </>
  );
}

export interface GamePanelProps {
  mode: GameView;
  rect: Rect;
  viewport: { width: number; height: number };
  frame: ReactNode;
  onMode: (mode: GameView) => void;
  /** The window was moved or resized. `final` is true once the pointer is let go: only then is it worth storing. */
  onRect: (rect: Rect, final: boolean) => void;
  /** Where "Back to canvas" goes from full screen: the view the game was in before. */
  backTo?: Exclude<GameView, "full">;
}

const MODES: { id: GameView; label: string }[] = [
  { id: "docked", label: "Dock" },
  { id: "floating", label: "Float" },
  { id: "full", label: "Full" },
];

export function GamePanel({ mode, rect, viewport, frame, onMode, onRect, backTo = "docked" }: GamePanelProps) {
  const modeButtons = (
    <div className={styles.segmented} role="group" aria-label="Game view">
      {MODES.map((option) => (
        <button key={option.id} type="button" data-mode-option={option.id} aria-pressed={mode === option.id} onClick={() => onMode(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );

  // Dragging the title bar or the corner: the pointer is captured, so it keeps working over the game's own frame.
  function drag(event: PointerEvent<HTMLElement>, step: (current: Rect, dx: number, dy: number) => Rect) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    let current = rect;
    let lastX = event.clientX;
    let lastY = event.clientY;
    const move = (e: globalThis.PointerEvent) => {
      current = step(current, e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
      onRect(current, false);
    };
    const stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
      onRect(current, true);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  }

  if (mode === "full") {
    return (
      <div className={styles.fullOverlay} role="dialog" aria-label="Game">
        <header className={styles.fullBar}>
          <button type="button" className={styles.secondary} onClick={() => onMode(backTo)}>
            ← Back to canvas
          </button>
          {modeButtons}
        </header>
        <div className={styles.gameBody}>{frame}</div>
      </div>
    );
  }

  if (mode === "floating") {
    return (
      <div className={styles.floating} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} role="dialog" aria-label="Game">
        <header className={styles.floatingBar} onPointerDown={(e) => drag(e, (r, dx, dy) => moveRect(r, dx, dy, viewport))}>
          <span className={styles.panelTitle}>Game</span>
          {modeButtons}
        </header>
        <div className={styles.gameBody}>{frame}</div>
        <div className={styles.resizeHandle} aria-hidden="true" onPointerDown={(e) => drag(e, (r, dx, dy) => resizeRect(r, dx, dy, viewport))} />
      </div>
    );
  }

  return (
    <section className={styles.docked} aria-label="Game">
      <header className={styles.dockedBar}>
        <span className={styles.panelTitle}>Game</span>
        {modeButtons}
      </header>
      <div className={styles.gameBody}>{frame}</div>
    </section>
  );
}
