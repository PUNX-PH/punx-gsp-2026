using System;
using System.Collections.Generic;
using System.IO;
using Runner.Engine;

/// <summary>
/// Replays the shared engine fixtures against the C# engine, with no Unity: every spec must parse, every checkpoint digest must equal the one the
/// TypeScript simulator recorded, and every bad spec must be refused with the same sentence. Exit code 0 only when everything matches.
/// </summary>
public static class Program
{
    static int failures;

    static void Fail(string message)
    {
        failures++;
        Console.WriteLine("FAIL  " + message);
    }

    public static int Main(string[] args)
    {
        var dir = args.Length > 0 ? args[0] : ".";
        if (!MiniJson.TryParse(File.ReadAllText(Path.Combine(dir, "expected.json")), out var expectedRoot, out var e1)) { Console.WriteLine("expected.json: " + e1); return 2; }
        var expected = (JsonObject)expectedRoot;

        var specs = new List<string>(Directory.GetFiles(Path.Combine(dir, "specs"), "*.json"));
        specs.Sort(StringComparer.Ordinal);
        foreach (var path in specs)
        {
            var name = Path.GetFileNameWithoutExtension(path);
            if (!SpecParser.TryParse(File.ReadAllText(path), out var spec, out var error)) { Fail(name + ": the spec was refused: " + error); continue; }
            if (!InputLog.TryParse(File.ReadAllText(Path.Combine(dir, "logs", name + ".json")), out var log)) { Fail(name + ": the log could not be read"); continue; }
            var states = Digest.Replay(spec, log);
            var want = (List<object>)expected.Get(name);
            if (want == null || want.Count != states.Count) { Fail(name + ": " + states.Count + " checkpoints, expected " + (want == null ? 0 : want.Count)); continue; }
            var bad = 0;
            for (var i = 0; i < states.Count; i++)
            {
                var w = (JsonObject)want[i];
                var digest = Digest.Of(states[i]);
                if ((long)(double)w.Get("step") != states[i].Step || (string)w.Get("digest") != digest)
                {
                    if (bad++ == 0) Fail(name + ": checkpoint " + i + " differs\n  want " + (string)w.Get("digest") + "\n  got  " + digest);
                }
            }
            if (bad == 0) Console.WriteLine("ok    " + name + " (" + states.Count + " checkpoints)");
        }

        MiniJson.TryParse(File.ReadAllText(Path.Combine(dir, "bad-specs.json")), out var badRoot, out _);
        foreach (var c in (List<object>)badRoot)
        {
            var co = (JsonObject)c;
            var name = (string)co.Get("name");
            if (SpecParser.TryParse((string)co.Get("text"), out _, out var error)) { Fail("bad spec \"" + name + "\" was accepted"); continue; }
            if (error != (string)co.Get("error")) Fail("bad spec \"" + name + "\"\n  want " + (string)co.Get("error") + "\n  got  " + error);
        }
        if (failures == 0) Console.WriteLine("ok    " + ((List<object>)badRoot).Count + " bad specs refused with the web's sentences");

        Console.WriteLine(failures == 0 ? "all checks passed" : failures + " checks failed");
        return failures == 0 ? 0 : 1;
    }
}
