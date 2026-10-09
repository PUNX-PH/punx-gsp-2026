using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using MoonSharp.Interpreter;

namespace Runner.Scripting
{
    public enum GameOutcome
    {
        Playing,
        Won,
        Lost,
    }

    /// <summary>A line of text or a bar over the scene. Positions and sizes are fractions of the screen: (0, 0) is the top left, (1, 1) the bottom right.</summary>
    public sealed class UiElement
    {
        public string Id;
        public bool IsBar;
        public string Text = "";
        public double X = 0.05, Y = 0.1;
        public double Size = 0.04;
        public double W = 0.4, H = 0.03;
        public double Value, Max = 1;
        public string Color;
        public string Align = "left";
    }

    /// <summary>The view the script chose: a mode, optionally an object to follow, a position and a zoom.</summary>
    public sealed class CameraState
    {
        public string Mode = "side";
        public ScriptObject Follow;
        public double X, Y, Z;
        public double Zoom = 1;
    }

    public sealed class ScriptTimer
    {
        public int Id;
        public double Due;
        public double Interval;
        public bool Repeats;
        public bool Cancelled;
        public DynValue Function;
    }

    /// <summary>
    /// The game API of a script, bound to a <see cref="ScriptHost"/> and a <see cref="ScriptWorld"/>: the tables <c>game world input ui timer</c>, the
    /// functions <c>rand</c> and <c>rand_int</c>, and the objects a script gets from <c>world.spawn</c>. Everything is plain Lua tables and C# delegates
    /// (no CLR types are exposed). An object is an empty table whose metatable reads and writes the C# <see cref="ScriptObject"/>; a field the script
    /// invents lands in the object's <c>data</c> table. Wrong arguments are Lua errors that name the function. Pure C#, no Unity types.
    /// </summary>
    public sealed class GameApi
    {
        public const int MaxTimers = 50;
        public const int MaxUiElements = 24;
        public const int MaxUiTextLength = 2000;
        const int MaxNameLength = 100;
        const int MaxMessageLength = 200;
        const double MinInterval = 1.0 / 60.0;

        static readonly Regex Hex = new Regex("^#[0-9a-fA-F]{6}$");
        static readonly string[] CameraModes = { "side", "top", "chase", "fixed", "side2d", "top2d", "first" };
        static readonly string[] Aligns = { "left", "center", "right" };

        readonly Script lua;
        readonly ScriptWorld world;
        readonly Table gameTable;
        readonly Table inputTable;
        readonly Table objectMeta;
        readonly ConditionalWeakTable<Table, ScriptObject> owners = new ConditionalWeakTable<Table, ScriptObject>();
        readonly Dictionary<string, DynValue> methods = new Dictionary<string, DynValue>();
        readonly List<ScriptTimer> timers = new List<ScriptTimer>();
        uint randState;
        int nextTimerId = 1;

        public GameOutcome Outcome { get; private set; }
        public string Message { get; private set; } = "";
        public double Score { get; private set; }
        public double Lives { get; private set; } = 3;
        public CameraState Camera { get; } = new CameraState();
        public List<UiElement> Ui { get; } = new List<UiElement>();
        public int DroppedTimers { get; private set; }
        public int DroppedUiElements { get; private set; }

        public bool Over => Outcome != GameOutcome.Playing;

