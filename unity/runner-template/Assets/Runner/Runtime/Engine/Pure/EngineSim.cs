using System;
using System.Collections.Generic;

namespace Runner.Engine
{
    public struct SimInput
    {
        /// <summary>The input was newly pressed this step.</summary>
        public bool Tap;
        /// <summary>The input is held this step.</summary>
        public bool Hold;
    }

    public enum Status { Running, Won, Lost }

    /// <summary>The engine's only random source: xorshift32 on uint32 (web/src/lib/engine/rng.ts).</summary>
    public sealed class Xorshift32
    {
        uint x;
        public Xorshift32(long seed) { x = (uint)seed; if (x == 0) x = 1; }
        public long Next()
        {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            return x;
        }
    }

    /// <summary>A live object: the hero, a spawner (never drawn or hit), a static object, or something a spawner or a rule made.</summary>
    public sealed class Obj
    {
        public int Id;
        public EntityDef Def;
        public long X, Y, Vx, Vy, W, H;
        public bool Alive = true, Spawner, Exited;
        public long Birth, BaseX, BaseY, NextSpawn;
        public int GravSign = 1, Lane, LaneDir = 1, Cooldown;
        public bool Switching;
        public long SwFrom, SwTo, SwK, SwN;
        public string Type => Def.Name;
    }

    /// <summary>What the rules phase reads: an event, the objects it concerns, and (for tick and counterReaches) the one rule it is for.</summary>
    public sealed class Raised
    {
        public EventDef Event;
        public Obj A, B, Self;
        public int Rule = -1;
    }

    public sealed class SimEntityState
    {
        public int Id;
        public string Type;
        public long X, Y, Vx, Vy;
    }

    public sealed class SimState
    {
        public long Step;
        public Status Status;
        public SortedDictionary<string, long> Counters = new SortedDictionary<string, long>(StringComparer.Ordinal);
        public List<SimEntityState> Entities = new List<SimEntityState>();
    }

    /// <summary>
    /// The engine: the semantics in docs/superpowers/notes/engine-semantics.md, run in integers. A line-for-line port of web/src/lib/engine/sim.ts, so
    /// that the shared fixtures give equal state digests on both sides. Pure C#, no Unity types, so it also runs headlessly in the fixture check.
    /// </summary>
    public sealed class Engine
    {
        public readonly EngineSpec Spec;
        public long Step;
        public Status Status = Status.Running;
        public readonly Dictionary<string, long> Counters = new Dictionary<string, long>();
        public List<Obj> Objs = new List<Obj>();
        public List<Raised> Queue = new List<Raised>();
        public long SpeedUpTotal;
        public readonly bool[] Reached;
        public int Actions;

        int nextId = 1;
        readonly Xorshift32 rng;
        bool prevHold;
        List<long> spawnSteps = new List<long>();
        readonly HashSet<int> thrustingIds = new HashSet<int>();
        readonly string firstProjectile;

        public static long ToSteps(long ms) => Math.Max(1, (ms * 60 + 500) / 1000);

        public Engine(EngineSpec spec)
        {
            Spec = spec;
            foreach (var kv in spec.Counters) Counters[kv.Key] = kv.Value;
            rng = new Xorshift32(spec.Seed);
            Reached = new bool[spec.Rules.Count];
            var targets = new HashSet<string>();
            foreach (var e in spec.Entities) foreach (var b in e.Behaviors) if (b.Type == "spawn") targets.Add(b.Entity);
            foreach (var r in spec.Rules) foreach (var a in r.Do) if (a.Type == "spawn") targets.Add(a.Entity);
            foreach (var e in spec.Entities) if (e.Role == "projectile") { firstProjectile = e.Name; break; }
            if (firstProjectile != null) targets.Add(firstProjectile);
            foreach (var e in spec.Entities) if (e.Role == "hero" || !targets.Contains(e.Name)) Objs.Add(Make(e, e.X, e.Y, 0, 0, false, 0));
        }

        public Obj Hero()
        {
            foreach (var o in Objs) if (o.Def.Role == "hero") return o;
            return null;
        }

        static bool HasControl(Obj o, string does) => o.Def.HasControl(does);

        static long Scaled(long speed, long pct) => speed * (100 + pct) / 100;

        bool LaneOnX => Spec.Camera != "side";
        long LaneSpan => Spec.Camera == "side" ? Spec.Height : Spec.Width;
        long LaneCoord(long i, long count, long size) => LaneSpan * (2 * i + 1) / (2 * count) - size / 2;

