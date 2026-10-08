using System;

namespace Runner.Engine
{
    /// <summary>The rules phase (web/src/lib/engine/rules.ts): queued events are matched against the rules in written order, conditions read the counters, actions run at once.</summary>
    public static class RuleEngine
    {
        const long Clamp = EngineVocab.CounterLimit;
        static long Limit(long n) => Math.Max(-Clamp, Math.Min(Clamp, n));

        static bool Compare(long left, CondDef c)
        {
            switch (c.Op)
            {
                case "<": return left < c.Value;
                case "<=": return left <= c.Value;
                case "==": return left == c.Value;
                case ">=": return left >= c.Value;
                default: return left > c.Value;
            }
        }

        static bool Matches(EventDef rule, int ruleIndex, Raised r)
        {
            if (rule.Type != r.Event.Type) return false;
            if (rule.Type == "tick" || rule.Type == "counterReaches") return r.Rule == ruleIndex;
            if (rule.Type == "exitBounds") return r.Event.Entity == rule.Entity;
            return true;
        }

        /// <summary>A collide event matches in either order; the rule's a and b are then bound to the right objects. False when the pair does not match.</summary>
        static bool Bind(EventDef rule, Raised r, out Obj a, out Obj b)
        {
            a = null;
            b = null;
            if (rule.Type != "collide") return true;
            if (r.Event.A == rule.A && r.Event.B == rule.B) { a = r.A; b = r.B; return true; }
            if (r.Event.A == rule.B && r.Event.B == rule.A) { a = r.B; b = r.A; return true; }
            return false;
        }

        static void Perform(Engine engine, ActionDef action, Raised r, Obj a, Obj b)
        {
            var counters = engine.Counters;
            switch (action.Type)
            {
                case "add":
                    counters[action.Counter] = Limit(counters[action.Counter] + action.N);
                    engine.CheckReaches();
                    break;
                case "set":
                    counters[action.Counter] = Limit(action.N);
                    engine.CheckReaches();
                    break;
                case "destroy":
                {
                    var target = action.Target == "a" ? a : action.Target == "b" ? b : (r.Self ?? engine.Hero());
                    if (target != null) target.Alive = false;
                    break;
                }
                case "spawn":
                    engine.SpawnAction(action.Entity);
                    break;
                case "bounce":
                {
                    var target = action.Target == "a" ? a : b;
                    if (target != null) target.Vy = -target.Vy;
                    break;
                }
                case "win": engine.End(Status.Won); break;
                case "lose": engine.End(Status.Lost); break;
                case "speedUp": engine.SpeedUpTotal = Math.Min(300, engine.SpeedUpTotal + action.Percent); break;
            }
        }

        public static void Run(Engine engine)
        {
            engine.CheckReaches();
            var rules = engine.Spec.Rules;
            for (var i = 0; i < engine.Queue.Count; i++)
            {
                var raised = engine.Queue[i];
                for (var k = 0; k < rules.Count; k++)
                {
                    var rule = rules[k];
                    if (!Matches(rule.On, k, raised)) continue;
                    if (!Bind(rule.On, raised, out var a, out var b)) continue;
                    if (rule.When != null)
                    {
                        var all = true;
                        foreach (var c in rule.When) if (!Compare(engine.Counters[c.Counter], c)) { all = false; break; }
                        if (!all) continue;
                    }
                    foreach (var action in rule.Do)
                    {
                        if (++engine.Actions > EngineVocab.ActionsPerStep) { engine.End(Status.Lost); return; }
                        Perform(engine, action, raised, a, b);
                    }
                }
            }
        }
    }
}
