# Slice 8 handoff: Lua games (written 2026-10-09)

## What this slice is

Claude writes a whole game as one **Lua script**; the pre-built Unity player runs it in a sandboxed interpreter (MoonSharp, vendored). No limit on the genre, 2D or 3D. The script never
runs on a server: only inside the player, on the person's device. Spec: `specs/2026-10-08-lua-games-design.md`. Plan: `plans/2026-10-09-slice8-lua-games.md`. Branch
`slice-8-lua-games` (not pushed or merged when this was written). The ledger of every task is `.superpowers/sdd/2026-10-09-slice8-lua-games/progress.md` (git-ignored, local).

## Progress at a glance

Built and committed: Tasks 1 to 16, and the corpus (Task 17, without the golden pins for the platformer and the timing game). Skipped on the owner's word: the live prompt check
(Task 18; the tool is there, `web/src/lib/script/tryPrompt.live.test.ts`, off unless `LIVE_PROMPT=1`), the mutation checks of the corpus, and the whole-branch review (Task 24).
Verification was kept to compile checks plus full runs at milestones (EditMode 321, PlayMode 28, web 2126 tests, packager 16). A UI refresh of the pages around the editor came
with it (sign-in, Games, Runs).

## Where to look

| What | Where |
|---|---|
| The one table of the script API, limits, removed names, field rules | `web/src/lib/script/api.ts` (the prompt and the checks are built from it) |
| The script check (size, syntax, removed names, a callback to run) | `web/src/lib/script/check.ts` (luaparse 0.3.1, parse only) |
| The prompt, answer schema (script, palette, leftOut, assets), author | `web/src/lib/script/{prompts,author}.ts` |
| The service: one retry, cache (`gameScripts`), Try again as an `attempt` number | `web/src/lib/script/{service,keys,server}.ts` |
| Example games (also the prompt's three examples) | `unity/.../Tests/Scripts/*.lua`, copied to `web/src/lib/script/examples.ts` by `web/tools/gen-script-examples.mjs` |
| Sandboxed host, instruction budget, string caps | `unity/.../Runtime/Script/Pure/ScriptHost.cs` |
| World (movement, gravity, solid overlaps, exits, caps), API tables, runner | `Runtime/Script/Pure/{ScriptWorld,GameApi,ScriptRunner}.cs` |
| View (cameras, pointer to field, pooled objects) and HUD | `Runtime/Script/{ScriptView,ScriptHud}.cs` |
| Settings key `script { file, models }`, bootstrap switch | `Runtime/Script/Pure/ScriptSettings.cs`, `Runtime/View/RunnerBootstrap.cs` |
| Vendored MoonSharp (two patches recorded in its README) | `unity/.../ThirdParty/MoonSharp/` |
| Run service, packager and export for `game.lua` | `web/src/lib/runs/service.ts`, `packager/server.mjs`, `web/src/lib/export/service.ts` |

## Decisions worth keeping

- **Interpreter:** MoonSharp 2.0.0.0 in its hard sandbox preset, with the names `os io debug require load loadstring loadfile dofile collectgarbage coroutine setmetatable getmetatable luanet clr`
  set to nil, `math.random` removed (the game has its own seeded `rand()`), `pcall`, `rawget` and `rawset` absent by design. Every call runs as a coroutine that yields every 200 instructions;
  200,000 per frame is the budget. Strings are capped at 10,000 characters (patched concat, wrapped `string.rep` and `string.format`).
- **Stripping:** the WebGL build strips MoonSharp's reflection-registered library functions (`type` was nil) unless the assembly is preserved in `Assets/link.xml`. It is.
- **Objects** are empty Lua tables with one shared metatable; a field the script invents lands in `obj.data`. A dropped spawn (over 300 objects or 120 a second) returns a dead stand-in object.
- **Coordinates:** the field is centered on 0, 0 (9 by 16 by default), y up. Side and fixed cameras see it head on (z is depth); top and chase see it as the ground (y away from the viewer, z height);
  side2d and top2d are orthographic. In 2D, objects are depth sorted: a smaller z is in front (the prompt says so).
- **Try again** is an `attempt` count in the cache key, not a flag. **The palette** is part of Claude's answer (the plan had none; Game Template needs five colors). **Make a game** is
  `script | rules | off`; a saved `true` is rules, `false` or nothing is off; new steps are Script.
- **No server playtest.** Only the player can run a script. A Lua error or a frame budget overrun stops the game with "The game stopped: <message> (line N)".
- Per-frame loops: a simple loop costs about 7 instructions an iteration, so keep them under about 25,000 iterations a frame.

## Unproven until it is live

Real Claude-written scripts (the live check was skipped: the pass rate of the first attempt is unknown); the Lua games on a phone (frame rate with many objects); the Android and Windows
players with a script game; Build for with `game.lua` (the packager needs redeploying); the new pages after a login (only sign-in was looked at in a browser).

## Blocked on the studio (in order; I ask before each)

1. "Push it" and "merge it into main" (pushing starts a production build). 2. Publish the WebGL template (`tools/publish-template.ps1`, committed files). 3. Redeploy the packager
(Cloud Shell, as in the slice 7 handoff), then upload the rebuilt players from `Builds/upload` to `gs://punx-gsp-players`. 4. Describe a game on the live site, play it in Preview,
Build for Windows and Android, and try it on a phone. 5. Then `slice8-results.md`.

## Deferred (not done)

The platformer and timing examples have no pinned golden results (the platformer's bot never finished); the whole-branch review; the mutation check of the corpus; a visual check of the
signed-in pages and of the editor itself (the owner said the UI "sucks" and the editor canvas was not touched).
