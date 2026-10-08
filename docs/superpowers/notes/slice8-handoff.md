# Slice 8 handoff: Lua games, the Make it flow, the studio window (written 2026-10-09, updated after the merge)

## What this slice is

Claude writes a whole game as one **Lua script**; the pre-built Unity player runs it in a sandboxed interpreter (MoonSharp, vendored). No limit on the genre, 2D or 3D. The script never
runs on a server: only inside the player, on the person's device. Spec: `specs/2026-10-08-lua-games-design.md`. Plan: `plans/2026-10-09-slice8-lua-games.md`. The ledger of every task is
`.superpowers/sdd/2026-10-09-slice8-lua-games/progress.md` (git-ignored, local).

**After the plan the owner redirected the product** (2026-10-09): "the user describes what they want and it generates everything, even the nodes". So the slice also holds:
the **Make it flow** (one box makes the whole graph), a **node rework** for it, a **new look** for the pages around the editor, and a **studio window** (a detailed form and a 3D render for one
Build Model or Build Environment step).

## State (2026-10-09, end of session)

- **Merged into `main` and pushed** (`main` at `66c07a6`; Vercel builds it). The branches `slice-8-lua-games` and `studio-window` are merged and can be deleted.
- **Published:** the WebGL templates in `web/public/templates` are the rebuilt ones with the Lua engine (9.1 MB each).
- **Built, not yet in the bucket:** `Builds/upload/windows.zip` (35.7 MB) and `android.apk` (29.5 MB), rebuilt with the Lua engine (git-ignored; rebuild with `tools/build-players.ps1`, then make the zip with
  Windows' own `tar.exe -a -c -f ... -C player-windows Runner.exe UnityCrashHandler64.exe UnityPlayer.dll D3D12 MonoBleedingEdge Runner_Data`: Git Bash's GNU tar writes a tarball, not a zip).
- **Not done on the owner's word:** the live prompt check (the tool is there, `web/src/lib/script/tryPrompt.live.test.ts`, off unless `LIVE_PROMPT=1`, reads `ANTHROPIC_API_KEY` from the
  environment or `web/.env.local`), the golden pins for the platformer and timing examples, the mutation check of the corpus, and the whole-branch review (Task 24).
- **Verification was kept light on request** ("focus on building"): compile checks, and full runs at milestones: Unity EditMode 321, PlayMode 28, web 2,137 tests, packager 16.

## Where to look

