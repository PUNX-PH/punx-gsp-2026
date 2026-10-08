using System;
using System.Collections.Generic;

namespace Runner.Scripting
{
    public enum WorldEventKind
    {
        /// <summary>Two solid objects began to overlap (A was spawned before B).</summary>
        Collide,

        /// <summary>A left the field, having been inside it.</summary>
        Exit,
    }

    /// <summary>Something that happened in a step. The runner turns each into a script callback, skipping any whose objects are no longer alive.</summary>
    public readonly struct WorldEvent
    {
        public readonly WorldEventKind Kind;
        public readonly ScriptObject A;
        public readonly ScriptObject B;

        public WorldEvent(WorldEventKind kind, ScriptObject a, ScriptObject b)
        {
            Kind = kind;
            A = a;
            B = b;
        }
    }

    /// <summary>
    /// The objects of a script game and their light physics: velocity and gravity, spin, a life span, overlap between solid objects (boxes, and circles
    /// for spheres, in x and y) and leaving the field. The field is centered on 0, 0. It calls no script code: a step fills a list of events and the
    /// runner turns them into callbacks, so a callback may spawn or destroy anything. Pure C#, no Unity types.
    /// </summary>
    public sealed class ScriptWorld
    {
        public const int MaxObjects = 300;
        public const int MaxSpawnsPerSecond = 120;

        readonly List<ScriptObject> objects = new List<ScriptObject>();
        HashSet<long> overlapping = new HashSet<long>();
        HashSet<long> overlappingNow = new HashSet<long>();
        int live;
        int nextId = 1;
        double spawnWindowStart;
        int spawnsInWindow;

        /// <summary>Downward pull in units a second squared for objects with <see cref="ScriptObject.Gravity"/>.</summary>
        public double Gravity = 20;

        public double Width { get; private set; } = 9;
        public double Height { get; private set; } = 16;

        /// <summary>Seconds simulated so far.</summary>
        public double Time { get; private set; }

        /// <summary>Spawns refused because of the object cap or the spawn rate; a count for the developer log.</summary>
        public int DroppedSpawns { get; private set; }

        /// <summary>The objects in spawn order. Includes any destroyed since the last step: check <see cref="ScriptObject.Alive"/>.</summary>
        public IReadOnlyList<ScriptObject> Objects => objects;

        public int Count() => live;

        public int Count(string tag)
        {
            if (tag == null) return 0;
            var n = 0;
            for (var i = 0; i < objects.Count; i++)
                if (objects[i].Alive && objects[i].Tag == tag) n++;
            return n;
        }

        public List<ScriptObject> Find(string tag)
        {
            var found = new List<ScriptObject>();
            if (tag == null) return found;
            for (var i = 0; i < objects.Count; i++)
                if (objects[i].Alive && objects[i].Tag == tag) found.Add(objects[i]);
            return found;
        }

        public bool SetBounds(double width, double height)
        {
            if (!IsUsable(width) || !IsUsable(height) || width <= 0 || height <= 0) return false;
            Width = width;
            Height = height;
            return true;
        }

        /// <summary>
        /// Makes an object. Past the cap on live objects or on spawns in a second it returns a dead stand-in (not in the world, writes do nothing) and
        /// counts the drop, so the script's next lines do not fail.
        /// </summary>
        public ScriptObject Spawn(string kind)
        {
            if (Time - spawnWindowStart >= 1.0)
            {
                spawnWindowStart = Time;
                spawnsInWindow = 0;
            }
            if (live >= MaxObjects || spawnsInWindow >= MaxSpawnsPerSecond)
            {
                DroppedSpawns++;
                return new ScriptObject(this, 0, kind, false);
            }
            if (objects.Count >= MaxObjects * 2) Compact();
            spawnsInWindow++;
            var o = new ScriptObject(this, nextId++, kind, true);
            objects.Add(o);
            live++;
            return o;
        }

