using System.Collections.Generic;

namespace Runner.Engine
{
    /// <summary>
    /// A game as data, read from the settings file's "game" key by <see cref="SpecParser"/>. It mirrors web/src/lib/engine/spec.ts: every number is an
    /// integer (positions, sizes and speeds in thousandths of a unit, times in milliseconds) and the vocabulary is closed. docs/superpowers/notes/
    /// engine-semantics.md says how each word plays.
    /// </summary>
    public sealed class EngineSpec
    {
        public long Seed;
        public string Camera;
        public long Gravity, Width, Height, Scroll;
        public readonly List<KeyValuePair<string, long>> Counters = new List<KeyValuePair<string, long>>();
        public readonly List<EntityDef> Entities = new List<EntityDef>();
        public readonly List<RuleDef> Rules = new List<RuleDef>();
        public long TimeLimitMs, ScoreToWin;
        public bool WinOnTime;
        public long RampMs, SpeedPercent, SpawnPercent;
        public readonly List<string> Palette = new List<string>();

        public EntityDef Find(string name)
        {
            foreach (var e in Entities) if (e.Name == name) return e;
            return null;
        }
    }

    public sealed class EntityDef
    {
        public string Name, Role, Model, Collider;
        public long Color, W, H, X, Y;
        public readonly List<BehaviorDef> Behaviors = new List<BehaviorDef>();

        public bool IsSpawner { get { foreach (var b in Behaviors) if (b.Type == "spawn") return true; return false; } }
        public bool Has(string type) { foreach (var b in Behaviors) if (b.Type == type) return true; return false; }
        public bool HasControl(string does) { foreach (var b in Behaviors) if (b.Type == "control" && b.Does == does) return true; return false; }
    }

    /// <summary>One behavior; only the fields of its Type are set (see the semantics note's table).</summary>
    public sealed class BehaviorDef
    {
        public string Type, Dir, Axis, Target, On, Does, Entity, Pattern;
        public long Speed, Count, SwitchMs, Amplitude, PeriodMs, Power, IntervalMs, Ms;
        public bool Ramp;
    }

    public sealed class EventDef
    {
        public string Type, A, B, Entity, Counter;
        public long EveryMs, Value;
    }

    public sealed class CondDef
    {
        public string Counter, Op;
        public long Value;
    }

    public sealed class ActionDef
    {
        public string Type, Counter, Target, Entity;
        public long N, Percent;
    }

    public sealed class RuleDef
    {
        public EventDef On;
        public List<CondDef> When;
        public List<ActionDef> Do = new List<ActionDef>();
    }

    /// <summary>The engine's caps and word lists (the same as web/src/lib/engine/spec.ts and fields.ts).</summary>
    public static class EngineVocab
    {
        public const int Entities = 12, Rules = 40, Counters = 9, LiveObjects = 150, SpawnsPerSecond = 10, ActionsPerStep = 200, SpecBytes = 65536;
        public const long CounterLimit = 1000000;

        public static readonly string[] Cameras = { "side", "top", "behind" };
        public static readonly string[] Roles = { "hero", "hazard", "pickup", "platform", "projectile" };
        public static readonly string[] Primitives = { "box", "sphere", "capsule", "cylinder" };
        public static readonly string[] Colliders = { "box", "circle" };
    }
}
