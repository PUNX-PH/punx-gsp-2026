# Slice 7 handoff: the game engine, described games and export (written 2026-10-08)

Read this after `slice6-handoff.md`. It says where slice 7 stands, what only the studio can do, and how to continue. The authorities are the spec
`docs/superpowers/specs/2026-10-08-game-engine-design.md` and the plan `docs/superpowers/plans/2026-10-08-slice7-game-engine.md` (32 tasks, executed inline,
as the user chose). The words of the engine are in `docs/superpowers/notes/engine-semantics.md`.

## What this slice is

A creator describes a hypercasual game in words (and a picture) and gets that game, not one fixed runner. Describe Game, with **Make a game** on (the
default for new steps), has Claude write a **GameSpec**: data in a closed vocabulary (entities with behaviors, event rules over counters, ends,
difficulty). The web app repairs it, checks it, **plays it with three test players** (idle, random, reactive) and asks Claude once more if it is not a
game; then each entity Claude asked art for is built by the slice 6 builder (Claude writes the recipe, Blender builds it). Game Template writes the spec
into the settings file (`game` key); the pre-built Unity player runs it with its own engine. The Preview panel can also **build for Windows or Android**: a
private packager adds the game to a pre-built player (a zip, or an APK signed with the studio's key). No Unity Editor runs on a server at any point.

## Progress at a glance (2026-10-08)

| Part of the plan | State |
|---|---|
| Tasks 1 to 8: semantics note, types, checker, repair, simulator, rules, playtest, shared fixtures | Done and tested |
| Tasks 9 to 11: the C# engine, parser, fixture check, mutation checks | Done; proven by `unity/tools/engine-check.sh` (no Unity), **not run inside Unity** |
| Task 12 and 13: the engine in Unity (view, bootstrap), compile check | Written and compiled (`unity/tools/compile-runtime.sh`); **no PlayMode test written or run; no `.meta` files** |
| Tasks 14 to 19: Claude authoring, service, wire, node, panel, starter, hostile-input tests | Done and tested |
| Tasks 20 to 22: the runner as a built-in spec | **Skipped on purpose** (ledger ruling): the engine path is chosen only by a `game` key, old settings are untouched |
| Tasks 23 to 25: Claude-made assets, the gate | Done and tested |
| Task 26: the packager (`packager/`) | Done and tested with a fake `apksigner`; **not deployed** |
| Tasks 27 and 28: the download route and buttons; the player builds | Web done and tested; `BuildPlayers.cs` and `tools/build-players.ps1` **written, never run** |
| Task 29: rebuild and publish the WebGL template, measure | **Waiting on the Unity Hub sign-in** (also publishes slice 6) |
| Task 30: the whole-branch review | Done 2026-10-08; its 4 Important findings were fixed, minors below |
| Task 32: live acceptance | **The studio's** |

The gate (2026-10-08): web 1998 tests in 102 files, lint, `tsc` and `npm run build` clean with no AI, Blender or packager variable set; `npm --prefix packager
test` 13 tests; `bash unity/tools/engine-check.sh` (17 specs, every checkpoint digest equal to the TypeScript simulator's, 29 bad specs refused with the
website's sentences); `bash unity/tools/compile-runtime.sh` (all Runtime C# compiles against Unity's assemblies). The Blender tests and slice 6's Unity runs
are as at the end of slice 6.

## Where to look

```
web/src/lib/engine/    spec.ts (types, caps), fields.ts (the parameter tables), check.ts (checkSpec and the JSON schema Claude writes to), repair.ts,
                       sim.ts + rules.ts + collide.ts + rng.ts (the simulator), log.ts (input logs, state digests), bots.ts + playtest.ts,
                       prompts.ts + author.ts (Claude), service.ts (repair, check, playtest, retry, cache, limits), assets.ts (entity models),
                       files.ts (entity-NAME.glb), keys.ts, server.ts (wiring), microCases.ts + badCases.ts (fixture sources), fixtures/
web/src/lib/export/    types.ts, client.ts (the packager over HTTP), service.ts (what may be exported, the daily count), server.ts (wiring)
web/src/lib/graph/     nodes/describeGame.ts (Make a game), nodes/gameTemplate.ts (a game wired in), nodes/preview.ts (entityFiles), service.ts
                       (exportGame), api.ts (exportGame), starter.ts (the described starter wires the game)
packager/              zip.mjs (a zip editor), server.mjs, Dockerfile, README.md
unity/runner-template/Assets/Runner/Runtime/Engine/   Pure/ (MiniJson, EngineSpec, SpecParser, EngineSim, RuleEngine, Collide, Digest: no UnityEngine),
                       EngineGame.cs (draws and steps it), PrimitiveMeshes.cs; Runtime/View/RunnerBootstrap.cs (the game key switches to the engine)
unity/runner-template/Assets/Runner/Tests/Engine/    the shared fixtures (specs, logs, expected digests, bad specs), copied from web/.../fixtures
unity/tools/           engine-check.sh, compile-runtime.sh, README.md (what runs with no Unity license)
```

Two implementations of the semantics exist (TypeScript and C#) and are kept equal by fixtures. **A change to the semantics is made in the note, in both
implementations, and recorded with `UPDATE_ENGINE_FIXTURES=1 npx vitest run src/lib/engine/fixtures.test.ts` from `web/`** (it rewrites the fixtures and the
Unity copy), then `engine-check.sh`. A new rule that no fixture exercises is a hole: add a case to `microCases.ts`. The mutation checks of 2026-10-08 (26 one-line
changes) are described in the ledger; three survivors are equivalent mutants.

## Decisions worth keeping

- **The engine path is chosen by a `game` key in the settings file.** A game's settings are an ordinary valid runner settings object (fixed filler: sample tuning,
  the three role file names, a five-color palette) plus `game`, so the runs service and every existing check work unchanged. `filesNeeded` for a game is only
  its entity files (`entity-NAME.glb`); Preview stores only those (`settings.entityFiles` present means a game). Old settings never touch the engine.
- **Describe Game's `makeGame` setting is optional on save** (a graph saved before means false) and true in new steps; with it on the step outputs `game` and
  `palette` and no `feel`. The described starter now wires `game` into Game Template.
- **Claude's answer is `{ game, leftOut, assets }`** in structured outputs; counters and entities are lists with a `name` in the schema (structured outputs forbid
  map-valued `additionalProperties`) and repair turns them into maps. **Unproven: that the API accepts this schema** (the `anyOf` of behaviors, events and actions).