        public Obj Make(EntityDef e, long x, long y, long birth, long speedOverride, bool ramped, long pct)
        {
            var o = new Obj { Id = nextId++, Def = e, X = x, Y = y, W = e.W, H = e.H, Spawner = e.IsSpawner, Birth = birth, BaseX = x, BaseY = y };
            var speedPct = ramped || speedOverride >= 0 ? pct : 0;
            foreach (var b in e.Behaviors)
            {
                if (b.Type == "move")
                {
                    var v = speedOverride > 0 ? Scaled(speedOverride, speedPct) : Scaled(b.Speed, speedPct);
                    if (b.Dir == "left") o.Vx = -v;
                    else if (b.Dir == "right") o.Vx = v;
                    else if (b.Dir == "up") o.Vy = v;
                    else o.Vy = -v;
                }
                else if (b.Type == "fall") o.Vy = -(speedOverride > 0 ? Scaled(speedOverride, speedPct) : Scaled(b.Speed, speedPct));
                else if (b.Type == "lane")
                {
                    o.Lane = (int)(b.Count >> 1);
                    var c = LaneCoord(o.Lane, b.Count, LaneOnX ? e.W : e.H);
                    if (LaneOnX) { o.X = c; o.BaseX = c; } else { o.Y = c; o.BaseY = c; }
                }
                else if (b.Type == "spawn") o.NextSpawn = birth + ToSteps(b.IntervalMs);
            }
            return o;
        }

        long RampPercent(long percent)
        {
            var ramp = ToSteps(Spec.RampMs);
            return Spec.RampMs == 0 ? 0 : Math.Min(Step, ramp) * percent / ramp;
        }

        public void Raise(Raised r) { Queue.Add(r); }

        public void CheckReaches()
        {
            for (var i = 0; i < Spec.Rules.Count; i++)
            {
                var on = Spec.Rules[i].On;
                if (on.Type != "counterReaches") continue;
                var now = Counters[on.Counter] >= on.Value;
                if (now && !Reached[i]) { Reached[i] = true; Raise(new Raised { Event = on, Rule = i }); }
                else if (!now) Reached[i] = false;
            }
        }

        public void SpawnAction(string type)
        {
            if (Live() >= EngineVocab.LiveObjects) return;
            var e = Spec.Find(type);
            Objs.Add(Make(e, e.X, e.Y, Step, 0, false, 0));
        }

        public int Live()
        {
            var n = 0;
            foreach (var o in Objs) if (o.Alive && !o.Spawner) n++;
            return n;
        }

        public void End(Status status) { if (Status == Status.Running) Status = status; }

        public void Run(SimInput input)
        {
            if (Status != Status.Running) return;
            Step++;
            Queue = new List<Raised>();
            Actions = 0;
            PhaseInput(input);
            PhaseControls(input);
            PhaseMoves();
            PhaseSpawns();
            PhaseCollisions();
            RuleEngine.Run(this);
            PhaseCleanup();
            PhaseEnds();
        }

        void PhaseInput(SimInput input)
        {
            if (Counters.ContainsKey("time")) Counters["time"] = Step / 60;
            if (Step == 1) Raise(new Raised { Event = new EventDef { Type = "start" } });
            if (input.Tap) Raise(new Raised { Event = new EventDef { Type = "tap" } });
            if (input.Hold) Raise(new Raised { Event = new EventDef { Type = "hold" } });
            if (prevHold && !input.Hold) Raise(new Raised { Event = new EventDef { Type = "release" } });
            prevHold = input.Hold;
            for (var i = 0; i < Spec.Rules.Count; i++)
            {
                var on = Spec.Rules[i].On;
                if (on.Type == "tick" && Step % ToSteps(on.EveryMs) == 0) Raise(new Raised { Event = on, Rule = i });
            }
        }