        public GameApi(ScriptHost host, ScriptWorld world, uint seed)
        {
            lua = host.Lua;
            this.world = world;
            randState = seed == 0 ? 1u : seed;

            objectMeta = new Table(lua);
            objectMeta.Set("__index", DynValue.NewCallback(ObjectIndex));
            objectMeta.Set("__newindex", DynValue.NewCallback(ObjectNewIndex));
            methods["destroy"] = DynValue.NewCallback((c, a) => { Self(a, "obj:destroy").Destroy(); return DynValue.Nil; });
            methods["set_color"] = DynValue.NewCallback((c, a) => { Self(a, "obj:set_color").Color = ParseColor(a[1], "obj:set_color", "color"); return DynValue.Nil; });
            methods["play"] = DynValue.NewCallback((c, a) => { Self(a, "obj:play").Animation = Name(a[1], "obj:play", "animation"); return DynValue.Nil; });
            methods["distance"] = DynValue.NewCallback((c, a) => DynValue.NewNumber(Self(a, "obj:distance").Distance(OtherObject(a[1], "obj:distance"))));

            gameTable = new Table(lua);
            gameTable.Set("score", DynValue.NewNumber(0));
            gameTable.Set("lives", DynValue.NewNumber(3));
            gameTable.Set("win", DynValue.NewCallback((c, a) => End(GameOutcome.Won, a[0])));
            gameTable.Set("lose", DynValue.NewCallback((c, a) => End(GameOutcome.Lost, a[0])));
            lua.Globals["game"] = DynValue.NewTable(gameTable);

            var worldTable = new Table(lua);
            worldTable.Set("spawn", DynValue.NewCallback(WorldSpawn));
            worldTable.Set("find", DynValue.NewCallback(WorldFind));
            worldTable.Set("count", DynValue.NewCallback((c, a) => DynValue.NewNumber(world.Count(OptName(a[0], "world.count", "tag")))));
            worldTable.Set("clear", DynValue.NewCallback((c, a) => { world.Clear(); return DynValue.Nil; }));
            worldTable.Set("gravity", DynValue.NewCallback((c, a) => { world.Gravity = Number(a[0], "world.gravity", "g"); return DynValue.Nil; }));
            worldTable.Set("bounds", DynValue.NewCallback(WorldBounds));
            worldTable.Set("camera", DynValue.NewCallback(WorldCamera));
            lua.Globals["world"] = DynValue.NewTable(worldTable);

            inputTable = new Table(lua);
            foreach (var key in new[] { "x", "y", "dx", "dy" }) inputTable.Set(key, DynValue.NewNumber(0));
            inputTable.Set("down", DynValue.False);
            lua.Globals["input"] = DynValue.NewTable(inputTable);

            var uiTable = new Table(lua);
            uiTable.Set("text", DynValue.NewCallback(UiText));
            uiTable.Set("bar", DynValue.NewCallback(UiBar));
            uiTable.Set("clear", DynValue.NewCallback(UiClear));
            lua.Globals["ui"] = DynValue.NewTable(uiTable);

            var timerTable = new Table(lua);
            timerTable.Set("after", DynValue.NewCallback((c, a) => AddTimer(a, false)));
            timerTable.Set("every", DynValue.NewCallback((c, a) => AddTimer(a, true)));
            timerTable.Set("cancel", DynValue.NewCallback(CancelTimer));
            lua.Globals["timer"] = DynValue.NewTable(timerTable);

            lua.Globals["rand"] = DynValue.NewCallback((c, a) => DynValue.NewNumber(NextRandom()));
            lua.Globals["rand_int"] = DynValue.NewCallback(RandInt);
        }

        // ---- what the runner does around each call into the script

        /// <summary>Publishes the read-only values the script sees: game.time, width, height and over.</summary>
        public void SyncIn()
        {
            gameTable.Set("time", DynValue.NewNumber(world.Time));
            gameTable.Set("width", DynValue.NewNumber(world.Width));
            gameTable.Set("height", DynValue.NewNumber(world.Height));
            gameTable.Set("over", DynValue.NewBoolean(Over));
        }

        /// <summary>Reads back what the script may write: game.score and game.lives. False with a sentence when one is not a number.</summary>
        public bool SyncOut(out string error)
        {
            error = null;
            var score = gameTable.Get("score");
            var lives = gameTable.Get("lives");
            if (score.Type != DataType.Number) { error = "game.score must be a number."; return false; }
            if (lives.Type != DataType.Number) { error = "game.lives must be a number."; return false; }
            Score = score.Number;
            Lives = lives.Number;
            return true;
        }

        public void SetInput(double x, double y, bool down, double dx, double dy)
        {
            inputTable.Set("x", DynValue.NewNumber(x));
            inputTable.Set("y", DynValue.NewNumber(y));
            inputTable.Set("down", DynValue.NewBoolean(down));
            inputTable.Set("dx", DynValue.NewNumber(dx));
            inputTable.Set("dy", DynValue.NewNumber(dy));
        }

