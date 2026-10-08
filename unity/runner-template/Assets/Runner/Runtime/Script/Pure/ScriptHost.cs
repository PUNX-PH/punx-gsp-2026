using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using MoonSharp.Interpreter;

namespace Runner.Scripting
{
    /// <summary>The numbers that keep a generated script from hanging or flooding the player (docs/superpowers/specs/2026-10-08-lua-games-design.md).</summary>
    public sealed class ScriptLimits
    {
        public long InstructionsPerFrame = 200000;
        public int MaxStringLength = 10000;
        public long MemoryBytes = 64L * 1024 * 1024;
    }

    /// <summary>
    /// Runs one game script in a MoonSharp interpreter that can touch nothing but what the game API binds. The standard libraries are MoonSharp's hard
    /// sandbox (no os, io, debug, metatables, coroutines, loading), the names that are still reachable by habit are set to nil, <c>math.random</c> is gone
    /// (the game has its own seeded one), strings cannot be made huge, and every call to the script runs as a coroutine that yields every few hundred
    /// instructions so that a script that never ends is stopped at its budget. Pure C#: no Unity types.
    /// </summary>
    public sealed class ScriptHost
    {
        public const string OverBudget = "The game used too much time in one frame (over its instruction budget).";
        public const string OutOfMemory = "The game used too much memory.";
        const long YieldEvery = 200;
        const int MaxLogEntries = 200;
        const int MaxLogLength = 200;

        static readonly string[] Removed =
        {
            "os", "io", "debug", "require", "load", "loadsafe", "loadstring", "loadfile", "dofile", "collectgarbage", "coroutine",
            "setmetatable", "getmetatable", "luanet", "clr", "UnityEngine", "System",
        };

        static readonly Regex Where = new Regex(@"^[^:]*:\((\d+),[^)]*\):\s*(.*)$", RegexOptions.Singleline);
        static readonly Regex WideFormat = new Regex(@"%[-+ #0]*\d{3,}");

        readonly Script script;
        readonly ScriptLimits limits;
        long memoryBaseline;

        /// <summary>What the script printed (the developer log), at most 200 lines of 200 characters.</summary>
        public readonly List<string> Log = new List<string>();

        /// <summary>The instructions the last call ran, rounded to the yield step.</summary>
        public long InstructionsLastCall { get; private set; }

        /// <summary>The interpreter, for the game API to bind its tables and functions to.</summary>
        public Script Lua => script;

        public ScriptHost(ScriptLimits limits = null)
        {
            this.limits = limits ?? new ScriptLimits();
            script = new Script(CoreModules.Preset_HardSandbox);
            script.Options.DebugPrint = AddLog;
            foreach (var name in Removed) script.Globals[name] = DynValue.Nil;

            var math = script.Globals.Get("math");
            if (math.Type == DataType.Table)
            {
                math.Table["random"] = DynValue.Nil;
                math.Table["randomseed"] = DynValue.Nil;
            }
            var str = script.Globals.Get("string");
            if (str.Type == DataType.Table)
            {
                var rep = str.Table.Get("rep");
                var format = str.Table.Get("format");
                if (IsCallable(rep)) str.Table["rep"] = DynValue.NewCallback((ctx, args) => Rep(rep, args));
                if (IsCallable(format)) str.Table["format"] = DynValue.NewCallback((ctx, args) => Format(format, args));
            }
        }

        // MoonSharp's own library functions are ClrFunction values, a script's own are Function values.
        static bool IsCallable(DynValue v) => v.Type == DataType.ClrFunction || v.Type == DataType.Function;

        void AddLog(string line)
        {
            if (Log.Count >= MaxLogEntries) return;
            Log.Add(line.Length > MaxLogLength ? line.Substring(0, MaxLogLength) : line);
        }