        void PhaseControls(SimInput input)
        {
            thrustingIds.Clear();
            foreach (var o in Objs.ToArray())
            {
                if (!o.Alive || o.Spawner) continue;
                if (o.Cooldown > 0) o.Cooldown--;
                foreach (var b in o.Def.Behaviors)
                {
                    if (b.Type != "control") continue;
                    var on = b.On == "tap" ? input.Tap : input.Hold;
                    if (!on) continue;
                    if (b.Does == "jump") { if (o.Y <= o.Def.Y && o.Vy <= 0) o.Vy = b.Power; }
                    else if (b.Does == "flap") o.Vy = b.Power;
                    else if (b.Does == "flip") o.GravSign = o.GravSign == 1 ? -1 : 1;
                    else if (b.Does == "thrust") thrustingIds.Add(o.Id);
                    else if (b.Does == "fire")
                    {
                        if (o.Cooldown == 0 && firstProjectile != null && Live() < EngineVocab.LiveObjects)
                        {
                            var p = Make(Spec.Find(firstProjectile), o.X, o.Y, Step, 0, false, 0);
                            if (b.Power != 0) p.Vy = b.Power;
                            Objs.Add(p);
                            o.Cooldown = 10;
                        }
                    }
                    else if (b.Does == "switchLane")
                    {
                        BehaviorDef lane = null;
                        foreach (var x in o.Def.Behaviors) if (x.Type == "lane") { lane = x; break; }
                        if (lane != null && !o.Switching)
                        {
                            if (o.Lane == 0) o.LaneDir = 1;
                            else if (o.Lane == lane.Count - 1) o.LaneDir = -1;
                            var target = o.Lane + o.LaneDir;
                            var size = LaneOnX ? o.W : o.H;
                            o.Switching = true;
                            o.SwFrom = LaneOnX ? o.X : o.Y;
                            o.SwTo = LaneCoord(target, lane.Count, size);
                            o.SwK = 0;
                            o.SwN = ToSteps(lane.SwitchMs);
                        }
                    }
                }
            }
        }

        void PhaseMoves()
        {
            var scroll = Spec.Scroll / 60;
            foreach (var o in Objs)
            {
                if (!o.Alive || o.Spawner) continue;
                var e = o.Def;
                var heavy = HasControl(o, "jump") || HasControl(o, "flap") || HasControl(o, "flip") || HasControl(o, "thrust");
                if (heavy)
                {
                    if (thrustingIds.Contains(o.Id))
                    {
                        BehaviorDef t = null;
                        foreach (var b in e.Behaviors) if (b.Type == "control" && b.Does == "thrust") { t = b; break; }
                        o.Vy += t != null ? t.Power / 60 : 0;
                    }
                    else o.Vy -= Spec.Gravity / 60 * o.GravSign;
                }
                foreach (var b in e.Behaviors)
                {
                    if (b.Type != "follow") continue;
                    Obj best = null;
                    var bestD = long.MaxValue;
                    foreach (var t in Objs)
                    {
                        if (!t.Alive || t.Type != b.Target) continue;
                        var d = Math.Abs(t.X - o.X) + Math.Abs(t.Y - o.Y);
                        if (d < bestD) { best = t; bestD = d; }
                    }
                    if (best != null)
                    {
                        var step = b.Speed / 60;
                        o.X += Math.Sign(best.X - o.X) * Math.Min(step, Math.Abs(best.X - o.X));
                        o.Y += Math.Sign(best.Y - o.Y) * Math.Min(step, Math.Abs(best.Y - o.Y));
                    }
                }
                o.X += o.Vx / 60;
                o.Y += o.Vy / 60;
                if (e.Role == "platform" || e.Role == "hazard" || e.Role == "pickup")
                {
                    if (Spec.Camera == "side") o.X -= scroll; else o.Y -= scroll;
                }
                if (HasControl(o, "jump") && o.Y <= e.Y && o.Vy <= 0) { o.Y = e.Y; o.Vy = 0; }
                foreach (var b in e.Behaviors)
                {
                    if (b.Type != "oscillate") continue;
                    var P = ToSteps(b.PeriodMs);
                    var h = 4 * ((Step - o.Birth) % P);
                    var A = b.Amplitude;
                    var offset = h <= P ? A * h / P : h <= 3 * P ? A * (2 * P - h) / P : A * (h - 4 * P) / P;
                    if (b.Axis == "x") o.X = o.BaseX + offset; else o.Y = o.BaseY + offset;
                }
                if (o.Switching)
                {
                    o.SwK++;
                    var pos = o.SwFrom + (o.SwTo - o.SwFrom) * o.SwK / o.SwN;
                    if (LaneOnX) o.X = pos; else o.Y = pos;
                    if (o.SwK >= o.SwN) { o.Lane += o.LaneDir; o.Switching = false; }
                }
            }
        }

