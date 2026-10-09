import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddMenu } from "@/app/graphs/[id]/AddMenu";
import { SettingsPanel } from "@/app/graphs/[id]/SettingsPanel";
import { addChoices } from "@/lib/canvas/addMenu";
import { stepData } from "@/lib/canvas/cardView";
import { applyPlay, emptyRunView, type RunView } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import { addEdge, editAsset, editTuning } from "@/lib/graph/edits";
import type { NodeOutcome } from "@/lib/graph/runner";
import { starterGraph } from "@/lib/graph/starter";
import type { Assets, Graph } from "@/lib/graph/types";

const SHA = "a".repeat(64);
const MODEL_SHA = "b".repeat(64);
const assets: Assets = {
  [SHA]: { name: "photo.png", size: 900, kind: "image", contentType: "image/png", width: 30, height: 20, uploadedAt: 0 },
  [MODEL_SHA]: { name: "hero.glb", size: 1536, kind: "model", contentType: "model/gltf-binary", uploadedAt: 0 },
};

interface Options {
  graph?: Graph;
  run?: RunView;
  assets?: Assets;
  uploading?: boolean;
  error?: string | null;
}

function panel(id: string | null, options: Options = {}) {
  const graph = options.graph ?? starterGraph();
  const node = id ? graph.nodes.find((n) => n.id === id)! : null;
  const data = node
    ? stepData({ graph, node, assets: options.assets ?? assets, run: options.run ?? emptyRunView(null), numbers: stepNumbers(graph), graphId: "g1", pending: new Set() })
    : null;
  return renderToString(
    <SettingsPanel
      node={node}
      data={data}
      assets={options.assets ?? assets}
      graphId="g1"
      uploading={options.uploading ?? false}
      error={options.error ?? null}
      onChooseFile={() => {}}
      onTune={() => {}}
      onPrompt={() => {}}
      onSettings={() => {}}
    />,
  );
}

