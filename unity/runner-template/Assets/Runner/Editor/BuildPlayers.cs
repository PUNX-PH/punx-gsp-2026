using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Runner.EditorTools
{
    /// <summary>
    /// Batch-mode builds of the two players the packager adds a game to: Windows (Builds/player-windows) and Android (Builds/player-android). They are the
    /// same bootstrap as the WebGL player, built for those platforms; with no ?settings= address they read the game the packager put in StreamingAssets/game.
    /// Run through tools/build-players.ps1 (Unity needs its Windows and Android build support installed, and a signed-in Hub). The Android build is an APK,
    /// signed with Unity's debug key: the packager removes that signature and signs with the studio's own key. No keystore is ever put in the project.
    /// </summary>
    public static class BuildPlayers
    {
        public static void BuildWindows()
        {
            BuildScript.PreparePlayer();
            Build(BuildTarget.StandaloneWindows64, NamedBuildTarget.Standalone, Path.Combine(BuildScript.PlayersRoot(), "player-windows", "Runner.exe"));
        }

        public static void BuildAndroid()
        {
            BuildScript.PreparePlayer();
            EditorUserBuildSettings.buildAppBundle = false; // an APK: the packager edits and signs an APK, not a bundle
            PlayerSettings.Android.useCustomKeystore = false;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            Build(BuildTarget.Android, NamedBuildTarget.Android, Path.Combine(BuildScript.PlayersRoot(), "player-android", "Runner.apk"));
        }

        static void Build(BuildTarget target, NamedBuildTarget group, string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { BuildScript.PlayerScenePath },
                locationPathName = path,
                target = target,
                targetGroup = BuildPipeline.GetBuildTargetGroup(target),
                options = BuildOptions.None,
            });
            if (report.summary.result != BuildResult.Succeeded) throw new Exception("The " + target + " player did not build: " + report.summary.result);
            Debug.Log("Runner player built: " + path + " (" + report.summary.totalSize + " bytes)");
            _ = group;
        }
    }
}
