# Slice 8: Games Written as Lua Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, executed **inline ("native", the user's standing choice)**: one session implements every task in order **without check-ins**, keeps a ledger at
> `.superpowers/sdd/2026-10-09-slice8-lua-games/progress.md` (git-ignored), then **one fresh whole-branch review** (Task 24) and one fix pass. Steps use checkbox (`- [ ]`) syntax. **Ask before any push, install, download or deploy.**
> Work on a new branch `slice-8-lua-games` from `main`.
>
> **Steps that need the studio** (ask first; if unavailable ledger `Task N: <step> deferred (needs the studio)` and carry on): the **Unity Hub sign-in is now done** (Unity Personal, batch runs work: `tools/run-tests.ps1`); **never run two Unity processes at once** (a WebGL
> build and a test run lock the project); the funded Anthropic key (set); **permission to vendor MoonSharp** (Task 1: a third-party download) and **to add the Lua parser npm package** (Task 11); a phone (Task 23); any push to `main` (Task 23).

**Goal:** A creator describes any game in words and Claude writes it as a Lua script that a sandboxed interpreter inside the pre-built Unity player runs, in 2D or 3D, for WebGL, Windows and Android, with Claude-made models.

**Architecture:** MoonSharp (pure-C# Lua) is vendored into the Unity project. `Runtime/Script/Pure/` (no `UnityEngine`) holds the host (sandbox, instruction budget, errors), the game API tables and the script world (objects, collisions, gravity, timers); `ScriptView` draws it. The web side adds a script author (small structured output: script text, left-out note, asset requests),
a server check (size, syntax, forbidden names, required callback), one retry, the cache, and a third `makeGame` mode. Settings carry `script: { file, models }`; the run holds `game.lua` and the entity models. Slice 7's rules engine stays as the `rules` mode.

**Tech Stack:** TypeScript, Next.js 16, Vitest, `@anthropic-ai/sdk` (installed), one Lua parser package (Task 11); Unity 6000.3.25f1, MoonSharp 2.x source (BSD-3-Clause), NUnit EditMode and PlayMode; the packager (Node).

**Spec:** `docs/superpowers/specs/2026-10-08-lua-games-design.md` (approved 2026-10-09).

## Global Constraints

- Script: file `game.lua`, at most **65,536** bytes, valid UTF-8 with no NUL. Callbacks: `init`, `update(dt)`, `on_tap(x,y)`, `on_hold(x,y)`, `on_release(x,y)`, `on_drag(x,y,dx,dy)`, `on_collide(a,b)`, `on_exit(obj)`; at least one of `init`, `update`, `on_tap`, `on_drag` required.
- Tables and names exactly as the spec lists: `game`, `world`, `input`, `ui`, `timer`, `rand`, `rand_int`, `print`; camera modes `side top chase fixed side2d top2d`; kinds `box sphere capsule cylinder cone plane quad` or an asset name; palette slots 1 to 5.
- Removed from the sandbox: `os io debug require load loadstring dofile collectgarbage coroutine`, `setmetatable` on globals, `math.random`. MoonSharp's hard sandbox preset is the base.
- Limits: **200,000** instructions per frame; objects alive **300**; spawns per second **120**; timers **50**; ui elements **24**; strings **2,000** characters; a frame over **250 ms** three times in a row stops the game. Any Lua error stops the game with "The game stopped: MESSAGE (line N)".
- Assets: names `^[a-z][a-zA-Z0-9]{0,15}$`, at most **6**, built by slice 7's `designEntityAssets`; a model with no file is a box. Run files: `game.lua`, `entity-NAME.glb`.
- `makeGame` is `"script" | "rules" | "off"`; a saved `true` means rules, `false` means off, new steps default to `script`. Cache key: SHA-256 of canonical JSON of `[SCRIPT_VERSION, "script", model, uid, description, pictureSha, sortedModelNames]`, `SCRIPT_VERSION = 1`; **Try again** skips the cache once.
- Failure sentences start with "Describe Game: "; limits and give-back rules as slice 7; the AI schema stays **tiny** (the API refused a large one).
- Generated code runs only in the player's sandbox on the player's machine, never on a server; no secrets reach any script.

## Review Focus

1. A script that loops forever, allocates without end, or spawns without end: stopped by the limits with a plain message, the page survives. (Tasks 3, 5)
2. A script that reaches for `os`, `io`, `require`, `load`, `debug`, the metatable of globals, or Unity or CLR types through reflection: refused or nil, never executed. (Tasks 2, 3)
3. A script with an error in the first second, in a callback, or in a timer: the game stops with the message and line, the player does not crash. (Tasks 5, 9)
4. Claude's answer that is not valid Lua, uses removed names, has no callback, or is over 64 KiB: one retry with the reason, then a plain message; counts kept as slice 7. (Tasks 11, 13)
5. Old settings, runner games and slice 7 rules games: play exactly as before. (Tasks 14, 15)

---

## Milestone A: the spike (Unity)

### Task 1: Vendor MoonSharp
**Files:** Create `unity/runner-template/Assets/Runner/ThirdParty/MoonSharp/` (the `MoonSharp.Interpreter` source, its LICENSE, a `README.md` saying source, version and date), an asmdef `MoonSharp.asmdef`; Modify `Runner.Runtime.asmdef` references.
- [ ] **Ask first** (a third-party download: name the source, the version and the size). Fetch the `MoonSharp.Interpreter` sources of release 2.0.0 from the project's GitHub repository, keep only what the interpreter needs (no debugger, no remote-debugging, no tests), record the commit.
- [ ] Verify the Runtime compiles (`bash unity/tools/compile-runtime.sh`, adding the new sources to its list) and `tools/run-tests.ps1 -Platform EditMode` still passes. Commit.

### Task 2: The sandboxed host
**Files:** Create `Runtime/Script/Pure/ScriptHost.cs`, `Tests/EditMode/ScriptSandboxTests.cs`
**Produces:** `sealed class ScriptHost { ScriptHost(ScriptLimits limits); bool Load(string source, out string error); bool CallIfDefined(string name, params object[] args, out string error); long InstructionsLastCall; }`; `ScriptLimits` with the numbers in Global Constraints.
- [ ] Tests: each removed name is `nil` or errors when used; `setmetatable(_G, ...)` errors; CLR access (`luanet`, `clr`, `UnityEngine`) is nil; `string.rep` of 10^9 is refused by the string cap; a `while true do end` in `update` returns `false` with "over its instruction budget" inside **0.5 s**; an error returns the message with a line number.
- [ ] Implement with `CoreModules.Preset_HardSandbox`, the removed names set to nil, a coroutine per call with `AutoYieldCounter = 1000` and a yield count limit giving 200,000 instructions. Commit.

### Task 3: WebGL and Android proof, the gate
- [ ] Add a boot hook `?selftest=lua` to `RunnerBootstrap` that runs a 10,000-iteration Lua loop and an infinite-loop script through the host and logs the times and results; build the WebGL desktop target (`tools/build-webgl.ps1 -Target desktop`), serve it (`tools/serve.ps1`), open it in the browser pane, and record: the loop time, the budget stop, the build size change, `RUNNER ready` time.
- [ ] Build the Android player once (`tools/build-players.ps1 -Platform android`) to prove the interpreter links under IL2CPP. **Gate:** if either fails, stop and rule: another pure-C# interpreter behind the same `ScriptHost` signature. Ledger the numbers. Remove the hook. Commit.

## Milestone B: the API, the world and the view

### Task 4: The script world
**Files:** Create `Runtime/Script/Pure/ScriptWorld.cs`, `ScriptObject.cs`, `Tests/EditMode/ScriptWorldTests.cs`
**Produces:** `ScriptWorld.Spawn(kind, props)`, `Step(dt, events)`, `Find(tag)`, `Count(tag)`, `Clear()`, `Gravity`, `Bounds`, collisions (box and circle, `solid` pairs, once per pair per step), `life`, `spin`, exits, caps (300 objects, 120 spawns a second).
- [ ] Tests: movement and gravity integrate; `life` expires; a solid pair raises one collision; an object leaving raises `on_exit`; the caps drop spawns silently and a counter says so; `destroy` is safe inside a callback.
- [ ] Implement. Commit.

### Task 5: The API tables
**Files:** Create `Runtime/Script/Pure/GameApi.cs`, `Tests/EditMode/GameApiTests.cs`
- [ ] One test per table entry in the spec (every function and field of `game world input ui timer` and the object methods, with argument checks): wrong types are Lua errors with the function's name; `rand()` is seeded and repeats; `timer.after/every/cancel` fire at the right frames and respect the 50 cap; `ui.text`, `ui.bar` and `ui.clear` keep at most 24 elements; strings over 2,000 characters are refused; `game.win` and `game.lose` end the game once.
- [ ] Implement binding MoonSharp userdata-free (plain tables and C# delegates, no reflection into CLR types). Instruction budget and frame-time stop (250 ms three frames) in `ScriptRunner` (`Step(dt, input)`): `init` once, then `update`, input callbacks, collisions, timers, exits, in that order. Commit.

### Task 6: Golden example games, three first
**Files:** Create `Tests/Scripts/{runner,flier,catcher}.lua`, `Tests/EditMode/ExampleGamesTests.cs`, `Tests/Scripts/expected.json`
- [ ] Write three small complete games using the API (a 3D lane runner, a 2D flier, a 2D catcher). Each test runs a game for N frames with scripted taps and asserts the end state and score (recorded once, reviewed by hand, then pinned). Mutation-check three lines of `ScriptWorld` as slice 7 did. Commit.

### Task 7: The view
**Files:** Create `Runtime/Script/ScriptView.cs`, `ScriptHud.cs`; Modify `Runtime/Engine/PrimitiveMeshes.cs` (add `quad`, `cone`, `plane`)
- [ ] Draw objects from loaded models or primitives in palette colors; camera modes `side top chase fixed` (perspective) and `side2d top2d` (orthographic, `quad` and sprite-less objects drawn as colored quads); `ui.text` and `ui.bar` over the scene; the end screen (win or lose with the message) and the error screen ("The game stopped: ..."). Reuse `EngineGame`'s loaded-model clone pool. Compile-check, commit.

### Task 8: The bootstrap switch
**Files:** Modify `Runtime/View/RunnerBootstrap.cs`, `Runtime/Settings/JsonKeys.cs`
**Consumes:** settings `script: { file: "game.lua", models: [names] }`.
- [ ] A `script` key reads `game.lua` next to the settings and `entity-NAME.glb` for each model name (missing or broken is a box); a `game` key plays the rules engine; neither plays the runner. PlayMode tests (`ScriptPlayTests`): each example game boots to ready, draws objects, ends in win or lose when driven; a script with an error shows the message and the scene survives; old samples still play. Commit.

### Task 9: Gate for Unity
- [ ] `tools/run-tests.ps1` EditMode and PlayMode green, `compile-runtime.sh` green, commit the `.meta` files. Ledger the counts.

## Milestone C: the web side

### Task 10: The API table
**Files:** Create `web/src/lib/script/api.ts`, `api.test.ts`
**Produces:** `SCRIPT_API` (names, signatures, one-line docs), `CALLBACKS`, `REMOVED_NAMES`, `CAMERA_MODES`, `SCRIPT_LIMITS`, `SCRIPT_VERSION`.
- [ ] Test that every callback, table and limit in this plan's Global Constraints is in the table (the single source for prompt and checks) and that Unity's `ScriptLimits` numbers equal it (a test reads the C# file). Commit.

### Task 11: The script check
**Files:** Create `web/src/lib/script/check.ts`, `check.test.ts`; Modify `web/package.json`
**Produces:** `checkScript(text: string): { ok: true } | { ok: false; reason: string }` (a sentence Claude can act on).
- [ ] **Ask before installing** the Lua parser package (name, version, size, licence). Tests: valid examples pass; over 64 KiB, NUL, invalid syntax (with the line), each removed name as an identifier, no callback, a callback defined twice, `load`-like dynamic code all fail with their sentence; every `Tests/Scripts/*.lua` passes.
- [ ] Implement with the parser's AST (names collected from identifiers and member access, so a name inside a string or comment is fine). Commit.

### Task 12: Prompt and author
**Files:** Create `web/src/lib/script/prompts.ts`, `author.ts`, `examples.ts`, tests
**Produces:** `scriptSystemPrompt(): string`, `scriptAnswerSchema(): object` (`script`, `leftOut`, `assets`: small), `makeClaudeScriptAuthor(options): ScriptAuthor` with `author({ description, picture, models, retryReason, timeoutMs })` returning a `DesignReply`.
- [ ] Tests: the prompt is built from `SCRIPT_API` and states every limit; it carries two or three corpus examples whole (a test checks each passes `checkScript`); the schema is under 1,500 characters; the description goes in the user's turn only. Implement via `askForJson`. Commit.

### Task 13: The service
**Files:** Create `web/src/lib/script/service.ts`, `keys.ts`, `server.ts`, tests
**Produces:** `makeScriptService(deps): ScriptService` with `create(job, { description, picture, models, tryAgain }) -> { script, leftOut, assets, asked }`; collection `gameScripts`.
- [ ] Tests as slice 7's service (limits, give-back, no-time, cache with reordered keys, empty and long descriptions) plus: a script that fails `checkScript` gets one retry with the reason, then "The AI could not build this game. Try different words."; `tryAgain` skips the cache once; assets as slice 7. Implement reusing `ask` patterns. Commit.

### Task 14: Describe Game, settings, Game Template, Preview
**Files:** Modify `registry.ts` (`makeGame` shape), `nodes/describeGame.ts`, `nodes/gameTemplate.ts`, `nodes/preview.ts`, `graph/types.ts` (a `script` wire value), `settings.ts` (`script` object, `filesNeeded`), `runs/service.ts` (accept `game.lua`: name, text/plain, size, UTF-8)
- [ ] Tests: `makeGame` accepts the three strings and the old booleans; a saved `true` plays as rules; `script` mode outputs the script wire and no palette or feel; Game Template writes `script: { file, models }` into valid runner filler settings; `filesNeeded` is `game.lua` plus entity files; Preview stores exactly those; old graphs and rules games byte for byte unchanged. Commit.

### Task 15: Panel, card, starter
- [ ] Make a game as three choices (Script, Rules, Off), the **Try again** switch, the card ("A script game, N lines" + left out + plain shapes), the described starter uses Script. Tests as slice 7's. Commit.

### Task 16: Packager and export
- [ ] The packager accepts `game.lua` (name pattern, size 64 KiB, text); export reads it from the run; tests. Redeploy is the studio's. Commit.

## Milestone D: examples, gate, live

### Task 17: The corpus
- [ ] Seven more example games across genres (top-down shooter, platformer, breaker, timing game with a health bar, memory or puzzle, a rhythm tapper, an endless dodger), each with a golden test in Unity and a syntax check in web; pick the best three as the prompt's examples. Commit.

### Task 18: Live prompt check (the studio's key, cost-aware)
- [ ] A small script `web/tools/try-prompt.mjs` that sends five unlike descriptions to Claude through the real author with `ANTHROPIC_API_KEY` from the environment (never printed), checks each answer with `checkScript`, and writes the scripts to a git-ignored folder for loading into the Unity player by hand. Ask before running (it spends API credit). Record pass rates in the ledger.

### Task 19 to 22: gates and measures
- [ ] Task 19: web gate (`vitest`, `tsc`, `eslint`, `npm run build`, packager tests). Task 20: Unity gate (EditMode, PlayMode, compile check). Task 21: rebuild the WebGL template and the Windows and Android players, measure sizes, `RUNNER ready` and the frame rate with 300 objects. Task 22: write `docs/superpowers/notes/slice8-handoff.md` and update `CLAUDE.md`.

### Task 23: Publish and live acceptance (the studio's, with a phone)
- [ ] Publish the template (`tools/publish-template.ps1`), push and merge on the user's word, wait for the production build; describe five unlike games (a 3D runner, a 2D shooter, a platformer, a breaker, a timing game); each plays in Preview with no new build; a script with an error shows its message; Try again regenerates; Build for Windows and Android; the phone's frame rate; write `slice8-results.md`.

### Task 24: Whole-branch review
- [ ] A fresh read-only reviewer over `main..slice-8-lua-games` and the Review Focus; fix Critical and Important findings test-first, one `fix:` commit each; list minors in the handoff.
