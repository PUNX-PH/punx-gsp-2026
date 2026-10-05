import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPanel } from "@/app/graphs/[id]/SettingsPanel";
import { StepCardView } from "@/app/graphs/[id]/StepCardView";
import { stepData } from "@/lib/canvas/cardView";
import { emptyRunView, type RunView } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import type { Graph } from "@/lib/graph/types";

const tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };
const node = (id: string, type: string, params: Record<string, unknown>) => ({ id, type, params, position: { x: 0, y: 0 } });
const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

const graph = (params: Record<string, unknown> = {}): Graph => ({
  schemaVersion: 1,
  nodes: [
    node("n1", "build-model", { role: "hero", kind: "auto", description: "", run: "", jump: "", loop: "", ...params }),
    node("n2", "game-template", { tuning }),
    node("n3", "preview", {}),
  ],
  edges: [wire("n1", "model", "n2", "hero"), wire("n2", "settings", "n3", "settings")],
});

function dataFor(g: Graph, run: RunView = emptyRunView(null)) {
  return stepData({ graph: g, node: g.nodes[0], assets: {}, run, numbers: stepNumbers(g), graphId: "g1", pending: new Set() });
}

function panel(params: Record<string, unknown> = {}, onSettings: (nodeId: string, patch: Record<string, unknown>) => void = () => {}) {
  const g = graph(params);
  return renderToString(
    <SettingsPanel node={g.nodes[0]} data={dataFor(g)} assets={{}} graphId="g1" uploading={false} error={null} onChooseFile={() => {}} onTune={() => {}} onPrompt={() => {}} onSettings={onSettings} />,
  );
}

const done = (result: unknown): RunView => ({ ...emptyRunView(null), outcomes: { n1: { state: "done", result } } });
const card = (run: RunView) => renderToString(<StepCardView data={dataFor(graph(), run)} selected={false} />);

const buttons = (html: string, label: RegExp) => html.split("<button").slice(1).filter((part) => label.test(part));
const pressed = (part: string) => /aria-pressed="true"/.test(part);
const pressedNames = (html: string, names: string[]) => names.filter((name) => buttons(html, new RegExp(`>${name}<`)).some(pressed));

const built = {
  role: "hero",
  kind: "biped",
  parts: 15,
  triangles: 180,
  size: 31_949,
  clips: ["Run", "Jump"],
  summary: "A blocky two-legged character.",
  skipped: [],
  reused: false,
};

describe("the Build Model panel", () => {
  it("starts with Hero and Auto pressed, an empty What is it? box, a Run and a Jump box and no Loop box", () => {
    const html = panel();
    expect(pressedNames(html, ["Hero", "Obstacle", "Collectible"])).toEqual(["Hero"]);
    expect(pressedNames(html, ["Auto", "Two-legged character", "Wheeled vehicle", "Bouncy blob", "Simple prop"])).toEqual(["Auto"]);
    expect(html).toContain("What is it?");
    expect(html).toMatch(/<textarea[^>]*maxLength="300"/);
    expect(html).toContain("300 characters left");
    expect(html).toMatch(/<label[^>]*>Run<\/label>/);
    expect(html).toMatch(/<label[^>]*>Jump<\/label>/);
    expect(html).not.toMatch(/<label[^>]*>Loop<\/label>/);
    expect(html.match(/<textarea/g)).toHaveLength(3); // What is it?, Run, Jump
    expect(html.match(/maxLength="200"/g)).toHaveLength(2);
  });

  it("offers the three roles and the five kinds by their plain names", () => {
    const html = panel();
    for (const name of ["Hero", "Obstacle", "Collectible", "Auto", "Two-legged character", "Wheeled vehicle", "Bouncy blob", "Simple prop"]) {
      expect(buttons(html, new RegExp(`>${name}<`)), name).toHaveLength(1);
    }
    expect(html).toContain("Role");
    expect(html).toContain("Kind");
  });

  it("shows the saved role and kind as pressed", () => {
    const html = panel({ role: "collectible", kind: "prop" });
    expect(pressedNames(html, ["Hero", "Obstacle", "Collectible"])).toEqual(["Collectible"]);
    expect(pressedNames(html, ["Auto", "Two-legged character", "Wheeled vehicle", "Bouncy blob", "Simple prop"])).toEqual(["Simple prop"]);
  });

  it.each(["obstacle", "collectible"])("shows only the Loop box for the role %s", (role) => {
    const html = panel({ role });
    expect(html).toMatch(/<label[^>]*>Loop<\/label>/);
    expect(html).not.toMatch(/<label[^>]*>Run<\/label>/);
    expect(html).not.toMatch(/<label[^>]*>Jump<\/label>/);
    expect(html.match(/<textarea/g)).toHaveLength(2); // What is it? and Loop
  });

  it("counts the characters left of the description", () => {
    expect(panel({ description: "a".repeat(250) })).toContain("50 characters left");
    expect(panel({ description: "👻".repeat(300) })).toContain("0 characters left");
  });

  it("holds the saved words in its boxes", () => {
    const html = panel({ description: "a red fox", run: "sprint", jump: "leap" });
    expect(html).toMatch(/<textarea[^>]*>a red fox<\/textarea>/);
    expect(html).toMatch(/<textarea[^>]*>sprint<\/textarea>/);
    expect(html).toMatch(/<textarea[^>]*>leap<\/textarea>/);
  });

  it("says to leave a box empty for the usual motion", () => {
    expect(panel()).toContain("Leave a box empty for the usual motion.");
  });

  it("says exactly once what is sent to Anthropic, and that nothing is sent with every box empty", () => {
    const html = panel();
    expect(html.match(/Anthropic&#x27;s Claude to design this; with every box empty, nothing is sent\./g)).toHaveLength(1);
    expect(html.match(/Anthropic/g)).toHaveLength(1);
  });

  it("escapes a saved description instead of drawing it as markup", () => {
    const html = panel({ description: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("the Build Model card", () => {
  it("shows the line in a chip, the clips, and the summary as text, with nothing else when nothing was skipped or reused", () => {
    const html = card(done(built));
    expect(html).toContain("Two-legged character, 15 parts, 180 triangles, 31.2 KB");
    expect(html).toMatch(/<span class="[^"]*chip[^"]*">Two-legged character, 15 parts, 180 triangles, 31\.2 KB<\/span>/);
    expect(html).toContain("Moves: Run, Jump");
    expect(html).toMatch(/<p class="[^"]*summary[^"]*">A blocky two-legged character\.<\/p>/);
    expect(html).not.toContain("Skipped");
    expect(html).not.toContain("Reused");
  });

  it("shows what was skipped, and says when the result was reused", () => {
    const html = card(done({ ...built, skipped: [{ clip: "Run", joint: "tail_1" }, { clip: "Loop", joint: "ear_l" }], reused: true }));
    expect(html).toContain("Skipped, no such part: tail_1 (Run), ear_l (Loop)");
    expect(html).toContain("Reused your earlier result");
  });

  it("says Still for a model with no clips", () => {
    expect(card(done({ ...built, clips: [] }))).toContain("Still");
  });

  it("renders a summary of markup escaped", () => {
    const html = card(done({ ...built, summary: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("draws nothing extra before a run", () => {
    const html = card(emptyRunView(null));
    expect(html).not.toContain("Moves:");
    expect(html).toContain("Build Model");
  });
});
