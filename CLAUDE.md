# Game Studio Platform

A studio website where a creator turns a prompt plus reference images and assets into a hypercasual
game by wiring steps together on a node canvas. Blender prepares the assets; Unity runs the game.

## Scope: hypercasual, kept simple

- Hypercasual only for now: one core mechanic, one-touch controls, sessions of about a minute, small
  builds, simple low-poly or flat art.
- Build the smallest thing that works. No extra genres, systems or abstractions until asked
  (`karpathy-guidelines`).
- Keep process proportional: a new feature goes brainstorm, then plan, then build. A small fix skips that.

## Status

The Unity runner template (Slice 1, `unity/runner-template`) is built and runs as a WebGL player. The web side is **deployed and checked**
at https://punx-gsp.vercel.app (Vercel, root directory `web`, Production Branch `main`): slice 2 (web foundation:
Next.js, `@punx.ai`-only sign-in by Google or an emailed link, Firestore, Cloud Storage), slice 3a (the graph engine) and slice 3b (the
node canvas). All of it is merged into `main` (a fast-forward on 2026-10-04; the older slice branches on GitHub are redundant). Results are in
`docs/superpowers/notes/slice2-results.md`, `slice3a-results.md` and `slice3b-results.md`; decisions live in the design specs
(`docs/superpowers/specs/`). **Slice 4 (the Describe Game AI step: a prompt and a picture become a palette and the three tuning
numbers, through Claude Sonnet 5.5 inside Play) is built, tested, merged into `main` and deployed (2026-10-04), but not yet run against the
real API:** it needs the studio's Anthropic key first (`slice4-handoff.md`). **Slice 5 (Blender assets: Prepare Model turns an uploaded GLB, FBX
or OBJ into a small flat-colored GLB, Make Shape builds low-poly shapes, both in a private Cloud Run container) is built, tested, reviewed and
merged into `main`; the worker is deployed and passes its smoke test, but the live checks are not run (`slice5-handoff.md`,
`slice5-setup-progress.md`, `blender-worker/README.md`). **Slice 6 (Build Model and Build Environment: Claude writes a recipe from words, the
Blender worker builds it into a rigged low-poly model or a world with animated scenery, plus a High quality setting that gives Unity a lit look
with a quality governor) is built, tested, reviewed (no Critical or Important findings) and merged into `main` (2026-10-08, with slice 7):** Unity could not
run since Task 32 (no Hub sign-in), the published template is still the one from 2026-10-02, and nothing is run on the live site (`slice6-handoff.md`).

**Slice 7 (the game engine) is built, tested, reviewed and merged into `main` (2026-10-08, `f17b9f0`, deployed):** Describe Game with Make a game writes a whole
game (a checked, playtested spec in a closed vocabulary) plus Claude-made models; the pre-built Unity player runs it with its own engine (TypeScript and C#
implementations kept equal by shared fixtures: `unity/tools/engine-check.sh`); a private packager adds a game to a Windows or Android player, and the Preview
panel has Build for buttons. Unity has not run any of it (no Hub sign-in). The packager is deployed (2026-10-08, private Cloud Run, `PACKAGER_URL` and `PACKAGER_KEY` set in Vercel) but holds no players yet (`slice7-handoff.md`).

