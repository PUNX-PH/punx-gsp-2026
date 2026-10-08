# Unity tools that need no Unity license

The Unity batch runs (EditMode and PlayMode tests, builds) need an active Hub sign-in. These scripts do not: they use the C# compiler and the .NET 6
runtime that ship inside the Editor folder (`.../Editor/Data`), so they run when the sign-in is missing. Pass the Editor's `Data` folder as the first
argument if Unity is not at the default path.

| Script | What it does |
|---|---|
| `engine-check.sh` | Compiles `Runtime/Engine/Pure` (the engine, pure C#) and replays the shared fixtures in `Assets/Runner/Tests/Engine`: every spec's state digests must equal the ones the TypeScript simulator recorded, and every bad spec must be refused with the web's sentence. Exit 0 and "all checks passed" when equal. |
| `compile-runtime.sh` | Compiles all of `Assets/Runner/Runtime` (the engine, its Unity view and the runner) against Unity's assemblies and the project's last compile (`Library/ScriptAssemblies`). Finds compile errors; runs nothing, compiles no shaders. |

The fixtures are recorded from the TypeScript side: after a change to the engine's semantics, change `docs/superpowers/notes/engine-semantics.md`, both
implementations, and run `UPDATE_ENGINE_FIXTURES=1 npx vitest run src/lib/engine/fixtures.test.ts` from `web/` (it rewrites the fixtures and the Unity
copy), then `engine-check.sh`.

Not covered without Unity: the shaders, PlayMode tests, the NUnit files (they compile only inside Unity), `.meta` files for new files (Unity writes
them on its next run; commit them with the files), and the WebGL build.
