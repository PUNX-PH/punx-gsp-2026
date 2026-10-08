using System;

namespace Runner.Scripting
{
    /// <summary>
    /// One thing in a script game: a position, a size, a velocity and a few flags, plus <see cref="Data"/> for whatever the script wants to keep on it.
    /// Units are game units, y is up, the field is centered on 0, 0. A destroyed object stays readable and writable (so the lines after
    /// <c>obj:destroy()</c> do not crash) but is no longer part of the world.
    /// </summary>
    public sealed class ScriptObject
    {
        readonly ScriptWorld world;

        public int Id { get; }

        /// <summary>A model or sprite name from the game's assets, or a primitive such as box or sphere.</summary>
        public string Kind;

        public double X, Y, Z;
        public double Vx, Vy, Vz;
        public double W = 1, H = 1, D = 1;

        /// <summary>The turn in degrees, advanced by <see cref="Spin"/> (degrees a second).</summary>
        public double Angle, Spin;

        /// <summary>Seconds left to live; infinite by default. The world removes the object when it runs out.</summary>
        public double Life = double.PositiveInfinity;

        public string Tag;

        /// <summary>A palette slot ("1" to "5") or "#rrggbb", as the script gave it; the view turns it into a color.</summary>
        public string Color;

        public string Animation;
        public bool Gravity;
        public bool Solid;

        /// <summary>The script's own value (a Lua table); the world never looks at it.</summary>
        public object Data;

        public bool Alive { get; private set; }

        internal bool WasInside;

        /// <summary>The Lua table that stands for this object (set by <see cref="GameApi"/>).</summary>
        internal object Handle;

        internal ScriptObject(ScriptWorld world, int id, string kind, bool alive)
        {
            this.world = world;
            Id = id;
            Kind = kind;
            Alive = alive;
        }

        /// <summary>Removes the object from the world. Safe at any time, including inside a callback, and safe to repeat.</summary>
        public void Destroy()
        {
            if (!Alive) return;
            Alive = false;
            world.NoteDestroyed();
        }

        public double Distance(ScriptObject other)
        {
            var dx = X - other.X;
            var dy = Y - other.Y;
            var dz = Z - other.Z;
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }
    }
}
