using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Runner.Engine
{
    /// <summary>
    /// Reads and checks a game spec. This is a port of web/src/lib/engine/check.ts: the same rules, in the same order, with the same sentences, so a
    /// spec the website accepts plays here and a hostile one is refused with the website's message (Tests/Engine/bad-specs.json holds the cases the
    /// two sides must agree on). One difference: the 64 KiB size is measured on the text as written, not on a re-serialization.
    /// </summary>
    public static class SpecParser
    {
        enum Kind { Int, Enum, Bool, Entity, Counter }

        sealed class Field
        {
            public string Name; public Kind Kind; public long Min, Max; public string[] Values;
        }

        sealed class Refusal : Exception { public Refusal(string m) : base(m) { } }

        sealed class Ref { public string Path, Name; }

        sealed class Refs { public readonly List<Ref> Entities = new List<Ref>(), Counters = new List<Ref>(); }

        static Field I(string name, long min, long max) => new Field { Name = name, Kind = Kind.Int, Min = min, Max = max };
        static Field E(string name, params string[] values) => new Field { Name = name, Kind = Kind.Enum, Values = values };
        static Field B(string name) => new Field { Name = name, Kind = Kind.Bool };
        static Field Ent(string name) => new Field { Name = name, Kind = Kind.Entity };
        static Field Cnt(string name) => new Field { Name = name, Kind = Kind.Counter };

        const long Speed = 100000, CounterValue = EngineVocab.CounterLimit;

        static readonly Dictionary<string, Field[]> BehaviorFields = new Dictionary<string, Field[]>
        {
            { "move", new[] { E("dir", "left", "right", "up", "down"), I("speed", -Speed, Speed) } },
            { "lane", new[] { I("count", 2, 5), I("switchMs", 1, 5000) } },
            { "oscillate", new[] { E("axis", "x", "y"), I("amplitude", 0, 50000), I("periodMs", 100, 60000) } },
            { "fall", new[] { I("speed", -Speed, Speed) } },
            { "follow", new[] { Ent("target"), I("speed", -Speed, Speed) } },
            { "control", new[] { E("on", "tap", "hold"), E("does", "jump", "flap", "flip", "fire", "switchLane", "thrust"), I("power", -Speed, Speed) } },
            { "spawn", new[] { Ent("entity"), E("pattern", "random", "lanes", "wave", "rain", "stream"), I("intervalMs", 100, 60000), I("speed", 0, Speed), B("ramp") } },
            { "lifetime", new[] { I("ms", 1, 600000) } },
        };

        static readonly Dictionary<string, Field[]> EventFields = new Dictionary<string, Field[]>
        {
            { "start", new Field[0] },
            { "tick", new[] { I("everyMs", 100, 600000) } },
            { "tap", new Field[0] },
            { "hold", new Field[0] },
            { "release", new Field[0] },
            { "collide", new[] { Ent("a"), Ent("b") } },
            { "exitBounds", new[] { Ent("entity") } },
            { "counterReaches", new[] { Cnt("counter"), I("value", -CounterValue, CounterValue) } },
        };

        static readonly Dictionary<string, Field[]> ActionFields = new Dictionary<string, Field[]>
        {
            { "add", new[] { Cnt("counter"), I("n", -CounterValue, CounterValue) } },
            { "set", new[] { Cnt("counter"), I("n", -CounterValue, CounterValue) } },
            { "destroy", new[] { E("target", "a", "b", "self") } },
            { "spawn", new[] { Ent("entity") } },
            { "bounce", new[] { E("target", "a", "b") } },
            { "win", new Field[0] },
            { "lose", new Field[0] },
            { "speedUp", new[] { I("percent", 1, 300) } },
        };

        static readonly Field[] ConditionFields = { Cnt("counter"), E("op", "<", "<=", "==", ">=", ">"), I("value", -CounterValue, CounterValue) };

        static Exception Refuse(string path, string problem) => new Refusal(path + ": " + problem);

        // ---- the same words JavaScript's String() gives, for the messages that quote a value ----
        static string JsString(object v)
        {
            if (v == null) return "null";
            if (v is bool b) return b ? "true" : "false";
            if (v is double d) return d.ToString("R", CultureInfo.InvariantCulture);
            if (v is string s) return s;
            if (v is JsonObject) return "[object Object]";
            if (v is List<object> list) { var parts = new List<string>(); foreach (var x in list) parts.Add(x == null ? "" : JsString(x)); return string.Join(",", parts); }
            return v.ToString();
        }

        static bool IsLower(char c) => c >= 'a' && c <= 'z';
        static bool IsAlnum(char c) => IsLower(c) || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
        static bool IsName(string s)
        {
            if (s.Length < 1 || s.Length > 16 || !IsLower(s[0])) return false;
            for (var i = 1; i < s.Length; i++) if (!IsAlnum(s[i])) return false;
            return true;
        }
        static bool IsModelName(string s)
        {
            if (s.Length < 1 || s.Length > 32 || !IsLower(s[0])) return false;
            for (var i = 1; i < s.Length; i++) if (!IsAlnum(s[i]) && s[i] != '-') return false;
            return true;
        }
        static bool IsHex(string s)
        {
            if (s.Length != 7 || s[0] != '#') return false;
            for (var i = 1; i < 7; i++) if (!IsHexChar(s[i])) return false;
            return true;
        }
        static bool IsHexChar(char c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
        static bool In(string[] list, string v) => Array.IndexOf(list, v) >= 0;

        static JsonObject Obj(object v, string path)
        {
            if (v is JsonObject o) return o;
            throw Refuse(path, "must be an object");
        }

        static void OnlyKeys(JsonObject value, string[] allowed, string path)
        {
            foreach (var key in value.Keys) if (!In(allowed, key)) throw Refuse(path, "unknown field \"" + key + "\"");
            foreach (var key in allowed) if (!value.Has(key)) throw Refuse(path, "missing field \"" + key + "\"");
        }

        static long Whole(object v, long min, long max, string path)
        {
            if (!(v is double d) || double.IsInfinity(d) || double.IsNaN(d) || Math.Floor(d) != d) throw Refuse(path, "must be a whole number");
            if (d < min || d > max) throw Refuse(path, "must be between " + min + " and " + max);
            return (long)d;
        }

        static void CheckFields(JsonObject value, Field[] fields, string path, Refs refs)
        {
            foreach (var f in fields)
            {
                var at = path + "." + f.Name;
                var v = value.Get(f.Name);
                if (f.Kind == Kind.Int) Whole(v, f.Min, f.Max, at);
                else if (f.Kind == Kind.Bool) { if (!(v is bool)) throw Refuse(at, "must be true or false"); }
                else if (f.Kind == Kind.Enum) { if (!(v is string s) || !In(f.Values, s)) throw Refuse(at, "must be one of " + string.Join(", ", f.Values)); }
                else
                {
                    if (!(v is string name)) throw Refuse(at, "must be a name");
                    (f.Kind == Kind.Entity ? refs.Entities : refs.Counters).Add(new Ref { Path = at, Name = name });
                }
            }
        }

        static Field[] CheckTagged(object value, Dictionary<string, Field[]> table, string what, string path, Refs refs)
        {
            var o = Obj(value, path);
            var type = o.Get("type") as string;
            if (type == null || !table.ContainsKey(type)) throw Refuse(path, "unknown " + what + " \"" + (o.Has("type") ? JsString(o.Get("type")) : "undefined") + "\"");
            var fields = table[type];
            var allowed = new List<string> { "type" };
            foreach (var f in fields) allowed.Add(f.Name);
            OnlyKeys(o, allowed.ToArray(), path);
            CheckFields(o, fields, path, refs);
            return fields;
        }

        static JsonObject CheckMap(object value, string path, int max, string what)
        {
            var o = Obj(value, path);
            if (o.Keys.Count > max) throw Refuse(path, "at most " + max + " " + what);
            foreach (var key in o.Keys) if (!IsName(key)) throw Refuse(path, "\"" + key + "\" is not a valid name (a letter, then letters and digits, up to 16)");
            return o;
        }

        static void CheckEntity(object value, string path, Refs refs)
        {
            var e = Obj(value, path);
            OnlyKeys(e, new[] { "role", "model", "color", "w", "h", "collider", "x", "y", "behaviors" }, path);
            if (!(e.Get("role") is string role) || !In(EngineVocab.Roles, role)) throw Refuse(path + ".role", "must be one of " + string.Join(", ", EngineVocab.Roles));
            if (!(e.Get("model") is string model) || !(In(EngineVocab.Primitives, model) || IsModelName(model))) throw Refuse(path + ".model", "must be a model name or a primitive");
            Whole(e.Get("color"), 0, 4, path + ".color");
            if (!(e.Get("collider") is string collider) || !In(EngineVocab.Colliders, collider)) throw Refuse(path + ".collider", "must be box or circle");
            var w = Whole(e.Get("w"), 0, 20000, path + ".w");
            var h = Whole(e.Get("h"), 0, 20000, path + ".h");
            Whole(e.Get("x"), -100000, 100000, path + ".x");
            Whole(e.Get("y"), -100000, 100000, path + ".y");
            if (!(e.Get("behaviors") is List<object> behaviors)) throw Refuse(path + ".behaviors", "must be a list");
            if (behaviors.Count > 8) throw Refuse(path + ".behaviors", "at most 8");
            var spawner = false;
            foreach (var b in behaviors) if (b is JsonObject bo && bo.Get("type") is string t && t == "spawn") spawner = true;
            if ((w == 0 || h == 0) && !spawner) throw Refuse(path, "only a spawner may have size 0");
            for (var i = 0; i < behaviors.Count; i++) CheckTagged(behaviors[i], BehaviorFields, "behavior", path + ".behaviors[" + i + "]", refs);
        }

        static void CheckRule(object value, string path, Refs refs)
        {
            var r = Obj(value, path);
            foreach (var k in r.Keys) if (k != "on" && k != "when" && k != "do") throw Refuse(path, "unknown field");
            CheckTagged(r.Get("on"), EventFields, "event", path + ".on", refs);
            if (r.Has("when"))
            {
                if (!(r.Get("when") is List<object> when) || when.Count > 4) throw Refuse(path + ".when", "must be a list of at most 4");
                for (var i = 0; i < when.Count; i++)
                {
                    var at = path + ".when[" + i + "]";
                    var c = Obj(when[i], at);
                    OnlyKeys(c, new[] { "counter", "op", "value" }, at);
                    CheckFields(c, ConditionFields, at, refs);
                }
            }
            if (!(r.Get("do") is List<object> actions) || actions.Count == 0 || actions.Count > 10) throw Refuse(path + ".do", "must be a list of 1 to 10 actions");
            for (var i = 0; i < actions.Count; i++) CheckTagged(actions[i], ActionFields, "action", path + ".do[" + i + "]", refs);
        }

        /// <summary>Reads and checks a spec; on a refusal <paramref name="error"/> is the sentence and the spec is null.</summary>
        public static bool TryParse(string text, out EngineSpec spec, out string error)
        {
            spec = null;
            if (!MiniJson.TryParse(text, out var root, out var parseError)) { error = "game: not valid JSON (" + parseError + ")"; return false; }
            return TryParseValue(root, Encoding.UTF8.GetByteCount(text), out spec, out error);
        }

        /// <summary>Checks a spec that is already parsed (the "game" value inside a settings file); <paramref name="bytes"/> is the size of the text it came from.</summary>
        public static bool TryParseValue(object root, int bytes, out EngineSpec spec, out string error)
        {
            spec = null;
            try
            {
                spec = CheckAll(root, bytes);
                error = null;
                return true;
            }
            catch (Refusal r)
            {
                error = r.Message;
                return false;
            }
        }

        static EngineSpec CheckAll(object input, int bytes)
        {
            var top = Obj(input, "game");
            if (bytes > EngineVocab.SpecBytes) throw Refuse("game", "is over 64 KiB");
            OnlyKeys(top, new[] { "engine", "seed", "world", "counters", "entities", "rules", "ends", "difficulty", "look" }, "game");
            if (!(top.Get("engine") is double eng) || eng != 1) throw Refuse("engine", "must be 1");
            var spec = new EngineSpec { Seed = Whole(top.Get("seed"), 1, 4294967295, "seed") };

            var world = Obj(top.Get("world"), "world");
            OnlyKeys(world, new[] { "camera", "gravity", "width", "height", "scroll" }, "world");
            if (!(world.Get("camera") is string camera) || !In(EngineVocab.Cameras, camera)) throw Refuse("world.camera", "must be one of " + string.Join(", ", EngineVocab.Cameras));
            spec.Camera = camera;
            spec.Gravity = Whole(world.Get("gravity"), -100000, 100000, "world.gravity");
            spec.Width = Whole(world.Get("width"), 1000, 100000, "world.width");
            spec.Height = Whole(world.Get("height"), 1000, 100000, "world.height");
            spec.Scroll = Whole(world.Get("scroll"), -50000, 50000, "world.scroll");

            var counters = CheckMap(top.Get("counters"), "counters", EngineVocab.Counters, "counters");
            foreach (var name in counters.Keys) spec.Counters.Add(new KeyValuePair<string, long>(name, Whole(counters.Get(name), -EngineVocab.CounterLimit, EngineVocab.CounterLimit, "counters." + name)));

            var entities = CheckMap(top.Get("entities"), "entities", EngineVocab.Entities, "entities");
            var refs = new Refs();
            foreach (var name in entities.Keys) CheckEntity(entities.Get(name), "entities." + name, refs);
            var heroes = 0;
            foreach (var name in entities.Keys) if (((JsonObject)entities.Get(name)).Get("role") as string == "hero") heroes++;
            if (heroes != 1) throw Refuse("entities", "there must be exactly one hero");

            if (!(top.Get("rules") is List<object> rules)) throw Refuse("rules", "must be a list");
            if (rules.Count > EngineVocab.Rules) throw Refuse("rules", "at most " + EngineVocab.Rules + " rules");
            for (var i = 0; i < rules.Count; i++) CheckRule(rules[i], "rules[" + i + "]", refs);

            foreach (var r in refs.Entities) if (!entities.Has(r.Name)) throw Refuse(r.Path, "unknown entity \"" + r.Name + "\"");
            foreach (var r in refs.Counters) if (!counters.Has(r.Name)) throw Refuse(r.Path, "unknown counter \"" + r.Name + "\"");
            foreach (var name in entities.Keys)
            {
                foreach (var b in (List<object>)((JsonObject)entities.Get(name)).Get("behaviors"))
                {
                    var bo = (JsonObject)b;
                    if (bo.Get("type") as string != "spawn") continue;
                    var target = (JsonObject)entities.Get((string)bo.Get("entity"));
                    foreach (var tb in (List<object>)target.Get("behaviors"))
                        if (((JsonObject)tb).Get("type") as string == "spawn") throw Refuse("entities." + name, "spawns \"" + bo.Get("entity") + "\", which is itself a spawner");
                }
            }

            var ends = Obj(top.Get("ends"), "ends");
            OnlyKeys(ends, new[] { "timeLimitMs", "winOnTime", "scoreToWin" }, "ends");
            spec.TimeLimitMs = Whole(ends.Get("timeLimitMs"), 0, 600000, "ends.timeLimitMs");
            if (!(ends.Get("winOnTime") is bool winOnTime)) throw Refuse("ends.winOnTime", "must be true or false");
            spec.WinOnTime = winOnTime;
            spec.ScoreToWin = Whole(ends.Get("scoreToWin"), 0, EngineVocab.CounterLimit, "ends.scoreToWin");

            var difficulty = Obj(top.Get("difficulty"), "difficulty");
            OnlyKeys(difficulty, new[] { "rampMs", "speedPercent", "spawnPercent" }, "difficulty");
            spec.RampMs = Whole(difficulty.Get("rampMs"), 0, 600000, "difficulty.rampMs");
            spec.SpeedPercent = Whole(difficulty.Get("speedPercent"), 0, 300, "difficulty.speedPercent");
            spec.SpawnPercent = Whole(difficulty.Get("spawnPercent"), 0, 90, "difficulty.spawnPercent");

            var look = Obj(top.Get("look"), "look");
            OnlyKeys(look, new[] { "palette" }, "look");
            var ok = look.Get("palette") is List<object> palette && palette.Count >= 1 && palette.Count <= 5;
            if (ok) foreach (var c in (List<object>)look.Get("palette")) if (!(c is string cs) || !IsHex(cs)) ok = false;
            if (!ok) throw Refuse("look.palette", "must be 1 to 5 colors like #aabbcc");
            foreach (var c in (List<object>)look.Get("palette")) spec.Palette.Add((string)c);
            foreach (var name in entities.Keys)
                if (Whole(((JsonObject)entities.Get(name)).Get("color"), 0, 4, "") >= spec.Palette.Count) throw Refuse("entities." + name + ".color", "palette has only " + spec.Palette.Count + " colors");

            foreach (var name in entities.Keys) spec.Entities.Add(ReadEntity(name, (JsonObject)entities.Get(name)));
            foreach (var r in rules) spec.Rules.Add(ReadRule((JsonObject)r));
            return spec;
        }

        static long L(JsonObject o, string key) => (long)(double)o.Get(key);
        static string S(JsonObject o, string key) => (string)o.Get(key);

        static EntityDef ReadEntity(string name, JsonObject o)
        {
            var e = new EntityDef { Name = name, Role = S(o, "role"), Model = S(o, "model"), Collider = S(o, "collider"), Color = L(o, "color"), W = L(o, "w"), H = L(o, "h"), X = L(o, "x"), Y = L(o, "y") };
            foreach (var b in (List<object>)o.Get("behaviors"))
            {
                var bo = (JsonObject)b;
                var def = new BehaviorDef { Type = S(bo, "type") };
                switch (def.Type)
                {
                    case "move": def.Dir = S(bo, "dir"); def.Speed = L(bo, "speed"); break;
                    case "lane": def.Count = L(bo, "count"); def.SwitchMs = L(bo, "switchMs"); break;
                    case "oscillate": def.Axis = S(bo, "axis"); def.Amplitude = L(bo, "amplitude"); def.PeriodMs = L(bo, "periodMs"); break;
                    case "fall": def.Speed = L(bo, "speed"); break;
                    case "follow": def.Target = S(bo, "target"); def.Speed = L(bo, "speed"); break;
                    case "control": def.On = S(bo, "on"); def.Does = S(bo, "does"); def.Power = L(bo, "power"); break;
                    case "spawn": def.Entity = S(bo, "entity"); def.Pattern = S(bo, "pattern"); def.IntervalMs = L(bo, "intervalMs"); def.Speed = L(bo, "speed"); def.Ramp = (bool)bo.Get("ramp"); break;
                    case "lifetime": def.Ms = L(bo, "ms"); break;
                }
                e.Behaviors.Add(def);
            }
            return e;
        }

        static RuleDef ReadRule(JsonObject o)
        {
            var on = (JsonObject)o.Get("on");
            var ev = new EventDef { Type = S(on, "type") };
            switch (ev.Type)
            {
                case "tick": ev.EveryMs = L(on, "everyMs"); break;
                case "collide": ev.A = S(on, "a"); ev.B = S(on, "b"); break;
                case "exitBounds": ev.Entity = S(on, "entity"); break;
                case "counterReaches": ev.Counter = S(on, "counter"); ev.Value = L(on, "value"); break;
            }
            var rule = new RuleDef { On = ev };
            if (o.Has("when"))
            {
                rule.When = new List<CondDef>();
                foreach (var c in (List<object>)o.Get("when")) { var co = (JsonObject)c; rule.When.Add(new CondDef { Counter = S(co, "counter"), Op = S(co, "op"), Value = L(co, "value") }); }
            }
            foreach (var a in (List<object>)o.Get("do"))
            {
                var ao = (JsonObject)a;
                var act = new ActionDef { Type = S(ao, "type") };
                switch (act.Type)
                {
                    case "add": case "set": act.Counter = S(ao, "counter"); act.N = L(ao, "n"); break;
                    case "destroy": case "bounce": act.Target = S(ao, "target"); break;
                    case "spawn": act.Entity = S(ao, "entity"); break;
                    case "speedUp": act.Percent = L(ao, "percent"); break;
                }
                rule.Do.Add(act);
            }
            return rule;
        }
    }
}
