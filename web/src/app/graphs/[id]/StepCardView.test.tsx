import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "@/app/graphs/[id]/editor.module.css";
import { StepCardView } from "@/app/graphs/[id]/StepCardView";
import { stepData } from "@/lib/canvas/cardView";
import { applyPlay, emptyRunView, type RunView } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import { editAsset } from "@/lib/graph/edits";
import type { NodeOutcome } from "@/lib/graph/runner";
import { starterGraph } from "@/lib/graph/starter";
import type { Assets, Graph } from "@/lib/graph/types";

const SHA = "a".repeat(64);
const MODEL_SHA = "b".repeat(64);
const assets: Assets = {
  [SHA]: { name: "photo.png", size: 900, kind: "image", contentType: "image/png", width: 30, height: 20, uploadedAt: 0 },
  [MODEL_SHA]: { name: "hero.glb", size: 1536, kind: "model", contentType: "model/gltf-binary", uploadedAt: 0 },
};
const outcomes: Record<string, NodeOutcome> = {
  n1: { state: "done" },
  n2: { state: "done", result: ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"] },
  n3: { state: "done", result: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } } },
  n4: { state: "done", result: { runId: "run2" } },
  n5: { state: "not-used" },
};

function data(id: string, options: { graph?: Graph; run?: RunView; assets?: Assets; pending?: string[] } = {}) {
  const graph = options.graph ?? starterGraph();
  return stepData({
    graph,
    node: graph.nodes.find((n) => n.id === id)!,
    assets: options.assets ?? assets,
    run: options.run ?? emptyRunView(null),
    numbers: stepNumbers(graph),
    graphId: "g1",
    pending: new Set(options.pending ?? []),
  });
}

const render = (d: ReturnType<typeof data>, props: Partial<Parameters<typeof StepCardView>[0]> = {}) =>
  renderToString(<StepCardView data={d} selected={false} {...props} />);

const played = (nodes: Record<string, NodeOutcome> = outcomes): RunView =>
  applyPlay(emptyRunView(null), starterGraph(), { kind: "ran", state: "done", order: ["n1", "n2", "n3", "n4"], nodes, runId: "run2" });

describe("StepCardView", () => {
  it("shows the plain name and the one-line help", () => {
    const html = render(data("n2"));
    expect(html).toContain("Palette from Image");
    expect(html).toContain("Picks five colors from a picture.");
  });

  it("shows the running-order number only on a step that leads to the Preview", () => {
    expect(render(data("n2"))).toContain('aria-label="Step 2"');
    expect(render(data("n5"))).not.toContain('aria-label="Step ');
  });

  it("says each status in words", () => {
    expect(render(data("n2", { run: played() }))).toContain("Done");
    expect(render(data("n2", { run: played(), pending: ["n2"] }))).toContain("Running…");

    const failed = played({ ...outcomes, n2: { state: "failed", error: "Palette from Image: the picture is completely transparent" } });
    const html = render(data("n2", { run: failed }));
    expect(html).toContain('data-status="failed"');
    expect(html).toContain("Palette from Image: the picture is completely transparent");

    const skipped = played({ ...outcomes, n3: { state: "skipped", because: "Skipped because Palette from Image failed." } });
    expect(render(data("n3", { run: skipped }))).toContain("Skipped because Palette from Image failed.");
  });

  it("says what needs attention on an unfinished graph", () => {
    const run = applyPlay(emptyRunView(null), starterGraph(), { kind: "invalid", problems: [{ node: "n1", message: "Reference Image: choose a picture." }] });
    const html = render(data("n1", { run }));
    expect(html).toContain('data-status="attention"');
    expect(html).toContain("Choose a picture.");
  });

  it("marks a step that is not connected to a Preview", () => {
    const html = render(data("n5"));
    expect(html).toContain('data-status="not-used"');
    expect(html).toContain("Not connected to a Preview");
  });

  it("shows the five colors as swatches, each with its hex value as a tooltip", () => {
    const html = render(data("n2", { run: played() }));
    for (const hex of ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"]) expect(html).toContain(`title="${hex}"`);
  });

  it("shows a chosen picture with its thumbnail, and a chosen model with its size", () => {
    const withPicture = editAsset(starterGraph(), "n1", SHA).graph;
    const picture = render(data("n1", { graph: withPicture }));
    expect(picture).toContain("<img");
    expect(picture).toContain(`src="/api/graphs/g1/assets/${SHA}"`);
    expect(picture).toContain("photo.png");

    const withModel = editAsset(starterGraph(), "n5", MODEL_SHA).graph;
    const model = render(data("n5", { graph: withModel }));
    expect(model).toContain("hero.glb");
    expect(model).toContain("1.5 KB");
  });

  it("shows the settings of a Game Template, and a way to open the game on a Preview", () => {
    expect(render(data("n3", { run: played() }))).toContain("speed 6 · jump 2.2 · spacing 12");
    expect(render(data("n4", { run: played() }), { onOpenGame: () => {} })).toContain("Open game");
    expect(render(data("n4"))).not.toContain("Open game");
  });

  it("shows a delete button only while the card is selected", () => {
    expect(render(data("n2"), { selected: true, onRemove: () => {} })).toContain('aria-label="Delete Palette from Image"');
    expect(render(data("n2"), { selected: false, onRemove: () => {} })).not.toContain("Delete Palette from Image");
  });

  it("offers a + on an output with no wire, and not on one that has a wire", () => {
    expect(render(data("n5"), { onAddFrom: () => {} })).toContain('aria-label="Add a step after 3D Model"');
    expect(render(data("n2"), { onAddFrom: () => {} })).not.toContain("Add a step after Palette from Image");
    expect(render(data("n4"), { onAddFrom: () => {} })).not.toContain("Add a step after Preview"); // a Preview has no output
  });

  it("puts a handle on each port, labelled where a step has several inputs", () => {
    const stub = (port: { name: string }, side: string) => <i data-handle={`${side}:${port.name}`} />;
    const template = render(data("n3"), { renderHandle: stub });
    for (const port of ["palette", "hero", "obstacle", "collectible"]) expect(template).toContain(`data-handle="input:${port}"`);
    expect(template).toContain('data-handle="output:settings"');
    for (const label of ["hero model", "obstacle model", "collectible model"]) expect(template).toContain(label);
    expect(template).toContain("optional");

    const single = render(data("n2"), { renderHandle: stub });
    expect(single).toContain('data-handle="input:image"');
    expect(single).toContain('data-handle="output:palette"');
    expect(single).not.toContain("optional");
  });

  it("escapes a hostile file name and cuts a long one off in CSS, not in code (Review Focus 5)", () => {
    const hostile = "<script>alert(1)</script>" + "x".repeat(300);
    const named: Assets = { [SHA]: { ...assets[SHA], name: hostile } };
    const graph = editAsset(starterGraph(), "n1", SHA).graph;
    const html = render(data("n1", { graph, assets: named }));

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("x".repeat(300)); // whole, not cut in code
    expect(html).toContain(styles.fileName); // the element that truncates is used

    const css = readFileSync(new URL("./editor.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.fileName\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});
