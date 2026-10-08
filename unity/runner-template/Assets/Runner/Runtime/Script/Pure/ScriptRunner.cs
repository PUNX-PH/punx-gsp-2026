using System;
using System.Collections.Generic;
using System.Diagnostics;
using MoonSharp.Interpreter;

namespace Runner.Scripting
{
    /// <summary>Where the pointer (finger or mouse) is, in field units, and whether it is down.</summary>
    public readonly struct PointerState
    {
        public readonly double X;
        public readonly double Y;
        public readonly bool Down;

        public PointerState(double x, double y, bool down)
        {
            X = x;
            Y = y;
            Down = down;
        }
    }

    /// <summary>
    /// Plays one game script: loads it, calls <c>init</c>, and every <see cref="Step"/> runs <c>update</c>, the input callbacks, the world's physics, then
    /// <c>on_collide</c>, the timers and <c>on_exit</c>, in that order. The first error (a Lua error, a script over its instruction budget, too much
    /// memory, or frames that stay too slow) stops the game and is kept in <see cref="Error"/> as one sentence for the player. Pure C#, no Unity types.
    /// </summary>
    public sealed class ScriptRunner
    {
        public const double MaxDt = 0.1;
        public const double SlowFrameSeconds = 0.25;
        public const int SlowFramesInARow = 3;

        readonly string source;
        readonly Func<double> clock;
        readonly List<WorldEvent> events = new List<WorldEvent>();
        PointerState previous;
        bool started;
        int slowFrames;

        public ScriptHost Host { get; }
        public ScriptWorld World { get; }
        public GameApi Api { get; }

        /// <summary>Why the game stopped, or null while it runs.</summary>
        public string Error { get; private set; }

        public bool Failed => Error != null;
        public bool Over => Api.Over;

        /// <param name="clock">Seconds from any starting point; the frame-time check reads it before and after each step. Defaults to the system's stopwatch.</param>
        public ScriptRunner(string source, uint seed = 1, Func<double> clock = null)
        {
            this.source = source ?? "";
            this.clock = clock ?? DefaultClock();
            Host = new ScriptHost();
            World = new ScriptWorld();
            Api = new GameApi(Host, World, seed);
        }

        static Func<double> DefaultClock()
        {
            var watch = Stopwatch.StartNew();
            return () => watch.Elapsed.TotalSeconds;
        }

        /// <summary>Runs the script's top level and <c>init</c>. False when the game could not start; <see cref="Error"/> says why.</summary>
        public bool Start()
        {
            if (started) return !Failed;
            started = true;
            Api.SyncIn();
            if (!Host.Load(source, out var error)) return Fail(error);
            if (!Sync()) return false;
            return CallIt("init");
        }

        /// <summary>Plays one frame. Returns false once the game has failed; a game that has been won or lost returns true and does nothing more.</summary>
        public bool Step(double dt, PointerState pointer)
        {
            if (!started && !Start()) return false;
            if (Failed) return false;
            if (Over) return true;
            if (double.IsNaN(dt) || dt < 0) dt = 0;
            if (dt > MaxDt) dt = MaxDt;

            var began = clock();
            var pressed = pointer.Down && !previous.Down;
            var released = !pointer.Down && previous.Down;
            var dx = pointer.X - previous.X;
            var dy = pointer.Y - previous.Y;
            Api.SetInput(pointer.X, pointer.Y, pointer.Down, dx, dy);
            previous = pointer;

            Api.SyncIn();
            if (!CallIt("update", dt)) return false;
            if (Over) return true;
            if (pressed && !CallIt("on_tap", pointer.X, pointer.Y)) return false;
            if (pointer.Down && !CallIt("on_hold", pointer.X, pointer.Y)) return false;
            if (pointer.Down && !pressed && (dx != 0 || dy != 0) && !CallIt("on_drag", pointer.X, pointer.Y, dx, dy)) return false;
            if (released && !CallIt("on_release", pointer.X, pointer.Y)) return false;
            if (Over) return true;

            events.Clear();
            World.Step(dt, events);
            Api.SyncIn();

            foreach (var e in events)
            {
                if (e.Kind != WorldEventKind.Collide || !e.A.Alive || !e.B.Alive) continue;
                if (!Host.Has("on_collide")) break;
                if (!CallIt("on_collide", Api.HandleFor(e.A), Api.HandleFor(e.B))) return false;
                if (Over) return true;
            }

            foreach (var timer in Api.TakeDueTimers(World.Time))
            {
                if (timer.Cancelled) continue;
                if (!Host.Invoke(timer.Function, out var timerError)) return Fail(timerError);
                if (!Sync()) return false;
                if (Over) return true;
            }

            foreach (var e in events)
            {
                if (e.Kind != WorldEventKind.Exit || !e.A.Alive) continue;
                if (!Host.Has("on_exit")) break;
                if (!CallIt("on_exit", Api.HandleFor(e.A))) return false;
                if (Over) return true;
            }

            slowFrames = clock() - began > SlowFrameSeconds ? slowFrames + 1 : 0;
            if (slowFrames >= SlowFramesInARow) return Fail("The game ran too slowly (over 250 ms a frame, three frames in a row) and was stopped.");
            return true;
        }

        bool CallIt(string name, params object[] args)
        {
            if (!Host.Has(name)) return true;
            if (!Host.Call(name, out var error, args)) return Fail(error);
            return Sync();
        }

        bool Sync()
        {
            if (Api.SyncOut(out var error)) return true;
            return Fail(error);
        }

        bool Fail(string message)
        {
            Error = message ?? "The game stopped.";
            return false;
        }
    }
}
