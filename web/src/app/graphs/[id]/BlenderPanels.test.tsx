import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepCardView } from "@/app/graphs/[id]/StepCardView";
import { SettingsPanel } from "@/app/graphs/[id]/SettingsPanel";
import { stepData } from "@/lib/canvas/cardView";
import { emptyRunView, type RunView } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import type { Assets, Graph } from "@/lib/graph/types";

const MODEL_SHA = "b".repeat(64);
const assets: Assets = { [MODEL_SHA]: { name: "robot.fbx", size: 4096, kind: "model", format: "fbx", contentType: "application/octet-stream", uploadedAt: 0 } };
const tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };
const node = (id: string, type: string, params: Record<string, unknown>) => ({ id, type, params, position: { x: 0, y: 0 } });
const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

const graph = (prepare: Record<string, unknown> = { triangles: 2000, color: "original" }, shape: Record<string, unknown> = { shape: "cube", color: 4 }): Graph => ({
  schemaVersion: 1,
  nodes: [
    node("n1", "model", { asset: MODEL_SHA }),
    node("n2", "prepare-model", prepare),
    node("n3", "make-shape", shape),
    node("n4", "game-template", { tuning }),
    node("n5", "preview", {}),
  ],
  edges: [wire("n1", "model", "n2", "model"), wire("n2", "model", "n4", "hero"), wire("n3", "model", "n4", "collectible"), wire("n4", "settings", "n5", "settings")],
});

function dataFor(id: string, g: Graph, run: RunView = emptyRunView(null)) {
  return stepData({ graph: g, node: g.nodes.find((n) => n.id === id)!, assets, run, numbers: stepNumbers(g), graphId: "g1", pending: new Set() });
}

function panel(id: string, g: Graph = graph(), run?: RunView, change?: (d: ReturnType<typeof dataFor>) => ReturnType<typeof dataFor>) {
  const picked = g.nodes.find((n) => n.id === id)!;
  const data = change ? change(dataFor(id, g, run)) : dataFor(id, g, run);
  return renderToString(
    <SettingsPanel node={picked} data={data} assets={assets} graphId="g1" uploading={false} error={null} onChooseFile={() => {}} onTune={() => {}} onPrompt={() => {}} onSettings={() => {}} />,
  );
}

const buttons = (html: string, label: RegExp) => html.split("<button").slice(1).filter((part) => label.test(part));
const pressed = (part: string) => /aria-pressed="true"/.test(part);

describe("the 3D Model panel", () => {
  it("takes a GLB, FBX or OBJ, and says an FBX or OBJ needs a Prepare Model step", () => {
    const html = panel("n1");
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="\.glb,\.fbx,\.obj"/);
    expect(html).toContain("A GLB, FBX or OBJ file, up to 4 MB. An FBX or OBJ needs a Prepare Model step before the game.");
  });
});