        void PhaseSpawns()
        {
            spawnSteps = spawnSteps.FindAll(s => s > Step - 60);
            foreach (var o in Objs.ToArray())
            {
                if (!o.Alive || !o.Spawner || Step < o.NextSpawn) continue;
                BehaviorDef b = null;
                foreach (var bb in o.Def.Behaviors) if (bb.Type == "spawn") { b = bb; break; }
                if (b == null) continue;
                var sp = b.Ramp ? RampPercent(Spec.SpeedPercent) : 0;
                var pct = Math.Min(300, sp + SpeedUpTotal);
                var shrink = b.Ramp ? RampPercent(Spec.SpawnPercent) : 0;
                o.NextSpawn = Step + Math.Max(1, ToSteps(b.IntervalMs) * (100 - shrink) / 100);
                if (Live() >= EngineVocab.LiveObjects || spawnSteps.Count >= EngineVocab.SpawnsPerSecond) continue;
                var t = Spec.Find(b.Entity);
                var side = Spec.Camera == "side";
                var span = side ? Spec.Height : Spec.Width;
                long x, y;
                if (b.Pattern == "stream") { x = o.X; y = o.Y; }
                else if (b.Pattern == "rain")
                {
                    y = Spec.Height;
                    x = Spec.Width - t.W < 0 ? 0 : rng.Next() % (Spec.Width - t.W + 1);
                }
                else
                {
                    var size = side ? t.H : t.W;
                    long pos;
                    if (b.Pattern == "random") pos = span - size < 0 ? 0 : rng.Next() % (span - size + 1);
                    else if (b.Pattern == "wave")
                    {
                        var ph = Step % 120;
                        var v = ph <= 60 ? ph : 120 - ph;
                        pos = Math.Max(0, span - size) * v / 60;
                    }
                    else
                    {
                        long count = 3;
                        var hero = Hero();
                        foreach (var q in hero.Def.Behaviors) if (q.Type == "lane") { count = q.Count; break; }
                        pos = LaneCoord(rng.Next() % count, count, size);
                    }
                    if (side) { x = Spec.Width; y = pos; } else { x = pos; y = Spec.Height; }
                }
                Objs.Add(Make(t, x, y, Step, b.Speed, b.Ramp, pct));
                spawnSteps.Add(Step);
            }
        }

        void PhaseCollisions()
        {
            var list = new List<Obj>();
            foreach (var o in Objs) if (o.Alive && !o.Spawner) list.Add(o);
            for (var i = 0; i < list.Count; i++)
                for (var j = i + 1; j < list.Count; j++)
                    if (Collide.Overlap(list[i].Def.Collider, list[i], list[j].Def.Collider, list[j]))
                        Raise(new Raised { Event = new EventDef { Type = "collide", A = list[i].Type, B = list[j].Type }, A = list[i], B = list[j] });
            foreach (var o in list)
            {
                if (o.Exited || o.Def.Role == "hero") continue;
                if (o.X + o.W < 0 || o.X > Spec.Width || o.Y + o.H < 0 || o.Y > Spec.Height)
                {
                    o.Exited = true;
                    Raise(new Raised { Event = new EventDef { Type = "exitBounds", Entity = o.Type }, Self = o });
                }
            }
        }

        void PhaseCleanup()
        {
            foreach (var o in Objs)
            {
                if (!o.Alive || o.Spawner) continue;
                foreach (var b in o.Def.Behaviors)
                {
                    if (b.Type != "lifetime") continue;
                    if (Step - o.Birth >= ToSteps(b.Ms)) o.Alive = false;
                    break;
                }
                if (o.Def.Role != "hero" && (o.X + o.W < -o.W || o.X > Spec.Width + o.W || o.Y + o.H < -o.H || o.Y > Spec.Height + o.H)) o.Alive = false;
            }
            Objs = Objs.FindAll(o => o.Alive);
        }

        void PhaseEnds()
        {
            if (Status != Status.Running) return;
            if (Hero() == null) End(Status.Lost);
            else if (Counters.TryGetValue("lives", out var lives) && lives <= 0) End(Status.Lost);
            else if (Spec.ScoreToWin > 0 && Counters.TryGetValue("score", out var score) && score >= Spec.ScoreToWin) End(Status.Won);
            else if (Spec.TimeLimitMs > 0 && Step >= ToSteps(Spec.TimeLimitMs)) End(Spec.WinOnTime ? Status.Won : Status.Lost);
        }

        public SimState Snapshot()
        {
            var s = new SimState { Step = Step, Status = Status };
            foreach (var kv in Counters) s.Counters[kv.Key] = kv.Value;
            foreach (var o in Objs)
                if (o.Alive && !o.Spawner) s.Entities.Add(new SimEntityState { Id = o.Id, Type = o.Type, X = o.X, Y = o.Y, Vx = o.Vx, Vy = o.Vy });
            return s;
        }
    }
}
