using System;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using Runner.Scripting;
using UnityEngine;

namespace Runner.Tests
{
    /// <summary>
    /// Plays the scripts the live prompt check wrote (web/.live-scripts/*.lua, git-ignored): each for a minute of game time with random pointer input,
    /// and reports for each whether it started, whether it ended by itself, and the error it stopped with. It does nothing when there are none.
    /// </summary>
    public class LiveScriptsTests
    {
        [Test]
        public void EachWrittenScriptRunsWithRandomInput()
        {
            var dir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", ".live-scripts"));
            if (!Directory.Exists(dir)) Assert.Ignore("no live scripts");
            var report = new StringBuilder("LIVE SCRIPTS\n");
            var failures = 0;
            foreach (var file in Directory.GetFiles(dir, "*.lua").OrderBy(f => f))
            {
                var runner = new ScriptRunner(File.ReadAllText(file), 7);
                var random = new System.Random(5);
                var started = runner.Start();
                var frames = 0;
                var down = false;
                while (started && frames < 3600 && !runner.Over && !runner.Failed)
                {
                    if (random.NextDouble() < 0.15) down = !down;
                    runner.Step(1.0 / 60.0, new PointerState(random.NextDouble() * 9 - 4.5, random.NextDouble() * 16 - 8, down));
                    frames++;
                }
                var verdict = runner.Failed ? "ERROR: " + runner.Error : runner.Over ? "ended: " + runner.Api.Outcome + " " + runner.Api.Message : "still running after " + frames + " frames";
                if (runner.Failed) failures++;
                report.Append(Path.GetFileName(file)).Append(" -> ").Append(verdict)
                    .Append(" | objects ").Append(runner.World.Count()).Append(", score ").Append(runner.Api.Score)
                    .Append(", ui ").Append(runner.Api.Ui.Count).Append(", camera ").Append(runner.Api.Camera.Mode)
                    .Append(", dropped spawns ").Append(runner.World.DroppedSpawns).Append('\n');
            }
            File.WriteAllText(Path.Combine(dir, "report.txt"), report.ToString());
            Assert.AreEqual(0, failures, report.ToString());
        }
    }
}