describe("the Prepare Model panel", () => {
  it("has a number box for the triangle budget, 100 to 5000 in steps of 100, holding the saved value", () => {
    const html = panel("n2", graph({ triangles: 1500, color: "original" }));
    expect(html).toContain("Triangles");
    expect(html).toMatch(/<input[^>]*type="number"[^>]*/);
    const input = html.split("<input").find((part) => part.includes('type="number"'))!;
    expect(input).toContain('min="100"');
    expect(input).toContain('max="5000"');
    expect(input).toContain('step="100"');
    expect(input).toContain('value="1500"');
  });

  it("offers 'Keep the model's colors' (chosen by default) and five swatches of the sample palette, none chosen", () => {
    const html = panel("n2");
    const keep = buttons(html, /Keep the model&#x27;s colors/);
    expect(keep).toHaveLength(1);
    expect(pressed(keep[0])).toBe(true);

    const swatches = buttons(html, /aria-label="Swatch \d, #/);
    expect(swatches).toHaveLength(5);
    SAMPLE_PALETTE.forEach((color, i) => {
      expect(swatches[i]).toContain(`aria-label="Swatch ${i + 1}, ${color}"`);
      expect(swatches[i]).toContain(`background:${color}`);
      expect(pressed(swatches[i])).toBe(false);
    });
  });

  it("shows the chosen swatch as chosen, and the model's own colors as not", () => {
    const html = panel("n2", graph({ triangles: 2000, color: 3 }));
    const swatches = buttons(html, /aria-label="Swatch \d, #/);
    expect(swatches.map(pressed)).toEqual([false, false, true, false, false]);
    expect(pressed(buttons(html, /Keep the model&#x27;s colors/)[0])).toBe(false);
  });

  it("offers the colors of the palette wired in, once it has been made", () => {
    const palette = ["#101828", "#f97316", "#fde68a", "#34d399", "#f8fafc"];
    const g = graph();
    g.nodes.push(node("n6", "describe-game", { prompt: "a run" }));
    g.edges.push(wire("n6", "palette", "n2", "palette"));
    const run: RunView = { ...emptyRunView(null), outcomes: { n6: { state: "done", result: { palette, tuning, summary: "x", reused: false } } } };
    const swatches = buttons(panel("n2", g, run), /aria-label="Swatch \d, #/);
    expect(swatches[1]).toContain('aria-label="Swatch 2, #f97316"');
  });

  it("never puts a color that is not #rrggbb into a style: it falls back to the sample palette's", () => {
    const html = panel("n2", graph(), undefined, (d) => ({ ...d, swatches: ["red;background:url(x)", "#f97316", "#fde68a", "#34d399", "#f8fafc"] }));
    expect(html).not.toContain("url(x)");
    expect(buttons(html, /aria-label="Swatch 1, /)[0]).toContain(`Swatch 1, ${SAMPLE_PALETTE[0]}`);
  });
});

describe("the Make Shape panel", () => {
  it("has a button for each of the seven shapes by name, the saved one chosen", () => {
    const html = panel("n3", graph(undefined, { shape: "coin", color: 4 }));
    const names = ["Cube", "Sphere", "Cone", "Cylinder", "Pyramid", "Coin", "Ring"];
    const shapes = names.map((name) => buttons(html, new RegExp(`>${name}<`))[0]);
    expect(shapes.every((s) => s !== undefined)).toBe(true);
    expect(shapes.map(pressed)).toEqual([false, false, false, false, false, true, false]);
  });

  it("has the five swatches, the saved one chosen, and no way to keep the model's colors", () => {
    const html = panel("n3");
    const swatches = buttons(html, /aria-label="Swatch \d, #/);
    expect(swatches.map(pressed)).toEqual([false, false, false, true, false]);
    expect(html).not.toContain("Keep the model");
  });
});

describe("the Blender cards", () => {
  const render = (id: string, result: unknown, g: Graph = graph()) => {
    const d = { ...dataFor(id, g), result: result as ReturnType<typeof dataFor>["result"] };
    return renderToString(<StepCardView data={d} selected={false} />);
  };

  it("shows the line of facts, the color chip and, when it was stored, that it was reused", () => {
    const html = render("n2", { kind: "made", line: "9,400 triangles to 2,000, 41.0 KB, flat #ff6f59", swatch: "#ff6f59", reused: true });
    expect(html).toContain("9,400 triangles to 2,000, 41.0 KB, flat #ff6f59");
    expect(html).toContain("background:#ff6f59");
    expect(html).toContain("Reused your earlier result");
  });

  it("says nothing about reuse when the result is new, and shows no chip when the model kept its colors", () => {
    const html = render("n2", { kind: "made", line: "2,000 triangles, 41.0 KB, original colors", swatch: null, reused: false });
    expect(html).not.toContain("Reused");
    expect(html).not.toContain("background:#");
  });

  it("never puts a swatch that is not #rrggbb into a style", () => {
    const html = render("n3", { kind: "made", line: "Cube, 12 triangles, 1.0 KB", swatch: "red;background:url(x)", reused: false });
    expect(html).not.toContain("url(x)");
    expect(html).toContain("Cube, 12 triangles, 1.0 KB");
  });

  it("escapes a hostile line", () => {
    const html = render("n3", { kind: "made", line: "<script>alert(1)</script>", swatch: null, reused: false });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("has an icon of its own for each Blender step, not the default square", () => {
    const fallback = '<rect x="3" y="3" width="10" height="10" rx="2"';
    for (const id of ["n2", "n3"]) expect(render(id, { kind: "none" })).not.toContain(fallback);
    expect(render("n4", { kind: "none" })).not.toContain(fallback); // and the Game Template's is unchanged
  });
});