- **The game is cached as text** (`CachedGame.spec` is a JSON string) because Firestore may sort a map's keys, and the entity order decides event order.
- **Determinism:** integers only (thousandths of a unit), 60 Hz, one xorshift32 generator; `steps = floor((ms*60+500)/1000)`.
- **The playtest** rejects a game lost within half a second with no input, a game with no way to end, a game no test player survives for 3 seconds, and a
  score-only win no test player reaches in a minute. One retry tells Claude why. A retry takes a second AI count.
- **Assets:** at most 6 per game, built one after another through `BuilderService.buildModel`; an entity whose build fails (or has no time) is drawn as a plain
  shape and the card says so ("Press Play again to try building them"; built models are cached, so a second Play carries on). Wired-in models do not override
  generated ones (Describe Game has no model input).
- **Downloads** are counted per person per day in `exportUsage` (20 and 200 a day, `EXPORT_DAILY_LIMIT_PER_PERSON` and `_TOTAL`), given back on failure. The
  response is streamed in 64 KiB pieces because a buffered one is capped at 4.5 MB on Vercel (**unproven live**).
- **Entity names that differ only by capitals are refused** (the checker, the C# parser and repair): their files would be one file on Windows.

## Unproven until it is live

- **Unity:** the engine inside the player (`EngineGame`, `PrimitiveMeshes`, the bootstrap switch), PlayMode, the `.meta` files of every new Unity file, the
  template rebuilt and published (Task 29, with slice 6's), `RUNNER ready in N ms`, the frame rate with 150 live objects.
- **The player builds** (`BuildPlayers.cs`, `tools/build-players.ps1`: Windows and Android build support must be installed) and a Windows or Android player
  reading `StreamingAssets/game/settings.json`; the Android jar address.
- **The packager:** deploy it, the real `apksigner` on a real APK (the zip editor was tested on zips written as other tools write them, not on a real APK or
  its signing block), a real player, a phone installing the APK, and the 4.5 MB response question on Vercel.
- **Claude:** that the schema is accepted, the quality of the games it writes, the cost of one game and of the retry, and Play's time (a game, then up to six
  builds, each with a Claude call and a Blender job, against the Play budget).
- **The playtest's judgement** on real games (it was tuned on five fixtures): too strict rejects fair games, too lax lets dull ones through.

## Blocked on the studio (in order; I ask before each)

1. Everything slice 6 waits for (`slice6-handoff.md`): the Unity Hub sign-in, a phone.
2. **Unity Hub sign-in**, then I run the EditMode and PlayMode suites, write `EnginePlayTests`, commit the `.meta` files, build the players (`tools/build-players.ps1`)
   and rebuild and publish the WebGL template (Task 29).
3. **Deploy the packager** (`packager/README.md`): the players and `players.json` in a bucket, an Android keystore and its password in Secret Manager,
   `PACKAGER_URL` and `PACKAGER_KEY` in Vercel (Sensitive), a budget alert.
4. **DONE 2026-10-08: pushed and merged into `main`** (`f17b9f0`, with slice 6's remaining tasks underneath it); the production build is live and the slice branches
   were deleted. A new Describe Game step now defaults to Make a game, whose game cannot play in the live Preview until step 2 publishes the rebuilt template.
5. **Live acceptance (Task 32):** describe a lane runner, a tap-to-flap flier and a falling-object catcher (each plays right in Preview with no new build); a
   request that cannot be expressed gets "Left out"; a second Play unchanged says reused; Build for Windows (unzip, run) and Android (install on a phone);
   `git grep` finds no key material; then write `slice7-results.md`.

## Deferred minors (from the review)

1. A fallback model is always a box, even when Claude wanted a sphere.
2. With Make a game on but no `game` wire into Game Template, Describe Game still spends Claude calls and Blender builds for nothing.
3. Asset descriptions from Claude go into Build Model's prompt; the recipe output is validated, so the risk is low.
4. The packager's `readBody` has no read timeout (Cloud Run IAM limits who can call it).
5. When the last kept entry of an APK is followed by an APK Signing Block, `zip.mjs` counts the block as part of the entry; harmless, untested on a real APK.
6. The runner is not a built-in spec (Tasks 20 to 22 skipped): Unity has two code paths, the runner and the engine.
7. Unity's `EngineGame` has no quality governor and no animation (models are static); `Capsule` is drawn as a sphere.