        /// <summary>The Lua table that stands for an object (made on first use).</summary>
        public DynValue HandleFor(ScriptObject o)
        {
            if (o.Handle is Table existing) return DynValue.NewTable(existing);
            var table = new Table(lua) { MetaTable = objectMeta };
            owners.Add(table, o);
            o.Handle = table;
            return DynValue.NewTable(table);
        }

        /// <summary>The timers that are due at <paramref name="now"/>, earliest first. A repeating one is moved on; a one-shot is dropped.</summary>
        public List<ScriptTimer> TakeDueTimers(double now)
        {
            var due = new List<ScriptTimer>();
            timers.RemoveAll(t => t.Cancelled);
            foreach (var t in timers)
                if (t.Due <= now) due.Add(t);
            due.Sort((a, b) =>
            {
                var byDue = a.Due.CompareTo(b.Due);
                return byDue != 0 ? byDue : a.Id.CompareTo(b.Id);
            });
            foreach (var t in due)
            {
                if (t.Repeats) t.Due = Math.Max(t.Due + t.Interval, now + MinInterval / 2);
                else timers.Remove(t);
            }
            return due;
        }

        // ---- game

        DynValue End(GameOutcome outcome, DynValue message)
        {
            if (Outcome != GameOutcome.Playing) return DynValue.Nil;
            Outcome = outcome;
            if (message.Type == DataType.String || message.Type == DataType.Number)
            {
                var text = message.CastToString();
                Message = text.Length > MaxMessageLength ? text.Substring(0, MaxMessageLength) : text;
            }
            gameTable.Set("over", DynValue.True);
            return DynValue.Nil;
        }

        // ---- world

        DynValue WorldSpawn(ScriptExecutionContext ctx, CallbackArguments a)
        {
            var kind = Name(a[0], "world.spawn", "kind");
            if (kind == null) throw new ScriptRuntimeException("world.spawn: kind must be a string (a model name or a primitive such as \"box\").");
            if (!a[1].IsNil() && a[1].Type != DataType.Table) throw new ScriptRuntimeException("world.spawn: props must be a table, such as { x = 1, y = 2 }.");
            var o = world.Spawn(kind);
            if (a[1].Type == DataType.Table)
            {
                foreach (var pair in a[1].Table.Pairs) SetField(o, pair.Key, pair.Value, "world.spawn");
            }
            return HandleFor(o);
        }

        DynValue WorldFind(ScriptExecutionContext ctx, CallbackArguments a)
        {
            var list = new Table(lua);
            foreach (var o in world.Find(OptName(a[0], "world.find", "tag"))) list.Append(HandleFor(o));
            return DynValue.NewTable(list);
        }

        DynValue WorldBounds(ScriptExecutionContext ctx, CallbackArguments a)
        {
            var w = Number(a[0], "world.bounds", "w");
            var h = Number(a[1], "world.bounds", "h");
            if (!world.SetBounds(w, h)) throw new ScriptRuntimeException("world.bounds: w and h must be numbers above 0.");
            gameTable.Set("width", DynValue.NewNumber(world.Width));
            gameTable.Set("height", DynValue.NewNumber(world.Height));
            return DynValue.Nil;
        }

        DynValue WorldCamera(ScriptExecutionContext ctx, CallbackArguments a)
        {
            if (a[0].Type != DataType.Table) throw new ScriptRuntimeException("world.camera: call it with a table, such as world.camera{ mode = \"side\" }.");
            var t = a[0].Table;
            var mode = t.Get("mode");
            if (!mode.IsNil())
            {
                if (mode.Type != DataType.String || Array.IndexOf(CameraModes, mode.String) < 0)
                    throw new ScriptRuntimeException("world.camera: mode must be one of " + string.Join(", ", CameraModes) + ".");
                Camera.Mode = mode.String;
            }
            var follow = t.Get("follow");
            if (follow.Type == DataType.Table) Camera.Follow = OtherObject(follow, "world.camera");
            else if (follow.Type == DataType.Boolean && !follow.Boolean) Camera.Follow = null;
            else if (!follow.IsNil()) throw new ScriptRuntimeException("world.camera: follow must be an object (or false to stop following).");
            OptNumber(t, "x", "world.camera", ref Camera.X);
            OptNumber(t, "y", "world.camera", ref Camera.Y);
            OptNumber(t, "z", "world.camera", ref Camera.Z);
            OptNumber(t, "zoom", "world.camera", ref Camera.Zoom);
            if (Camera.Zoom <= 0) Camera.Zoom = 1;
            return DynValue.Nil;
        }