**Slice 8 (Lua games) is merged into `main` (2026-10-09, `66c07a6`):** Claude writes the game as a Lua script, checked on the server (luaparse, parse only) and run only inside the player's sandboxed MoonSharp interpreter (instruction budget, removed names, caps), 2D or 3D, with ten example games; Describe Game's Make a game is Script, Rules or Off. The product was redirected the same day: **one description makes everything** (the Make it box on the Games page makes the whole graph, with a soft Build Model step per model, and opens it already played), the nodes were reworked for it (six numbered model inputs on the Game Template), the pages around the editor got a new look, and each Build Model or Build Environment step opens in a **studio window** with a 3D render. The WebGL templates are published; the Windows and Android players are rebuilt (`Builds/upload`) but not yet uploaded, the packager is not yet redeployed, and nothing is run live (the live prompt check and the final review were skipped on the owner's word). See `slice8-handoff.md`.

**Slice 9 (the art pipeline) is started on the branch `slice-9-art-pipeline` (2026-10-09, 2 local commits, not pushed):** the art gate showed the old Blender kit cannot make organic shapes, so a new **freeform model** kind (a list of parts: ellipsoid, capsule, cylinder, box, torus, lump, tube, revolve, loft, mirror; `blender-worker/scripts/freeform.py`) now builds a recognisable fox, robot, crate, pine and spaceship inside game budgets. It is Python-side only so far: not yet wired into the worker's `/build`, the web recipes or Claude's prompt, and it has no animation, no textures, no mobile variant (`slice9-handoff.md` has the ordered list). The product goal is in the memory note `project-product-goal`: a user prompts an idea and the platform generates the game and its models, for PC or Android.

## Skills (in `.claude/skills/`; origins in `.claude/skills-sources/SOURCES.md`)

| Situation | Use |
|---|---|
| New feature or idea, "how should this work" | `brainstorming`, then `writing-plans` |
| Building from a written plan | `executing-plans` (`subagent-driven-development` for large plans) |
| Writing logic: graph engine, job runner, file converters | `test-driven-development` |
| Something fails: a Blender or Unity batch run, graph execution | `systematic-debugging` |
| Before saying a task is done | `verification-before-completion` |
| Node editor and web UI | `frontend-design`, `vercel-react-best-practices`, `vercel-composition-patterns` |
| Unity C# and game-loop code | `game-developer` |
| Library docs: React Flow (`/websites/reactflow_dev`), Blender Python API (`/websites/blender_api_current`), Unity manual (`/websites/unity3d_manual`), and others | `context7-mcp` (the Context7 server in `.mcp.json`) |
| Uploads, auth, prompts, job execution | `owasp-security` |

## Security stance

User uploads (images, FBX, GLB, .blend files) and prompts are untrusted input. Never run scripts that
come from an uploaded file, and keep Blender and Unity workers sandboxed with no access to secrets.

## Work in progress

Slice 4's code is done and live but **parked until the studio has API funds** (2026-10-05); what is left is the studio's setup (a funded Claude Console workspace and key with a monthly spend limit, the data-terms
decision, `ANTHROPIC_API_KEY` as a Sensitive Production variable in Vercel, then a redeploy), then the live checks and
`slice4-results.md`. Slice 5's worker was redeployed from the slice 6 branch on 2026-10-08 (smoke test passed, `/build` and the High tier included); the Vercel
variables and the Anthropic key are set and the Firebase project is back on Blaze (uploads need it); what is left is a budget alert, then the live checks
and `slice5-results.md` (and slice 4's, `slice4-results.md`). Slice 6's code is done and its whole-branch review found nothing Critical or Important;
what is left is the studio's Unity Hub sign-in (so I can run its Unity tests, rebuild and publish the template and measure), a phone, then the live
checks and `slice6-results.md`. Slice 7 waits for the same Unity sign-in (engine runs, `.meta` files, the Windows and Android players, the rebuilt template), the
players (built with `tools/build-players.ps1`, uploaded to the packager's bucket with a `players.json`), then its live checks and `slice7-results.md`. `main` holds slices 2
to 8; the slice branches are merged and can be deleted. Ask before any push: pushing `main` starts a production build. Also open: the password
pre-registration decision (the Email/Password provider is still enabled next to Google), the checks listed as not run in the results notes,
and slice 1's player-hardening gate before any use beyond punx.ai. Read `docs/superpowers/notes/slice9-handoff.md`, then `slice8-handoff.md`, then `slice7-handoff.md`, then `slice6-handoff.md`, then
`slice5-handoff.md` and `slice4-handoff.md` first, then `slice2-results.md` (it also has what went wrong deploying to
Vercel and how it was fixed), `slice3a-results.md`, `slice3b-results.md` and the handoffs (`slice2-handoff.md`, `slice3a-handoff.md`,
`slice3b-handoff.md`, `2026-10-02-slice1-handoff.md`) before doing anything else.