        DynValue Rep(DynValue original, CallbackArguments args)
        {
            if (args.Count >= 2 && args[0].Type == DataType.String && args[1].Type == DataType.Number)
            {
                var times = args[1].Number;
                if (times > 0 && args[0].String.Length * times > limits.MaxStringLength)
                    throw new ScriptRuntimeException("string too long (over " + limits.MaxStringLength + " characters)");
            }
            return script.Call(original, args.GetArray());
        }

        DynValue Format(DynValue original, CallbackArguments args)
        {
            if (args.Count >= 1 && args[0].Type == DataType.String && WideFormat.IsMatch(args[0].String))
                throw new ScriptRuntimeException("string too long (a format width of 100 or more)");
            return script.Call(original, args.GetArray());
        }

        /// <summary>Compiles and runs the script's top level (which defines its callbacks) under the budget. False with a sentence on any error.</summary>
        public bool Load(string source, out string error)
        {
            memoryBaseline = GC.GetTotalMemory(false);
            try
            {
                var chunk = script.LoadString(source, null, "game");
                return Run(chunk, new DynValue[0], out error);
            }
            catch (InterpreterException e)
            {
                error = Describe(e);
                return false;
            }
        }

        /// <summary>Whether the script defines a function by this global name.</summary>
        public bool Has(string name) => script.Globals.Get(name).Type == DataType.Function;

        /// <summary>
        /// Calls a global function of the script under the budget. A function the script does not define is not an error (true). False with a sentence
        /// when the script raises an error, runs over its budget or uses too much memory.
        /// </summary>
        public bool Call(string name, out string error, params object[] args)
        {
            var fn = script.Globals.Get(name);
            if (fn.Type != DataType.Function)
            {
                error = null;
                return true;
            }
            var values = new DynValue[args.Length];
            for (var i = 0; i < args.Length; i++) values[i] = DynValue.FromObject(script, args[i]);
            return Run(fn, values, out error);
        }

        /// <summary>Calls a Lua function value (a timer's callback, say) under the same budget as <see cref="Call"/>.</summary>
        public bool Invoke(DynValue function, out string error, params DynValue[] args) => Run(function, args, out error);

        /// <summary>A global of the script as text (for tests and the API), or null when it is not set.</summary>
        public string GetGlobalString(string name)
        {
            var v = script.Globals.Get(name);
            return v.IsNil() ? null : v.CastToString();
        }

        bool Run(DynValue function, DynValue[] args, out string error)
        {
            error = null;
            InstructionsLastCall = 0;
            try
            {
                var coroutine = script.CreateCoroutine(function).Coroutine;
                coroutine.AutoYieldCounter = YieldEvery;
                var maxYields = limits.InstructionsPerFrame / YieldEvery;
                long yields = 0;
                coroutine.Resume(args);
                while (coroutine.State != CoroutineState.Dead)
                {
                    yields++;
                    InstructionsLastCall = yields * YieldEvery;
                    if (yields > maxYields)
                    {
                        error = OverBudget;
                        return false;
                    }
                    if (OverMemory())
                    {
                        error = OutOfMemory;
                        return false;
                    }
                    coroutine.Resume();
                }
                InstructionsLastCall = Math.Max(InstructionsLastCall, yields * YieldEvery);
                if (OverMemory())
                {
                    error = OutOfMemory;
                    return false;
                }
                return true;
            }
            catch (InterpreterException e)
            {
                error = Describe(e);
                return false;
            }
        }

        // Garbage counts as memory until it is collected, so only a total over the limit is looked at again after a collection.
        bool OverMemory()
        {
            if (GC.GetTotalMemory(false) - memoryBaseline <= limits.MemoryBytes) return false;
            return GC.GetTotalMemory(true) - memoryBaseline > limits.MemoryBytes;
        }

        /// <summary>"message (line N)" from MoonSharp's decorated message ("game:(3,10-11): message"), or the message as it is.</summary>
        static string Describe(InterpreterException e)
        {
            var text = e.DecoratedMessage ?? e.Message ?? "unknown error";
            var m = Where.Match(text);
            return m.Success ? m.Groups[2].Value + " (line " + m.Groups[1].Value + ")" : text;
        }
    }
}