        // ---- objects

        ScriptObject Self(CallbackArguments a, string where)
        {
            if (a[0].Type == DataType.Table && owners.TryGetValue(a[0].Table, out var o)) return o;
            throw new ScriptRuntimeException(where + ": call it on an object with a colon, like " + where + "().");
        }

        ScriptObject OtherObject(DynValue v, string where)
        {
            if (v.Type == DataType.Table && owners.TryGetValue(v.Table, out var o)) return o;
            throw new ScriptRuntimeException(where + ": expected an object (one that world.spawn or world.find gave).");
        }

        DynValue ObjectIndex(ScriptExecutionContext ctx, CallbackArguments a)
        {
            if (a[0].Type != DataType.Table || !owners.TryGetValue(a[0].Table, out var o)) return DynValue.Nil;
            var key = a[1];
            if (key.Type == DataType.String)
            {
                switch (key.String)
                {
                    case "x": return DynValue.NewNumber(o.X);
                    case "y": return DynValue.NewNumber(o.Y);
                    case "z": return DynValue.NewNumber(o.Z);
                    case "vx": return DynValue.NewNumber(o.Vx);
                    case "vy": return DynValue.NewNumber(o.Vy);
                    case "vz": return DynValue.NewNumber(o.Vz);
                    case "w": return DynValue.NewNumber(o.W);
                    case "h": return DynValue.NewNumber(o.H);
                    case "d": return DynValue.NewNumber(o.D);
                    case "angle": return DynValue.NewNumber(o.Angle);
                    case "spin": return DynValue.NewNumber(o.Spin);
                    case "life": return double.IsPositiveInfinity(o.Life) ? DynValue.Nil : DynValue.NewNumber(o.Life);
                    case "id": return DynValue.NewNumber(o.Id);
                    case "kind": return DynValue.NewString(o.Kind);
                    case "tag": return o.Tag == null ? DynValue.Nil : DynValue.NewString(o.Tag);
                    case "color": return o.Color == null ? DynValue.Nil : DynValue.NewString(o.Color);
                    case "animation": return o.Animation == null ? DynValue.Nil : DynValue.NewString(o.Animation);
                    case "alive": return DynValue.NewBoolean(o.Alive);
                    case "gravity": return DynValue.NewBoolean(o.Gravity);
                    case "solid": return DynValue.NewBoolean(o.Solid);
                    case "data": return DynValue.NewTable(DataOf(o));
                }
                if (methods.TryGetValue(key.String, out var method)) return method;
            }
            return o.Data is Table data ? data.Get(key) : DynValue.Nil;
        }

        DynValue ObjectNewIndex(ScriptExecutionContext ctx, CallbackArguments a)
        {
            if (a[0].Type != DataType.Table || !owners.TryGetValue(a[0].Table, out var o)) return DynValue.Nil;
            SetField(o, a[1], a[2], "obj");
            return DynValue.Nil;
        }

        Table DataOf(ScriptObject o)
        {
            if (o.Data is Table existing) return existing;
            var table = new Table(lua);
            o.Data = table;
            return table;
        }