| What | Where |
|---|---|
| The one table of the script API, limits, removed names, field rules | `web/src/lib/script/api.ts` (the prompt and the checks are built from it) |
| The script check (size, syntax, removed names, a callback to run) | `web/src/lib/script/check.ts` (luaparse 0.3.1, parse only) |
| Prompt, answer schema (script, palette, leftOut, assets), author | `web/src/lib/script/{prompts,author}.ts` |
| Service: one retry, cache (`gameScripts`), Try again as an `attempt` number | `web/src/lib/script/{service,keys,server}.ts` |
| Example games (also the prompt's three examples) | `unity/.../Tests/Scripts/*.lua`, copied to `web/src/lib/script/examples.ts` by `web/tools/gen-script-examples.mjs` |
| Sandboxed host, instruction budget, string caps | `unity/.../Runtime/Script/Pure/ScriptHost.cs` |
| World, API tables, runner | `Runtime/Script/Pure/{ScriptWorld,GameApi,ScriptRunner}.cs` |
| View (cameras, pointer to field, pooled objects) and HUD | `Runtime/Script/{ScriptView,ScriptHud}.cs` |
| Settings key `script { file, models }`, bootstrap switch | `Runtime/Script/Pure/ScriptSettings.cs`, `Runtime/View/RunnerBootstrap.cs` |
| Vendored MoonSharp (two patches recorded in its README); `Assets/link.xml` keeps it whole | `unity/.../ThirdParty/MoonSharp/` |
| **Make it:** the graph made from one description | `web/src/lib/graph/generated.ts`, `graph/service.ts` (`createGraph` with `describe`), `app/graphs/MakeItBox.tsx`, `POST /api/graphs { describe }` |
| Soft steps, numbered model inputs | `graph/runner.ts` (`soft`), `graph/registry.ts` (`SCRIPT_MODEL_PORTS`, `soft` on Build Model), `graph/nodes/gameTemplate.ts` |
| **Studio window** | `app/graphs/[id]/studio/[node]/{page,Studio}.tsx`, `studio.module.css`; routes `POST /api/graphs/:id/step`, `GET /api/graphs/:id/stored/:sha`; `playStep` and `readStored` in `graph/service.ts` |
| New look: sign-in, header, Games, Runs | `app/shell.module.css`, `app/AppHeader.tsx`, `app/sign-in/page.tsx`, `app/graphs/page.tsx`, `app/runs/page.tsx` |
| Run service, packager and export for `game.lua` | `web/src/lib/runs/service.ts`, `packager/server.mjs`, `web/src/lib/export/service.ts` |

## Decisions worth keeping

- **Interpreter:** MoonSharp 2.0.0.0 in its hard sandbox preset, with `os io debug require load loadstring loadfile dofile collectgarbage coroutine setmetatable getmetatable luanet clr`
  set to nil, `math.random` removed (the game has its own seeded `rand()`), `pcall`, `rawget` and `rawset` absent by design. Every call runs as a coroutine that yields every 200 instructions;
  200,000 per frame is the budget. Strings are capped at 10,000 characters (patched concat, wrapped `string.rep` and `string.format`). A simple loop costs about 7 instructions an iteration.
- **Stripping:** the WebGL build strips MoonSharp's reflection-registered library functions (`type` was nil) unless the assembly is preserved in `Assets/link.xml`. It is.
- **Objects** are empty Lua tables with one shared metatable; a field the script invents lands in `obj.data`. A dropped spawn (over 300 objects or 120 a second) returns a dead stand-in object.
- **Coordinates:** the field is centered on 0, 0 (9 by 16), y up. Side and fixed cameras see it head on (z is depth); top and chase see it as the ground (y away, z height); side2d and top2d are
  orthographic and depth sorted (a smaller z is in front: the prompt says so).
- **Make a game** is `script | rules | off`; a saved `true` is rules, `false` or nothing is off; new steps and the described starter are Script. **Try again** is an `attempt` count in the cache key. **The palette** is part of Claude's answer.
- **The Make it flow:** `createGraph` with `describe` asks the script service (the same cache as Play, so the first Play re-uses the answer for free), then `generatedGraph` makes Describe Game,
  one **soft** Build Model step per model Claude listed (up to six), the Game Template and the Preview, wired (palette to each model step, each model to the template's `model1..model6`, in order).
  The editor opens at `?play=1`, takes the flag off the address and presses Play. Describe Game in script mode builds no models itself (the steps do) and outputs the game and its palette.
- **Soft steps:** a Build Model step with `soft: true` that fails is `done` with `{ notBuilt: message }`, hands nothing on, and the game uses a plain shape; the card says why. A step the person makes themselves is hard as before.
- **The studio window** works on the saved graph: Build saves the step's settings (PUT the graph) then runs only that step (`runGraph` with `target`), and shows the GLB from the graph's own folder in Google's
  `@google/model-viewer` 4.3.1 (loaded only on that page). Opened from "Open in studio" in the step's panel.
- **No server playtest.** Only the player can run a script. A Lua error or a budget overrun stops the game with "The game stopped: <message> (line N)".

## Unproven until it is live

Everything with real Claude output: the first-attempt pass rate of the script prompt, and whether the games it writes run well (the live check was skipped); the Make it flow end to end on the live site
(the AI call can take up to a minute inside one request: `maxDuration` 300); Blender building the models in a generated graph; the studio window with a real build (only its viewer was seen working, on a sample
model); the signed-in pages' new look (only sign-in was looked at in a browser); the Lua games on a phone; Build for with `game.lua` (the packager needs redeploying and the players uploading).

## Blocked on the studio (in order; I ask before each)

1. **Redeploy the packager** (Cloud Shell, one command at a time; its volume, secrets and service account are kept): `rm -rf punx-gsp-2026 && git clone --depth 1 https://github.com/PUNX-PH/punx-gsp-2026.git`, `cd punx-gsp-2026`,
   `gcloud run deploy packager --source packager --region us-east1`. 2. **Upload `windows.zip` and `android.apk`** from `Builds/upload` to `gs://punx-gsp-players` (leave `players.json`).
3. **Use Make it on the live site** (https://punx-gsp.vercel.app, not a per-deployment URL): describe a game, watch the steps appear and play, open a model in the studio, Build for Windows and Android, try it on a phone.
4. Then write `slice8-results.md`. Older owner to-dos are in `session-2026-10-09-handoff.md` (back up the keystore, delete the invoker key, budget alerts, the Email/Password question).

## Next ideas (not started)

The owner said the UI "sucks": only the pages around the editor were redone, **the editor canvas itself was not touched** (ask which screen, or for a screenshot). Slice 9 (`plans/2026-10-09-slice9-art-pipeline.md`: detail budgets per
target, a richer Blender kit, textures, sprites) is planned and not started. A picture upload in the Make it box; a server-side render of a model (Blender) beside the live viewer; the corpus pins and the review above.
