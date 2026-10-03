import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameFrame, GamePanel } from "@/app/graphs/[id]/GamePanel";
import { Toolbar } from "@/app/graphs/[id]/Toolbar";
import type { SaveState } from "@/lib/canvas/autosave";
import { DEFAULT_PREFS } from "@/lib/canvas/prefs";

const noop = () => {};

function toolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  return renderToString(
    <Toolbar
      name="My game"
      save={{ status: "saved" }}
      theme="dark"
      canPlay
      playing={false}
      onPlay={noop}
      onAddStep={noop}
      onTheme={noop}
      onRetry={noop}
      {...overrides}
    />,
  );
}

describe("Toolbar", () => {
  it("shows the graph's name and the way to add a step", () => {
    const html = toolbar();
    expect(html).toContain("My game");
    expect(html).toContain("Add step");
  });

  it.each<[string, SaveState, string]>([
    ["idle", { status: "idle" }, "Saved"],
    ["saved", { status: "saved" }, "Saved"],
    ["dirty", { status: "dirty" }, "Saving…"],
    ["saving", { status: "saving" }, "Saving…"],
    ["an error", { status: "error", message: "Couldn't reach the server.", retryable: true }, "Couldn&#x27;t save: Couldn&#x27;t reach the server."],
  ])("says what saving is doing: %s", (_label, save, text) => {
    expect(toolbar({ save })).toContain(text);
  });

  it("offers Retry only after a failure that can be retried", () => {
    expect(toolbar({ save: { status: "error", message: "x", retryable: true } })).toContain("Retry");
    expect(toolbar({ save: { status: "error", message: "x", retryable: false } })).not.toContain("Retry");
    expect(toolbar({ save: { status: "saved" } })).not.toContain("Retry");
  });

  it("has a Play button that is off when the graph cannot be played, and says so while playing", () => {
    const play = (html: string) => html.match(/<button[^>]*data-action="play"[^>]*>/)![0];
    expect(play(toolbar())).not.toContain("disabled");
    expect(play(toolbar({ canPlay: false }))).toContain("disabled");
    expect(play(toolbar({ playing: true }))).toContain("disabled");
    expect(toolbar({ playing: true })).toContain("Playing…");
    expect(toolbar()).toContain(">Play<");
  });

  it("lets the theme be chosen and marks the current one", () => {
    const dark = toolbar({ theme: "dark" });
    expect(dark).toMatch(/<button[^>]*data-theme-option="dark"[^>]*aria-pressed="true"/);
    expect(dark).toMatch(/<button[^>]*data-theme-option="light"[^>]*aria-pressed="false"/);
    expect(toolbar({ theme: "light" })).toMatch(/<button[^>]*data-theme-option="light"[^>]*aria-pressed="true"/);
  });
});

describe("GameFrame", () => {
  it("says to press Play when there is no run", () => {
    expect(renderToString(<GameFrame runId={null} outOfDate={false} coarsePointer={false} />)).toContain("Press Play to see your game here.");
  });

  it("shows the desktop template for a run, and the mobile one on a touch screen", () => {
    const desktop = renderToString(<GameFrame runId="run1" outOfDate={false} coarsePointer={false} />);
    expect(desktop).toContain("<iframe");
    expect(desktop).toContain('src="/templates/runner-desktop/index.html?settings=/api/runs/run1/settings.json"');
    const mobile = renderToString(<GameFrame runId="run1" outOfDate={false} coarsePointer />);
    expect(mobile).toContain("/templates/runner-mobile/index.html");
  });

  it("shows nothing for a run until it is known which template to use", () => {
    expect(renderToString(<GameFrame runId="run1" outOfDate={false} coarsePointer={null} />)).toBe("");
  });

  it("says when the game is out of date, and not otherwise", () => {
    expect(renderToString(<GameFrame runId="run1" outOfDate coarsePointer={false} />)).toContain("Out of date: press Play.");
    expect(renderToString(<GameFrame runId="run1" outOfDate={false} coarsePointer={false} />)).not.toContain("Out of date");
  });
});

describe("GamePanel", () => {
  const panel = (mode: "docked" | "floating" | "full") =>
    renderToString(
      <GamePanel mode={mode} rect={DEFAULT_PREFS.floating} viewport={{ width: 1200, height: 800 }} frame={<p>the game</p>} onMode={noop} onRect={noop} />,
    );

  it("offers the three views and marks the current one", () => {
    for (const mode of ["docked", "floating", "full"] as const) {
      const html = panel(mode);
      for (const option of ["docked", "floating", "full"]) {
        expect(html).toMatch(new RegExp(`<button[^>]*data-mode-option="${option}"[^>]*aria-pressed="${option === mode}"`));
      }
      expect(html).toContain("the game");
    }
  });

  it("puts a floating game in a window at its remembered place and size", () => {
    expect(panel("floating")).toContain("left:24px;top:96px;width:320px;height:420px");
    expect(panel("docked")).not.toContain("left:24px");
  });

  it("says how to get back from the full view", () => {
    expect(panel("full")).toContain("← Back to canvas");
    expect(panel("docked")).not.toContain("Back to canvas");
  });
});
