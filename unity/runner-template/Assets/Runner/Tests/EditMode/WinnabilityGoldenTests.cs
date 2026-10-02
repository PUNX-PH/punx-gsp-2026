using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using NUnit.Framework;
using Runner.Settings;
using Runner.Sim;
using UnityEngine;

namespace Runner.Tests
{
    /// <summary>
    /// Winnability decides, for about two million tunings, whether a game can be won. The web app's settings validator
    /// must decide every one of them the same way, or it would store a run that this player then refuses. Both sides
    /// reproduce the fingerprint in fixtures/settings/winnability-grid.txt; this side is the reference that made it.
    /// </summary>
    public class WinnabilityGoldenTests
    {
        // Application.dataPath is <repo>/unity/runner-template/Assets, so the repo root is three levels up.
        static string GoldenPath =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "../../../fixtures/settings/winnability-grid.txt"));

        // Decimal text, like the numbers in a settings file, so each side parses it to the nearest float itself.
        static string Hundredths(int h) => (h / 100) + "." + (h % 100).ToString("00", CultureInfo.InvariantCulture);
        static string Halves(int d) => (d / 2) + (d % 2 == 0 ? ".0" : ".5");
        static float Parse(string text) => float.Parse(text, CultureInfo.InvariantCulture);

        // speed 1.00 to 20.00 step 0.05 (outermost), jumpHeight 1.50 to 5.00 step 0.05, spacing 4.0 to 40.0 step 0.5.
        static (string sha256, int accepted, int points) Fingerprint() => Decide().fingerprint;

        static ((string sha256, int accepted, int points) fingerprint, string bits) Decide()
        {
            var bits = new StringBuilder();
            var accepted = 0;
            for (var s = 20; s <= 400; s++)
                for (var j = 30; j <= 100; j++)
                    for (var d = 8; d <= 80; d++)
                    {
                        var tuning = new Tuning
                        {
                            speed = Parse(Hundredths(s * 5)),
                            jumpHeight = Parse(Hundredths(j * 5)),
                            obstacleSpacing = Parse(Halves(d)),
                        };
                        var playable = Winnability.Check(tuning) == null;
                        bits.Append(playable ? '1' : '0');
                        if (playable) accepted++;
                    }

            using (var sha = SHA256.Create())
            {
                var hash = BitConverter.ToString(sha.ComputeHash(Encoding.ASCII.GetBytes(bits.ToString()))).Replace("-", "").ToLowerInvariant();
                return ((hash, accepted, bits.Length), bits.ToString());
            }
        }

        static string ValueOf(string[] lines, string key)
        {
            foreach (var line in lines)
                if (line.StartsWith(key + ": ", StringComparison.Ordinal)) return line.Substring(key.Length + 2).Trim();
            throw new InvalidOperationException(GoldenPath + " has no '" + key + ":' line");
        }

        [Test]
        public void Playable_grid_matches_the_shared_golden_file()
        {
            var lines = File.ReadAllLines(GoldenPath);
            var (sha256, accepted, points) = Fingerprint();

            Assert.AreEqual(ValueOf(lines, "points"), points.ToString(CultureInfo.InvariantCulture), "number of points");
            Assert.AreEqual(ValueOf(lines, "accepted"), accepted.ToString(CultureInfo.InvariantCulture), "number of playable tunings");
            Assert.AreEqual(ValueOf(lines, "sha256"), sha256, "fingerprint of which tunings are playable");
        }

        [Test, Explicit("For debugging a disagreement: writes one 0 or 1 per grid point to Builds/winnability-bits-unity.txt, to diff against the web app's.")]
        public void Write_the_grid_decisions_for_diffing()
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../Builds/winnability-bits-unity.txt"));
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, Decide().bits);
        }

        [Test, Explicit("Rewrites fixtures/settings/winnability-grid.txt from this implementation. Run it only when the rule changes on purpose.")]
        public void Regenerate_the_golden_file()
        {
            var (sha256, accepted, points) = Fingerprint();
            File.WriteAllText(GoldenPath, string.Join("\n",
                "# Which tunings are playable, as decided by the Unity template's Winnability.Check.",
                "# The web app's validator (web/src/lib/settings.test.ts) and WinnabilityGoldenTests.cs must both reproduce it.",
                "# Grid: speed 1.00 to 20.00 step 0.05 (outermost), jumpHeight 1.50 to 5.00 step 0.05, obstacleSpacing 4.0 to 40.0 step 0.5",
                "# (innermost), each value parsed from its decimal text. The fingerprint is the SHA-256 of one character per point, in that",
                "# order: 1 if the tuning is playable, 0 if not.",
                "points: " + points.ToString(CultureInfo.InvariantCulture),
                "accepted: " + accepted.ToString(CultureInfo.InvariantCulture),
                "sha256: " + sha256,
                ""));
        }
    }
}
