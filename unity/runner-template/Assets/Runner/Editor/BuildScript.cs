using System;
using System.IO;
using System.Linq;
using Runner.View;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Runner.EditorTools
{
    /// <summary>
    /// Batch-mode WebGL builds: one for desktop (DXT textures) and one for mobile (ASTC). Run through
    /// tools/build-webgl.ps1, which starts the Editor with -buildTarget WebGL. Builds go to Builds/ at the
    /// repository root.
    /// </summary>
    public static class BuildScript
    {
        const string ScenePath = "Assets/Scenes/Main.unity";
        const long BudgetBytes = 15000000;

        public static void BuildWebGL() => BuildTargets(desktop: true, mobile: true);
        public static void BuildDesktop() => BuildTargets(desktop: true, mobile: false);
        public static void BuildMobile() => BuildTargets(desktop: false, mobile: true);

        // A development player prints more diagnostics to the browser console. Not for shipping.
        public static void BuildDesktopDevelopment()
        {
            Configure();
            Build(Path.Combine(BuildsRoot(), "runner-desktop-dev"), WebGLTextureSubtarget.DXT, BuildOptions.Development);
        }

        static void BuildTargets(bool desktop, bool mobile)
        {
            Configure();

            var builds = BuildsRoot();
            var desktopPath = Path.Combine(builds, "runner-desktop");
            var mobilePath = Path.Combine(builds, "runner-mobile");
            if (desktop) Build(desktopPath, WebGLTextureSubtarget.DXT, BuildOptions.None);
            if (mobile) Build(mobilePath, WebGLTextureSubtarget.ASTC, BuildOptions.None);

            // A target that was not built this time reports whatever is on disk (0 if nothing).
            var desktopBytes = SizeOf(desktopPath);
            var mobileBytes = SizeOf(mobilePath);
            File.WriteAllText(Path.Combine(builds, "size-report.json"),
                "{\"desktopBytes\":" + desktopBytes + ",\"mobileBytes\":" + mobileBytes + "}");
            Debug.Log("Runner build sizes: desktop " + desktopBytes + " bytes, mobile " + mobileBytes + " bytes (budget " + BudgetBytes + ")");

            if (desktopBytes > BudgetBytes || mobileBytes > BudgetBytes)
                throw new Exception("A build is over the " + BudgetBytes + " byte budget; see Builds/size-report.json");
        }

        /// <summary>What a Windows or Android player needs before it is built (BuildPlayers): the bootstrap scene and the shaders. The player reads its game from StreamingAssets/game.</summary>
        internal static void PreparePlayer()
        {
            EnsureScene();
            EnsureShadersIncluded("Runner/Flat", "Runner/Lit", "Runner/Sky", "Runner/BlobShadow");
            PlayerSettings.SplashScreen.show = false;
        }

        internal const string PlayerScenePath = ScenePath;

        // Application.dataPath is <repo>/unity/runner-template/Assets
        internal static string PlayersRoot() => BuildsRoot();

        static string BuildsRoot() => Path.GetFullPath(Path.Combine(Application.dataPath, "../../../Builds"));

        static void Configure()
        {
            EnsureScene();
            EnsureShadersIncluded("Runner/Flat", "Runner/Lit", "Runner/Sky", "Runner/BlobShadow");

            PlayerSettings.WebGL.template = "PROJECT:Runner"; // our own page around the canvas (Assets/WebGLTemplates/Runner): no Unity logo or footer, the game fills the frame
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
            PlayerSettings.WebGL.decompressionFallback = true; // any static server can host the build
            // Disk size without link-time optimization: LTO took over 14 minutes just to link, per target.
            UnityEditor.WebGL.UserBuildSettings.codeOptimization = UnityEditor.WebGL.WasmCodeOptimization.DiskSize;
            PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.High);
            PlayerSettings.SplashScreen.show = false; // no multi-second splash before a ~1 minute game
        }

        // The scene is only the bootstrap object. Scene-referenced materials made level 0 unreadable in WebGL builds, so the
        // flat shader is shipped through Always Included Shaders instead and the bootstrap makes its material at runtime.
        static void EnsureScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("Runner").AddComponent<RunnerBootstrap>();
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.Refresh();
        }

        // The shaders are found by name at runtime, so nothing in the scene references them: each is shipped through Always Included Shaders.
        static void EnsureShadersIncluded(params string[] names)
        {
            var graphics = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset")[0]);
            var included = graphics.FindProperty("m_AlwaysIncludedShaders");
            foreach (var name in names)
            {
                var shader = Shader.Find(name);
                if (shader == null) throw new Exception("Shader " + name + " not found; is it in Assets/Runner/Shaders and imported?");

                var found = false;
                for (var i = 0; i < included.arraySize && !found; i++)
                    found = included.GetArrayElementAtIndex(i).objectReferenceValue == shader;
                if (found) continue;

                included.arraySize++;
                included.GetArrayElementAtIndex(included.arraySize - 1).objectReferenceValue = shader;
            }
            graphics.ApplyModifiedPropertiesWithoutUndo();
        }

        // The template only: runs/ holds per-game content that people copy in for testing.
        static long SizeOf(string folder)
        {
            if (!Directory.Exists(folder)) return 0;
            var runs = Path.Combine(folder, "runs") + Path.DirectorySeparatorChar;
            return new DirectoryInfo(folder).EnumerateFiles("*", SearchOption.AllDirectories)
                .Where(f => !f.FullName.StartsWith(runs, StringComparison.OrdinalIgnoreCase))
                .Sum(f => f.Length);
        }

        static void Build(string outputPath, WebGLTextureSubtarget textures, BuildOptions buildOptions)
        {
            if (Directory.Exists(outputPath)) Directory.Delete(outputPath, true);

            // The Editor remembers the last texture format (ASTC after a mobile build).
            EditorUserBuildSettings.webGLBuildSubtarget = textures;

            // Bee keeps the list of files to bundle into the data file in webgl.data_*.info and does not rewrite it
            // when only the texture subtarget changed. A desktop build after a mobile one then bundled the mobile
            // data (ASTC textures, scripts of packages since removed) next to freshly built code, which showed up as
            // missing scripts, magenta models and a minute-long first frame. Delete the list so it is regenerated.
            foreach (var stale in DataListFiles()) File.Delete(stale);

            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = outputPath,
                target = BuildTarget.WebGL,
                options = buildOptions,
                subtarget = (int)textures
            };
            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != BuildResult.Succeeded)
                throw new Exception("WebGL build (" + textures + ") " + report.summary.result + " with " + report.summary.totalErrors + " errors");

            // Fail loudly rather than ship the wrong textures again.
            var expected = "PlayerDataCache/WebGL" + (int)textures + "/";
            var lists = DataListFiles();
            if (lists.Length == 0)
                throw new Exception("Cannot check which data the " + textures + " build bundled: no webgl.data_*.info under Library/Bee/artifacts/csharpactions");
            foreach (var list in lists)
                if (!File.ReadAllText(list).Contains(expected))
                    throw new Exception("The " + textures + " build bundled data from the wrong texture cache (" + Path.GetFileName(list) + " does not list " + expected + ")");
        }

        // Application.dataPath is <project>/Assets
        static string[] DataListFiles()
        {
            var folder = Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/Bee/artifacts/csharpactions"));
            return Directory.Exists(folder) ? Directory.GetFiles(folder, "webgl.data_*.info") : new string[0];
        }
    }
}