describe("SettingsPanel", () => {
  it("asks for a step to be selected when none is", () => {
    expect(panel(null)).toContain("Select a step to see its settings.");
  });

  it("names the selected step and says what it is", () => {
    const html = panel("n3");
    expect(html).toContain("Game Template");
    expect(html).toContain("Puts the game together");
  });

  it("lets a picture be chosen (PNG or JPEG), shows the chosen one, and shows an upload error", () => {
    const html = panel("n1", { graph: editAsset(starterGraph(), "n1", SHA).graph, error: "photo.png: not a PNG, JPEG or GLB file" });
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="\.png,\.jpg,\.jpeg,image\/png,image\/jpeg"/);
    expect(html).toContain(`src="/api/graphs/g1/assets/${SHA}"`);
    expect(html).toContain("photo.png");
    expect(html).toContain("not a PNG, JPEG or GLB file");
    expect(html).toContain('role="alert"');
  });

  it("disables the file picker while a file is uploading", () => {
    expect(panel("n1", { uploading: true })).toMatch(/<input[^>]*type="file"[^>]*disabled/);
    expect(panel("n1")).not.toMatch(/<input[^>]*type="file"[^>]*disabled/);
  });

  it("lets a model be chosen (GLB) and shows its name and size", () => {
    const html = panel("n5", { graph: editAsset(starterGraph(), "n5", MODEL_SHA).graph });
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="\.glb,\.fbx,\.obj"/);
    expect(html).toContain("hero.glb");
    expect(html).toContain("1.5 KB");
  });

  it("gives a Game Template three sliders in plain words, with their ranges and values", () => {
    const html = panel("n3");
    expect(html.match(/type="range"/g)).toHaveLength(3);
    for (const label of ["How fast it runs", "How high it jumps", "How far apart the obstacles are"]) expect(html).toContain(label);
    expect(html).toMatch(/type="range"[^>]*min="1"[^>]*max="20"/);
    expect(html).toMatch(/type="range"[^>]*min="1.5"[^>]*max="5"/);
    expect(html).toMatch(/type="range"[^>]*min="4"[^>]*max="40"/);
    expect(html).toContain("2.2");
  });

  it("says live when the tuning cannot be played, and nothing when it can", () => {
    const unplayable = editTuning(starterGraph(), "n3", { speed: 4, jumpHeight: 2.35, obstacleSpacing: 12 }).graph;
    expect(panel("n3", { graph: unplayable })).toContain("too low to jump");
    expect(panel("n3")).not.toContain("too low to jump");
  });

  it("says what an unconnected input does, and stops saying it once it is connected", () => {
    expect(panel("n3")).toContain("Without a hero model, a built-in shape is used.");
    expect(panel("n3")).toContain("Without an obstacle model, a built-in shape is used.");
    expect(panel("n3")).not.toContain("Without a palette"); // the starter wires the palette
    expect(panel("n3")).toContain("Without an environment, the plain ground and sky are used.");
    expect(panel("n3")).not.toContain("Without a environment");

    const wired = addEdge(starterGraph(), { from: { node: "n5", port: "model" }, to: { node: "n3", port: "hero" } });
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;
    expect(panel("n3", { graph: wired.graph })).not.toContain("Without a hero model");
  });

  it("explains the Palette from Image and shows its colors once there are some, and explains the Preview", () => {
    const outcomes: Record<string, NodeOutcome> = { n2: { state: "done", result: ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"] } };
    const run = applyPlay(emptyRunView(null), starterGraph(), { kind: "ran", state: "done", order: ["n1", "n2", "n3", "n4"], nodes: outcomes, runId: "r" });
    expect(panel("n2")).toContain("Picks five colors from a picture.");
    expect(panel("n2", { run })).toContain('title="#ff6f59"');
    expect(panel("n4")).toContain("Plays the game.");
  });

  it("escapes a hostile file name (Review Focus 5)", () => {
    const hostile = "<script>alert(1)</script>" + "x".repeat(300);
    const named: Assets = { [SHA]: { ...assets[SHA], name: hostile } };
    const html = panel("n1", { graph: editAsset(starterGraph(), "n1", SHA).graph, assets: named });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("AddMenu", () => {
  const noop = () => {};

  it("has a button for every choice with its name and help", () => {
    const html = renderToString(<AddMenu choices={addChoices(starterGraph())} onPick={noop} onClose={noop} />);
    for (const name of ["Reference Image", "3D Model", "Prepare Model", "Make Shape", "Build Model", "Palette from Image", "Describe Game", "Game Template", "Preview"]) expect(html).toContain(name);
    expect(html).toContain("A model of your own, as a GLB, FBX or OBJ file.");
    expect(html.match(/role="menuitem"/g)).toHaveLength(10);
  });

  it("shows why a choice is greyed, and does not let it be clicked", () => {
    const html = renderToString(<AddMenu choices={addChoices(starterGraph())} onPick={noop} onClose={noop} />);
    expect(html).toContain("A graph has one Preview.");
    expect(html.match(/<button[^>]*disabled[^>]*role="menuitem"|<button[^>]*role="menuitem"[^>]*disabled/g)).toHaveLength(1);
  });

  it("says so when nothing fits", () => {
    expect(renderToString(<AddMenu choices={[]} onPick={noop} onClose={noop} />)).toContain("No step fits here.");
  });
});

describe("SettingsPanel for the Preview", () => {
  it("offers a download for a computer and for an Android phone, and says when it works", () => {
    const html = panel(starterGraph().nodes.find((n) => n.type === "preview")!.id);
    expect(html).toContain("Build for");
    expect(html).toContain("A computer (Windows)");
    expect(html).toContain("An Android phone");
    expect(html).toContain("Works for a game made with Describe Game");
  });
});

describe("SettingsPanel for Describe Game and a locked Game Template", () => {
  const node = (id: string, type: string, params: Record<string, unknown>) => ({ id, type, params, position: { x: 0, y: 0 } });
  const described = (prompt: string): Graph => ({
    schemaVersion: 1,
    nodes: [
      node("n1", "reference-image", { asset: null }),
      node("n2", "describe-game", { prompt }),
      node("n3", "game-template", { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }),
      node("n4", "preview", {}),
    ],
    edges: [
      { from: { node: "n1", port: "image" }, to: { node: "n2", port: "image" } },
      { from: { node: "n2", port: "palette" }, to: { node: "n3", port: "palette" } },
      { from: { node: "n2", port: "feel" }, to: { node: "n3", port: "feel" } },
      { from: { node: "n3", port: "settings" }, to: { node: "n4", port: "settings" } },
    ],
  });
  const rangeInputs = (html: string) => html.split("<input").filter((part) => part.includes('type="range"'));

  const withParams = (params: Record<string, unknown>): Graph => ({ ...described(""), nodes: described("").nodes.map((n) => (n.id === "n2" ? { ...n, params: { prompt: "", ...params } } : n)) });

  it("has a Make a game choice of Script, Rules and Off: Script for a step saved with it, Rules for an older step saved with it on, Off for one saved without it", () => {
    const script = panel("n2", { graph: withParams({ makeGame: "script" }) });
    expect(script).toContain("Make a game");
    expect(script).toMatch(/aria-pressed="true"[^>]*>Script: any game/);
    expect(script).toContain("Rules: simple, tested games");
    expect(script).toContain("Off: colors and feel");
    expect(panel("n2", { graph: withParams({ makeGame: "rules" }) })).toMatch(/aria-pressed="true"[^>]*>Rules: simple, tested games/);
    expect(panel("n2", { graph: withParams({ makeGame: true }) })).toMatch(/aria-pressed="true"[^>]*>Rules: simple, tested games/);
    expect(panel("n2", { graph: described("") })).toMatch(/aria-pressed="true"[^>]*>Off: colors and feel/);
    expect(panel("n2", { graph: withParams({ makeGame: false }) })).toMatch(/aria-pressed="true"[^>]*>Off: colors and feel/);
  });

  it("offers Try again only for a script game, and says it runs in the player and never on the servers", () => {
    const script = panel("n2", { graph: withParams({ makeGame: "script" }) });
    expect(script).toContain("Try again");
    expect(script).toContain("next time you press Play");
    expect(script).toMatch(/runs inside the player, never on our servers/);
    for (const makeGame of ["rules", "off", true, false]) expect(panel("n2", { graph: withParams({ makeGame }) })).not.toContain("Try again");
  });

  it("has a box for the prompt (at most 500 characters), holding what was typed, with the characters left", () => {
    const html = panel("n2", { graph: described("a fast neon night run") });
    expect(html).toContain("Describe Game");
    expect(html).toContain("Describe your game");
    expect(html).toMatch(/<textarea[^>]*maxLength="500"[^>]*>a fast neon night run<\/textarea>/);
    expect(html).toContain("479 characters left");
  });

  it("counts an emoji as one character", () => {
    expect(panel("n2", { graph: described("👻".repeat(100)) })).toContain("400 characters left");
  });

  it("says plainly that the description and picture go to Anthropic's Claude", () => {
    expect(panel("n2", { graph: described("") })).toContain("Your description and picture are sent to Anthropic&#x27;s Claude to make this.");
  });

  it("locks the three sliders while a feel is wired in, shows the numbers of the last run, and says who sets them", () => {
    const graph = described("a run");
    const run: RunView = { ...emptyRunView(null), outcomes: { n3: { state: "done", result: { tuning: { speed: 7, jumpHeight: 2.6, obstacleSpacing: 18 } } } } };
    const html = panel("n3", { graph, run });
    const ranges = rangeInputs(html);
    expect(ranges).toHaveLength(3);
    for (const range of ranges) expect(range).toContain('disabled=""');
    expect(html).toContain("Set by Describe Game");
    expect(html).toContain("7 m/s");
    expect(html).toContain("2.6 m");
    expect(html).toContain("18 m");
  });

  it("shows the saved numbers, still locked, before anything has run", () => {
    const html = panel("n3", { graph: described("a run") });
    expect(html).toContain("Set by Describe Game");
    expect(html).toContain("6 m/s");
  });

  it("leaves the sliders free, with no note, when no feel is wired in", () => {
    const html = panel("n3");
    const ranges = rangeInputs(html);
    expect(ranges).toHaveLength(3);
    for (const range of ranges) expect(range).not.toContain("disabled");
    expect(html).not.toContain("Set by Describe Game");
  });
});