        /// <summary>Writes one field of an object: a known name sets it (checking the type), any other name goes into the object's data table.</summary>
        void SetField(ScriptObject o, DynValue key, DynValue value, string where)
        {
            if (key.IsNil()) throw new ScriptRuntimeException("table index is nil");
            if (key.Type == DataType.String)
            {
                var name = key.String;
                switch (name)
                {
                    case "x": o.X = Number(value, where, name); return;
                    case "y": o.Y = Number(value, where, name); return;
                    case "z": o.Z = Number(value, where, name); return;
                    case "vx": o.Vx = Number(value, where, name); return;
                    case "vy": o.Vy = Number(value, where, name); return;
                    case "vz": o.Vz = Number(value, where, name); return;
                    case "w": o.W = Number(value, where, name); return;
                    case "h": o.H = Number(value, where, name); return;
                    case "d": o.D = Number(value, where, name); return;
                    case "angle": o.Angle = Number(value, where, name); return;
                    case "spin": o.Spin = Number(value, where, name); return;
                    case "life": o.Life = value.IsNil() ? double.PositiveInfinity : Number(value, where, name); return;
                    case "tag": o.Tag = OptName(value, where, name); return;
                    case "color": o.Color = ParseColor(value, where, name); return;
                    case "animation": o.Animation = OptName(value, where, name); return;
                    case "gravity": o.Gravity = value.CastToBool(); return;
                    case "solid": o.Solid = value.CastToBool(); return;
                    case "data":
                        if (value.Type != DataType.Table && !value.IsNil()) throw new ScriptRuntimeException(where + ": data must be a table.");
                        o.Data = value.Type == DataType.Table ? value.Table : null;
                        return;
                    case "alive":
                    case "id":
                    case "kind":
                        throw new ScriptRuntimeException(where + ": " + name + " is read only.");
                }
                if (methods.ContainsKey(name)) throw new ScriptRuntimeException(where + ": " + name + " is a method and cannot be replaced.");
            }
            DataOf(o).Set(key, value);
        }

        // ---- ui

        DynValue UiText(ScriptExecutionContext ctx, CallbackArguments a)
        {
            const string where = "ui.text";
            var id = UiId(a[0], where);
            if (a[1].Type != DataType.String && a[1].Type != DataType.Number) throw new ScriptRuntimeException(where + ": text must be a string or a number.");
            var text = a[1].CastToString();
            if (text.Length > MaxUiTextLength) throw new ScriptRuntimeException(where + ": text is too long (over " + MaxUiTextLength + " characters).");
            var element = UiFor(id, false);
            if (element == null) return DynValue.Nil;
            element.Text = text;
            ReadUiOptions(element, a[2], where);
            return DynValue.Nil;
        }

        DynValue UiBar(ScriptExecutionContext ctx, CallbackArguments a)
        {
            const string where = "ui.bar";
            var id = UiId(a[0], where);
            var value = Number(a[1], where, "value");
            var max = a[2].IsNil() ? 1.0 : Number(a[2], where, "max");
            var element = UiFor(id, true);
            if (element == null) return DynValue.Nil;
            element.Value = value;
            element.Max = max > 0 ? max : 1;
            ReadUiOptions(element, a[3], where);
            return DynValue.Nil;
        }

        DynValue UiClear(ScriptExecutionContext ctx, CallbackArguments a)
        {
            if (a[0].IsNil()) Ui.Clear();
            else
            {
                var id = UiId(a[0], "ui.clear");
                Ui.RemoveAll(e => e.Id == id);
            }
            return DynValue.Nil;
        }

        static string UiId(DynValue v, string where)
        {
            if (v.Type != DataType.String && v.Type != DataType.Number) throw new ScriptRuntimeException(where + ": id must be a string or a number.");
            var id = v.CastToString();
            if (id.Length > MaxNameLength) throw new ScriptRuntimeException(where + ": id is too long.");
            return id;
        }

        UiElement UiFor(string id, bool bar)
        {
            var element = Ui.Find(e => e.Id == id);
            if (element == null)
            {
                if (Ui.Count >= MaxUiElements)
                {
                    DroppedUiElements++;
                    return null;
                }
                element = new UiElement { Id = id, IsBar = bar };
                if (bar) element.Y = 0.1;
                Ui.Add(element);
            }
            element.IsBar = bar;
            return element;
        }

        void ReadUiOptions(UiElement e, DynValue options, string where)
        {
            if (options.IsNil()) return;
            if (options.Type != DataType.Table) throw new ScriptRuntimeException(where + ": the last argument must be a table of options.");
            var t = options.Table;
            OptNumber(t, "x", where, ref e.X);
            OptNumber(t, "y", where, ref e.Y);
            OptNumber(t, "size", where, ref e.Size);
            OptNumber(t, "w", where, ref e.W);
            OptNumber(t, "h", where, ref e.H);
            var color = t.Get("color");
            if (!color.IsNil()) e.Color = ParseColor(color, where, "color");
            var align = t.Get("align");
            if (!align.IsNil())
            {
                if (align.Type != DataType.String || Array.IndexOf(Aligns, align.String) < 0) throw new ScriptRuntimeException(where + ": align must be \"left\", \"center\" or \"right\".");
                e.Align = align.String;
            }
        }

