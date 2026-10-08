# MoonSharp (vendored)

The Lua interpreter that runs a generated game's script inside the Unity player (slice 8: `docs/superpowers/specs/2026-10-08-lua-games-design.md`).

- **Source:** https://github.com/moonsharp-devs/moonsharp, tag `v2.0.0.0`, commit `3154416e535ab96c0d52bf12e3e472985a1532f4`, taken 2026-10-09.
- **Licence:** BSD-3-Clause, in `LICENSE` beside this file.
- **What is kept:** the `MoonSharp.Interpreter` project's `.cs` files, unmodified, except `_Projects`, `Properties` and the loader named below. It is pure C#, so IL2CPP, WebGL and Android builds carry it.
- **What is ours:** the sandbox, the instruction budget and the game API are in `Runtime/Script/` and never edit these files; a change to a file here is written in the list below.

## Changes to the vendored files

- `Interpreter/Platforms/PlatformAutoDetector.cs`: `GetDefaultScriptLoader` returns `InvalidScriptLoader` on Unity instead of `UnityAssetsScriptLoader` (not vendored: it reads Unity assets, and the sandbox must load no files).
- `Interpreter/Loaders/UnityAssetsScriptLoader.cs` is not included.
