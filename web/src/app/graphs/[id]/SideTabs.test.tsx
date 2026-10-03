import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SideTabs } from "@/app/graphs/[id]/SideTabs";

const noop = () => {};

function render(overrides: Partial<Parameters<typeof SideTabs>[0]> = {}) {
  return renderToString(<SideTabs docked tab="settings" onTab={noop} onHide={noop} {...overrides} />);
}

// The tab list is a plain div with no div inside it, so its contents are everything up to the first </div>.
const tabList = (html: string) => html.match(/<div[^>]*role="tablist"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";

describe("SideTabs", () => {
  it("has a Settings tab and, when the game is docked, a Game tab, and says which one is open", () => {
    const html = render({ tab: "game" });
    expect(tabList(html)).toMatch(/aria-selected="false"[^>]*>Settings</);
    expect(tabList(html)).toMatch(/aria-selected="true"[^>]*>Game</);
  });

  it("has only the Settings tab, always open, when the game is somewhere else", () => {
    const html = render({ docked: false, tab: "game" });
    expect(tabList(html)).toMatch(/aria-selected="true"[^>]*>Settings</);
    expect(tabList(html)).not.toContain("Game");
  });

  it("keeps the Hide button out of the tab list: it is not a tab", () => {
    const html = render();
    expect(html).toContain("Hide panel");
    expect(tabList(html)).not.toContain("Hide");
  });
});