        public void Clear()
        {
            for (var i = 0; i < objects.Count; i++) objects[i].Destroy();
            Compact();
            overlapping.Clear();
        }

        internal void NoteDestroyed() => live--;

        /// <summary>Moves everything on by dt seconds and appends what happened (collisions, then exits) to <paramref name="events"/>.</summary>
        public void Step(double dt, List<WorldEvent> events)
        {
            Time += dt;
            for (var i = 0; i < objects.Count; i++)
            {
                var o = objects[i];
                if (!o.Alive) continue;
                Sanitize(o);
                if (o.Gravity) o.Vy -= Gravity * dt;
                o.X += o.Vx * dt;
                o.Y += o.Vy * dt;
                o.Z += o.Vz * dt;
                o.Angle += o.Spin * dt;
                if (!double.IsPositiveInfinity(o.Life))
                {
                    o.Life -= dt;
                    if (o.Life <= 0) o.Destroy();
                }
            }

            Collisions(events);
            Exits(events);
            Compact();
        }

        void Collisions(List<WorldEvent> events)
        {
            overlappingNow.Clear();
            for (var i = 0; i < objects.Count; i++)
            {
                var a = objects[i];
                if (!a.Alive || !a.Solid) continue;
                for (var j = i + 1; j < objects.Count; j++)
                {
                    var b = objects[j];
                    if (!b.Alive || !b.Solid || !Overlap(a, b)) continue;
                    var key = ((long)a.Id << 32) | (uint)b.Id;
                    overlappingNow.Add(key);
                    if (!overlapping.Contains(key)) events.Add(new WorldEvent(WorldEventKind.Collide, a, b));
                }
            }
            var swap = overlapping;
            overlapping = overlappingNow;
            overlappingNow = swap;
        }

        void Exits(List<WorldEvent> events)
        {
            var halfW = Width / 2;
            var halfH = Height / 2;
            for (var i = 0; i < objects.Count; i++)
            {
                var o = objects[i];
                if (!o.Alive) continue;
                var outside = o.X - o.W / 2 > halfW || o.X + o.W / 2 < -halfW || o.Y - o.H / 2 > halfH || o.Y + o.H / 2 < -halfH;
                if (!outside) o.WasInside = true;
                else if (o.WasInside)
                {
                    o.WasInside = false;
                    events.Add(new WorldEvent(WorldEventKind.Exit, o, null));
                }
            }
        }

        static bool Overlap(ScriptObject a, ScriptObject b)
        {
            var circleA = a.Kind == "sphere";
            var circleB = b.Kind == "sphere";
            if (circleA && circleB)
            {
                var dx = a.X - b.X;
                var dy = a.Y - b.Y;
                var r = Math.Min(a.W, a.H) / 2 + Math.Min(b.W, b.H) / 2;
                return dx * dx + dy * dy <= r * r;
            }
            return Math.Abs(a.X - b.X) <= (a.W + b.W) / 2 && Math.Abs(a.Y - b.Y) <= (a.H + b.H) / 2;
        }

        static bool IsUsable(double v) => !double.IsNaN(v) && !double.IsInfinity(v);

        static double Clean(double v) => IsUsable(v) ? v : 0;

        static void Sanitize(ScriptObject o)
        {
            o.X = Clean(o.X);
            o.Y = Clean(o.Y);
            o.Z = Clean(o.Z);
            o.Vx = Clean(o.Vx);
            o.Vy = Clean(o.Vy);
            o.Vz = Clean(o.Vz);
            o.W = Clean(o.W);
            o.H = Clean(o.H);
            o.D = Clean(o.D);
            o.Angle = Clean(o.Angle);
            o.Spin = Clean(o.Spin);
            if (double.IsNaN(o.Life)) o.Life = double.PositiveInfinity;
        }

        void Compact()
        {
            objects.RemoveAll(o => !o.Alive);
        }
    }
}
