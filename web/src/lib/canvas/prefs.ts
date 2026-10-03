// The person's own preferences, kept per browser: the theme, where the game plays, and the floating window's place and
// size. Reading and writing never throw into the page (private windows and blocked storage are normal), and junk in
// storage never breaks it: each field falls back to its default on its own.

export type Theme = "dark" | "light";
export type GameView = "docked" | "floating" | "full";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Prefs {
  theme: Theme;
  gameView: GameView;
  floating: Rect;
}

export const PREFS_KEY = "gsp.prefs";
export const DEFAULT_PREFS: Prefs = { theme: "dark", gameView: "docked", floating: { x: 24, y: 96, width: 320, height: 420 } };

const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;

const THEMES: Theme[] = ["dark", "light"];
const GAME_VIEWS: GameView[] = ["docked", "floating", "full"];
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validRect(value: unknown): Rect | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  return isNumber(x) && isNumber(y) && isNumber(width) && isNumber(height) ? { x, y, width, height } : null;
}

export function loadPrefs(storage: Pick<Storage, "getItem"> | null): Prefs {
  let stored: unknown;
  try {
    const text = storage?.getItem(PREFS_KEY);
    stored = text ? JSON.parse(text) : null;
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return DEFAULT_PREFS;

  const { theme, gameView, floating } = stored as Record<string, unknown>;
  return {
    theme: THEMES.includes(theme as Theme) ? (theme as Theme) : DEFAULT_PREFS.theme,
    gameView: GAME_VIEWS.includes(gameView as GameView) ? (gameView as GameView) : DEFAULT_PREFS.gameView,
    floating: validRect(floating) ?? DEFAULT_PREFS.floating,
  };
}

export function savePrefs(storage: Pick<Storage, "setItem"> | null, prefs: Prefs): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Nothing to do: the preferences just do not persist.
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** A window at least 240 x 160 that fits inside the viewport. */
export function clampRect(rect: Rect, viewport: { width: number; height: number }): Rect {
  const width = clamp(rect.width, MIN_WIDTH, viewport.width);
  const height = clamp(rect.height, MIN_HEIGHT, viewport.height);
  return { x: clamp(rect.x, 0, viewport.width - width), y: clamp(rect.y, 0, viewport.height - height), width, height };
}

/** The window dragged by (dx, dy), stopping at the edges. */
export function moveRect(rect: Rect, dx: number, dy: number, viewport: { width: number; height: number }): Rect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, viewport);
}

/** The window resized from its bottom right corner: the top left stays, and it never leaves the viewport or gets too small. */
export function resizeRect(rect: Rect, dw: number, dh: number, viewport: { width: number; height: number }): Rect {
  return {
    ...rect,
    width: clamp(rect.width + dw, MIN_WIDTH, viewport.width - rect.x),
    height: clamp(rect.height + dh, MIN_HEIGHT, viewport.height - rect.y),
  };
}

const EDGE_MARGIN = 8;

/** Where a box of this size should start to stay inside the viewport, as close to `point` as it can; its top left wins when it is too big. */
export function fitPoint(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = EDGE_MARGIN,
): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(point.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(point.y, viewport.height - size.height - margin)),
  };
}

/** The view "Back to canvas" returns to: whichever one the game was in when it went full screen. */
export function viewToReturnTo(returnTo: Exclude<GameView, "full">, current: GameView, picked: GameView): Exclude<GameView, "full"> {
  return picked === "full" && current !== "full" ? current : returnTo;
}