        // ---- timers

        DynValue AddTimer(CallbackArguments a, bool repeats)
        {
            var where = repeats ? "timer.every" : "timer.after";
            var seconds = Number(a[0], where, "seconds");
            if (seconds < 0) throw new ScriptRuntimeException(where + ": seconds must not be negative.");
            if (a[1].Type != DataType.Function) throw new ScriptRuntimeException(where + ": the second argument must be a function.");
            timers.RemoveAll(t => t.Cancelled);
            if (timers.Count >= MaxTimers)
            {
                DroppedTimers++;
                return DynValue.NewNumber(0);
            }
            var interval = Math.Max(seconds, MinInterval);
            var timer = new ScriptTimer { Id = nextTimerId++, Due = world.Time + (repeats ? interval : seconds), Interval = interval, Repeats = repeats, Function = a[1] };
            timers.Add(timer);
            return DynValue.NewNumber(timer.Id);
        }

        DynValue CancelTimer(ScriptExecutionContext ctx, CallbackArguments a)
        {
            var id = Number(a[0], "timer.cancel", "id");
            foreach (var t in timers)
                if (t.Id == id) t.Cancelled = true;
            return DynValue.Nil;
        }

        // ---- random: xorshift32, seeded, so the same game plays the same

        double NextRandom()
        {
            var x = randState;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            randState = x;
            return (x >> 8) / 16777216.0;
        }

        DynValue RandInt(ScriptExecutionContext ctx, CallbackArguments a)
        {
            var lo = Math.Floor(Number(a[0], "rand_int", "a"));
            var hi = Math.Floor(Number(a[1], "rand_int", "b"));
            if (lo > hi)
            {
                var swap = lo;
                lo = hi;
                hi = swap;
            }
            var range = hi - lo + 1;
            if (range > 2147483647) throw new ScriptRuntimeException("rand_int: the range is too large.");
            return DynValue.NewNumber(lo + Math.Floor(NextRandom() * range));
        }

        // ---- argument checks

        static double Number(DynValue v, string where, string name)
        {
            if (v.Type != DataType.Number) throw new ScriptRuntimeException(where + ": " + name + " must be a number.");
            return v.Number;
        }

        static void OptNumber(Table t, string key, string where, ref double target)
        {
            var v = t.Get(key);
            if (v.IsNil()) return;
            target = Number(v, where, key);
        }

        /// <summary>A short string, or null when the value is nil (or not a string, for callers that test for it).</summary>
        static string Name(DynValue v, string where, string name)
        {
            if (v.Type == DataType.String)
            {
                if (v.String.Length > MaxNameLength) throw new ScriptRuntimeException(where + ": " + name + " is too long (over " + MaxNameLength + " characters).");
                return v.String;
            }
            return null;
        }

        static string OptName(DynValue v, string where, string name)
        {
            if (v.IsNil()) return null;
            var s = Name(v, where, name);
            if (s == null) throw new ScriptRuntimeException(where + ": " + name + " must be a string.");
            return s;
        }

        /// <summary>A palette slot (1 to 5, as a number or text) or "#rrggbb", kept as text; nil clears it.</summary>
        static string ParseColor(DynValue v, string where, string name)
        {
            if (v.IsNil()) return null;
            if (v.Type == DataType.Number && v.Number >= 1 && v.Number <= 5 && Math.Floor(v.Number) == v.Number) return ((int)v.Number).ToString();
            if (v.Type == DataType.String)
            {
                if (Hex.IsMatch(v.String)) return v.String.ToLowerInvariant();
                if (v.String.Length == 1 && v.String[0] >= '1' && v.String[0] <= '5') return v.String;
            }
            throw new ScriptRuntimeException(where + ": " + name + " must be a palette slot from 1 to 5 or a text like \"#ff8800\".");
        }
    }
}
