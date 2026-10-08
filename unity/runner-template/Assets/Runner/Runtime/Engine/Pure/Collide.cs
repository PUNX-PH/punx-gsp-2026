using System;

namespace Runner.Engine
{
    /// <summary>
    /// Overlap tests in integers (web/src/lib/engine/collide.ts). Box against box is by closed intervals; a circle has the diameter of the smaller
    /// side, centered in its box; two circles overlap when the distance between centers is at most the sum of the radii; a mixed pair uses the
    /// bounding box of the circle.
    /// </summary>
    public static class Collide
    {
        static long Side(Obj b) => Math.Min(b.W, b.H);

        static void CircleBox(Obj b, out long x, out long y, out long w, out long h)
        {
            var d = Side(b);
            x = b.X + (b.W - d) / 2;
            y = b.Y + (b.H - d) / 2;
            w = d;
            h = d;
        }

        public static bool Overlap(string ka, Obj a, string kb, Obj b)
        {
            if (ka == "circle" && kb == "circle")
            {
                var dx2 = 2 * a.X + a.W - (2 * b.X + b.W);
                var dy2 = 2 * a.Y + a.H - (2 * b.Y + b.H);
                var r2 = Side(a) + Side(b);
                return dx2 * dx2 + dy2 * dy2 <= r2 * r2;
            }
            long ax = a.X, ay = a.Y, aw = a.W, ah = a.H, bx = b.X, by = b.Y, bw = b.W, bh = b.H;
            if (ka == "circle") CircleBox(a, out ax, out ay, out aw, out ah);
            if (kb == "circle") CircleBox(b, out bx, out by, out bw, out bh);
            return ax <= bx + bw && bx <= ax + aw && ay <= by + bh && by <= ay + ah;
        }
    }
}
