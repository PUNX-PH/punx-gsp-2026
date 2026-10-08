using System.Collections.Generic;
using System.Text;

namespace Runner.Engine
{
    /// <summary>Which steps a tap began on and which ranges of steps the input was held (web/src/lib/engine/log.ts).</summary>
    public sealed class InputLog
    {
        public long Steps;
        public readonly List<long> Taps = new List<long>();
        public readonly List<KeyValuePair<long, long>> Holds = new List<KeyValuePair<long, long>>();

        public SimInput At(long step)
        {
            var hold = false;
            foreach (var h in Holds) if (step >= h.Key && step <= h.Value) hold = true;
            return new SimInput { Tap = Taps.Contains(step), Hold = hold };
        }

        public static bool TryParse(string text, out InputLog log)
        {
            log = null;
            if (!MiniJson.TryParse(text, out var root, out _) || !(root is JsonObject o)) return false;
            log = new InputLog { Steps = (long)(double)o.Get("steps") };
            foreach (var t in (List<object>)o.Get("taps")) log.Taps.Add((long)(double)t);
            foreach (var h in (List<object>)o.Get("holds"))
            {
                var pair = (List<object>)h;
                log.Holds.Add(new KeyValuePair<long, long>((long)(double)pair[0], (long)(double)pair[1]));
            }
            return true;
        }
    }

    /// <summary>The state digest and the replay the shared fixtures are compared by: a stable text of the integers in a state.</summary>
    public static class Digest
    {
        public const int CheckpointEvery = 60;

        public static string Of(SimState s)
        {
            var sb = new StringBuilder();
            sb.Append("step=").Append(s.Step).Append(";status=").Append(s.Status == Status.Running ? "running" : s.Status == Status.Won ? "won" : "lost").Append(";c=");
            var first = true;
            foreach (var kv in s.Counters)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append(kv.Key).Append('=').Append(kv.Value);
            }
            sb.Append(";e=");
            first = true;
            foreach (var e in s.Entities)
            {
                if (!first) sb.Append('|');
                first = false;
                sb.Append(e.Id).Append(':').Append(e.Type).Append(':').Append(e.X).Append(':').Append(e.Y).Append(':').Append(e.Vx).Append(':').Append(e.Vy);
            }
            return sb.ToString();
        }

        /// <summary>The state at steps 0, 60, 120, ... up to the log's length.</summary>
        public static List<SimState> Replay(EngineSpec spec, InputLog log)
        {
            var engine = new Engine(spec);
            var states = new List<SimState> { engine.Snapshot() };
            for (long step = 1; step <= log.Steps; step++)
            {
                engine.Run(log.At(step));
                if (step % CheckpointEvery == 0) states.Add(engine.Snapshot());
            }
            return states;
        }
    }
}
