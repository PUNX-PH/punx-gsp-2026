// Overlap tests, in integers. Box against box is by closed intervals; a circle has the diameter of the smaller side, centered in its box; two
// circles overlap when the distance between centers is at most the sum of the radii; a mixed pair uses the circle's bounding box.
interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
}

const side = (b: Body): number => Math.min(b.w, b.h);

/** The box a circle fills: `side` wide, centered in its entity box (rounded toward the lower left). */
function circleBox(b: Body): Body {
  const d = side(b);
  return { x: b.x + Math.trunc((b.w - d) / 2), y: b.y + Math.trunc((b.h - d) / 2), w: d, h: d };
}

const boxes = (a: Body, b: Body): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export function collides(ka: "box" | "circle", a: Body, kb: "box" | "circle", b: Body): boolean {
  if (ka === "circle" && kb === "circle") {
    const dx2 = 2 * a.x + a.w - (2 * b.x + b.w);
    const dy2 = 2 * a.y + a.h - (2 * b.y + b.h);
    const r2 = side(a) + side(b);
    return dx2 * dx2 + dy2 * dy2 <= r2 * r2;
  }
  return boxes(ka === "circle" ? circleBox(a) : a, kb === "circle" ? circleBox(b) : b);
}
