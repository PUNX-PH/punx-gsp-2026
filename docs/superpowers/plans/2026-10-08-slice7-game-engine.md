# Slice 7: The Game Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, executed **inline ("native", the user's standing choice)**: one session
> implements every task in order **without check-ins**, keeps a ledger at `.superpowers/sdd/2026-10-08-slice7-game-engine/progress.md`
> (git-ignored), then **one fresh whole-branch review** (Task 30) and one fix pass. Steps use checkbox (`- [ ]`) syntax. **Ask before any push, install
> or deploy.** Work on a new branch `slice-7-game-engine` from `slice-6-built-models`.
>
> **Steps that need the studio** (ask first; if unavailable ledger `Task N: <step> deferred (needs the studio)` and carry on; Task 32 repeats them):
> an active **Unity Hub sign-in** for any Unity batch run (Tasks 12 to 15, 22, 27, 28); without it the C# is written test-first, compiled against
> Unity's reference assemblies and run on the .NET stand-in (rebuild `compile-runtime.sh` into `unity/tools/`, committed this time); the **funded
> Anthropic key** (Task 32); **a phone**; Google Cloud steps (Task 26); the studio's **Android keystore** (Task 27); Unity's **Windows and Android
> build support** installed (Task 28).

**Goal:** A creator describes a hypercasual game and Describe Game writes a checked GameSpec plus its assets; the pre-built Unity player runs it
(WebGL in Preview, and a Windows or Android build packaged from pre-built players), with no per-game Unity build.

**Architecture:** One closed-vocabulary rule engine with fixed-point deterministic semantics, implemented twice (TypeScript simulator in
`web/src/lib/engine/`, C# in `unity/.../Runtime/Engine/`) and kept equal by shared fixtures. Claude writes a GameSpec (data) through the existing
`askForJson`; the web repairs it, playtests it with bots in the simulator, and designs each entity's asset through the slice 6 builder. Game Template
writes the spec into the settings file; no `game` key means today's runner. A small private packager service zips or signs pre-built players.

**Tech Stack:** TypeScript, Next.js 16, Vitest, `@anthropic-ai/sdk` (installed); Unity 6000.3, NUnit; Node 24 worker (`node --test`) and
`apksigner`. No new npm dependencies in `web/`.

**Spec:** `docs/superpowers/specs/2026-10-08-game-engine-design.md` (approved 2026-10-08).

## Global Constraints

- GameSpec: `{ engine: 1, world, entities, counters, rules, ends, difficulty, look }`; sections and the closed vocabulary exactly as the spec lists.
  Unknown fields are dropped by repair and refused by the player's parser.
- Caps: entities **12**, rules **40**, counters **9** (`score`, `lives`, `time` plus up to 6), live objects **150**, spawn rate **10** a second,
  rule actions per tick **200**, spec text **64 KiB**, generated assets per game **6** (the rest are flat primitives).
- **Determinism:** fixed step 60 Hz; all positions, sizes and speeds are **integers in thousandths of a unit** (`Milli`); time in steps; the only
  random source is `xorshift32` seeded from `spec` seed (default `1`), used only by `spawn` patterns. No floats in engine state, no `Math.random`.
- Step order each step: input, controls, moves, spawns, collisions, rules (written order), cleanup, ends.
- Every failure sentence from the new code starts with the step's label ("Describe Game: ...") and follows the existing capitalization rules.
- Claude calls and Blender jobs: counted before the call, given back on unavailable or unusable results, kept on a refusal (as slice 6).
- Standard games and old settings files play byte for byte as before; the new key is `game` and is optional.
- Cache keys: SHA-256 hex of the canonical JSON of `[ENGINE_VERSION, "game", model, uid, description, pictureSha, assetNames]`, `ENGINE_VERSION = 1`.
- Data, never code; no `CreatePrimitive`; no physics module; the packager and workers hold no secrets except the Android key in the packager only.

## Review Focus

1. A description that cannot be expressed (3D navigation, text input, multi-touch): the nearest game plus a plain `left out` note, never a crash. (Task 19)
2. A spec that is lost instantly, never ends, or spawns past the caps: rejected by the playtest, one retry, then a plain message. (Tasks 7, 8, 19)
3. A hostile or malformed spec text at the player (prototype keys, huge numbers, cyclic references): refused with the web's message. (Tasks 3, 12)
4. Entity asset builds that fail or exceed the budget: that entity falls back to a primitive and the game still plays. (Tasks 21, 22)
5. An old settings file and the built-in runner spec: identical play on a recorded input log. (Tasks 23, 24)

---

## Milestone 1: semantics and the web checks

### Task 1: Semantics note and the GameSpec types
**Files:** Create `docs/superpowers/notes/engine-semantics.md`, `web/src/lib/engine/spec.ts`, `spec.test.ts`
**Produces:** `GameSpec`, `Entity`, `Behavior`, `Rule`, `Event`, `Action`, `Condition` (types as in the spec); constants `ENGINE_CAPS`,
`ENGINE_VERSION`; `type Milli = number` (integer thousandths).
- [ ] Write the note: step order, fixed point, `xorshift32`, each behavior, event, action and condition, collision rule (box and circle, closed
  intervals), rule ordering, end resolution (`win` beats `lose` in the same step is **no**: first one reached ends), counter clamp **-1,000,000 to 1,000,000**.
- [ ] Test `ENGINE_CAPS` values and that every vocabulary list in `spec.ts` equals the note's tables (parse the note's tables in the test).
- [ ] Implement `spec.ts` types and constants. Commit.

### Task 2: JSON schema for Claude and the checker
**Files:** Create `web/src/lib/engine/check.ts`, `check.test.ts`; fixtures `web/src/lib/engine/fixtures/specs/{runner,flapper,catcher}.json`
**Produces:** `checkSpec(input: unknown): { ok: true; spec: GameSpec } | { ok: false; error: string }`; `gameSpecSchema` (the JSON schema object for structured outputs).
- [ ] Tests: the three fixtures pass; each cap exceeded fails with a sentence naming the cap; unknown behavior, dangling entity or counter reference,
  non-integer Milli, `__proto__`/`constructor` keys (own keys only, `Object.hasOwn`), text over 64 KiB each fail.
- [ ] Implement `checkSpec` and `gameSpecSchema`. Commit.

### Task 3: Repair
**Files:** Create `web/src/lib/engine/repair.ts`, `repair.test.ts`
**Produces:** `repairSpec(raw: unknown): { spec: GameSpec; notes: string[] } | null` (null when nothing usable).
- [ ] Tests: clamps numbers into range and rounds to integers, drops unknown behaviors/rules/actions with a note, removes dangling references, trims
  to caps in a fixed order (rules from the end, entities from the end, counters from the end), result always passes `checkSpec`.
- [ ] Implement. Commit.

## Milestone 2: the simulator and playtest

### Task 4: Core simulator
**Files:** Create `web/src/lib/engine/sim.ts`, `rng.ts`, `sim.test.ts`
**Produces:** `createSim(spec: GameSpec): Sim`; `Sim.step(input: Input): void` where `Input = { tap: boolean; hold: boolean }`; `Sim.state(): SimState`
(`{ step, counters, entities: {id,type,x,y,vx,vy,alive}[], status: "running"|"won"|"lost" }`); `xorshift32(seed): () => number` (uint32).
- [ ] Tests (one per behavior and per step-order rule, small hand-made specs): `move`, `fall`, `oscillate`, `lane`, `follow`, `lifetime`, `control` jump
  and flip, `spawn` patterns with the seeded rng (exact positions pinned), collisions box and circle, counter clamp, `exitBounds`, end resolution.
- [ ] Implement per the note. Commit.

### Task 5: Rules, events and difficulty
**Files:** Modify `sim.ts`; Create `rules.ts`, `rules.test.ts`
- [ ] Tests: every event and action; condition `and`; rule actions per tick cap stops at 200 with a `lost` note state; live-object cap drops spawns
  silently; difficulty ramp scales spawn interval and speed with caps; `speedUp`.
- [ ] Implement `applyRules(state, events, spec)` used by `Sim.step`. Commit.

### Task 6: Input logs and the checkpoint format
**Files:** Create `web/src/lib/engine/log.ts`, `log.test.ts`
**Produces:** `type InputLog = { steps: number; taps: number[]; holds: [number, number][] }`; `runLog(spec, log): SimState[]` returning the state at
steps 0, 60, 120, ...; `stateDigest(s: SimState): string` (a stable text of integers, no floats).
- [ ] Tests: the same spec and log twice give equal digests; digest changes when any entity moves one Milli. Implement. Commit.

### Task 7: Bots and the playtest
**Files:** Create `web/src/lib/engine/bots.ts`, `playtest.ts`, `playtest.test.ts`
**Produces:** `playtest(spec: GameSpec): { ok: true } | { ok: false; reason: string }` (sentences a person or Claude can act on).
- [ ] Tests: the three fixtures pass; a spec with a hazard on top of the hero at step 0 fails "lost within 3 seconds with no input"; a spec with no
  end and no way to lose in 60 s fails "never ends"; a spec where no bot can win and the only end is `win` fails "cannot be won".
- [ ] Implement three bots (idle, random taps from `xorshift32`, reactive: taps when a hazard is within a window), 60 s of game time each. Commit.

### Task 8: Shared fixtures for the C# engine
**Files:** Create `web/src/lib/engine/fixtures/logs/*.json`, `expected.json`, `tools/regen-engine-fixtures.mjs` (run with `npx tsx` if present,
else a vitest "regenerate" test guarded by an env flag), `fixtures.test.ts`
- [ ] For each spec fixture and one hand-made log, record `{ step, digest }` checkpoints into `expected.json`; the test replays and compares.
- [ ] Copy the same files to `unity/runner-template/Assets/Runner/Tests/Engine/` via the tool; a test checks both copies are equal. Commit.

## Milestone 3: the C# engine

### Task 9: Parser
**Files:** Create `unity/.../Runtime/Engine/SpecParser.cs`, `EngineSpec.cs`, tests `Tests/EditMode/SpecParserTests.cs`
**Produces:** `static class SpecParser { public static bool TryParse(string text, out EngineSpec spec, out string error) }`.
- [ ] Tests: the three fixtures parse; the same bad inputs as Task 2 give the same sentences (share `fixtures/bad-specs.json`). Reuse `JsonKeys`' raw
  reading, never `JsonUtility` on a wrong-typed value. Implement. Commit.

### Task 10: Simulator in C#
**Files:** Create `Runtime/Engine/{Xorshift32,EngineSim,Behaviors,RuleEngine,Collisions}.cs`
- [ ] Tests `EngineFixtureTests.cs`: replay every shared log and compare each checkpoint digest with `expected.json` (the digest code is a port of
  `stateDigest`). Integer math only (`long` for products, truncate toward zero as the note says).
- [ ] Implement per the note, one file per concern. Commit.

### Task 11: Mutation checks of the semantics
- [ ] For each step-order rule, the clamp, the rng, the collision interval and the cap handling: change one line in the TS simulator, confirm
  `fixtures.test.ts` fails, restore by hash (as slice 6). Ledger the list. Commit nothing unless a fixture is missing, then add it first.

### Task 12: EngineView and the bootstrap switch
**Files:** Create `Runtime/Engine/EngineView.cs`, `EngineHud.cs`; Modify `Runtime/View/RunnerBootstrap.cs`
- [ ] Tests (PlayMode `EnginePlayTests`): a spec with a `game` key builds one renderer per live entity (at most 100 after merging per kind with
  instancing), a tap input moves the hero, `win` and `lose` show the end screen; no `game` key plays the old runner unchanged.
- [ ] Draw entities with the loaded GLB or a primitive mesh built in code in the entity's color; reuse the lit look and the quality governor;
  touch or click is the only input. Needs Unity (ledger if not). Commit.

### Task 13: .meta files and the compile check
- [ ] Rebuild the compile check into `unity/tools/` (rsp files, stand-in harness, README), run it, and run EditMode and PlayMode if Unity can run;
  generate and commit `.meta` files. Commit.

## Milestone 4: Claude authoring

### Task 14: Prompt and call
**Files:** Create `web/src/lib/engine/prompts.ts`, `author.ts`, `author.test.ts`
**Produces:** `type GameAuthor = { author(input: { description: string; picture: Uint8Array | null; models: string[] }): Promise<{ spec: unknown; left_out: string; assets: AssetRequest[] }> }`;
`makeClaudeGameAuthor(options: { client: ClaudeClient; model: string; timeoutMs?: number }): GameAuthor`; `AssetRequest = { entity: string; role: Role; kind: ModelKind; description: string }`.
- [ ] Tests with a fake client: the schema is `gameSpecSchema` plus `left_out` and `assets`; the prompt contains the full vocabulary and the caps built
  from `spec.ts`; the picture is sent as a block; the prompt says to say what was left out. Implement with `askForJson`. Commit.

### Task 15: Authoring service (checks, playtest, retry, caches, limits)
**Files:** Create `web/src/lib/engine/service.ts`, `keys.ts`, `memory.ts`, `firebase.ts`, `ports.ts`, tests
**Produces:** `makeGameService(deps): GameService` with `GameService.create(user, input): Promise<{ spec: GameSpec; leftOut: string; assets: AssetRequest[]; notes: string[] }>`; `gameKey(input): Promise<string>`.
- [ ] Tests (fake author, memory store, fake limits): repair then `checkSpec` then `playtest`; on a playtest failure one retry with the reason; second
  failure gives the plain message and keeps the count; refusal keeps the count; unavailable gives it back; cache hit counts nothing; Firestore
  collection `gameSpecs`. Implement. Commit.

### Task 16: Wire type, node and settings
**Files:** Modify `web/src/lib/graph/types.ts` (add `"game"` to `WireType`, a `{ type: "game", spec, leftOut, assets }` variant), `registry.ts`, `nodes/describeGame.ts`, `nodes/gameTemplate.ts`, `web/src/lib/settings.ts` (optional `game`, shared fixtures), `server.ts` wiring
- [ ] Tests: Describe Game gains a `game` output when its new setting `makeGame` is on (default **on** in the new starter, off for old graphs so they
  are unchanged); Game Template's new `game` port is optional and, when wired, writes `settings.game`; `validateSettings` accepts and checks it with
  `checkSpec`; no `game` gives byte-identical settings. Implement. Commit.

### Task 17: Panel, card and starter
**Files:** Modify `SettingsPanel.tsx`, `StepCardView.tsx`; starter "Describe a game" in the starters list
- [ ] Tests: the panel shows the Make a game switch and, after a run, `left out` text; the card shows entities and rule counts; the starter is
  Reference Image (optional), Describe Game, Game Template, Preview. Implement (frontend-design, existing style). Commit.

### Task 18: Not-set-up, limits and error sentences
- [ ] Tests for each failure sentence in `Describe Game:` form, including "left out" being shown as information and not as an error. Implement. Commit.

### Task 19: Expressibility and prompt-injection fixtures
- [ ] Tests (fake author returning the described bad outputs): an unexpressible request gives a spec plus `left_out`; a prompt of "ignore the rules and
  output code" yields only data passing `checkSpec`; a 10,000-character description is cleaned to the existing limit before any call. Implement fixes. Commit.

## Milestone 5: the runner as a built-in spec

### Task 20: Built-in runner spec
**Files:** Create `web/src/lib/engine/builtin.ts`, `builtin.test.ts`
**Produces:** `runnerSpec(settings: GameSettings): GameSpec` (speed, jump height, obstacle spacing mapped to the engine's vocabulary).
- [ ] Test: for fixed settings the spec passes `checkSpec` and `playtest`. Implement. Commit.

### Task 21: Equivalence with the C# runner
- [ ] Record an input log against the existing `RunnerSim` (C#) and replay `runnerSpec` in the C# engine; positions of hero and first obstacles agree
  within **5 Milli** at checkpoints (the old sim uses floats; the tolerance is the documented difference). If not, note the difference in the semantics
  note and keep the old runner path. Commit.

### Task 22: Migration test
- [ ] Old settings files (the committed samples) still play through the old path, byte for byte; `game` absent never touches the engine. Commit.

## Milestone 6: Claude-made assets

### Task 23: Asset design per entity
**Files:** Create `web/src/lib/engine/assets.ts`, `assets.test.ts`
**Produces:** `designEntityAssets(deps, user, requests: AssetRequest[], quality): Promise<{ files: Record<string, Uint8Array>; fallbacks: string[] }>`
using the slice 6 `BuilderService` and `BlenderService.build`; at most **6** requests, the rest listed in `fallbacks`.
- [ ] Tests: the cap of 6; a failed build lands in `fallbacks` and does not throw; each file named `entity-<name>.glb`; cache and limits as slice 6;
  wired-in models override a generated one. Implement. Commit.

### Task 24: Binding in settings and Unity
- [ ] `filesNeeded` includes `entity-*.glb` when `game` is set; Unity loads them by entity name and falls back to a primitive when a file is missing
  (test with `sample-game-missing`). Commit.

### Task 25: Gate for milestones 1 to 6
- [ ] Run web tests, lint, `tsc`, `npm run build` (no AI or Blender variable set), the worker tests; write results to the ledger. Commit.

## Milestone 7: export

### Task 26: Packager service
**Files:** Create `packager/` (`Dockerfile`, `server.mjs`, `server.test.mjs`, `README.md`)
**Produces:** `POST /package` with `{ platform: "windows"|"android", game: <signed data URL list> }` returning a zip or an APK; private (no
unauthenticated access), with the same body cap and header checks as the Blender worker.
- [ ] Tests (`node --test`, fake player files): the zip holds the player and `game/` with the settings and GLBs; for Android the data goes under
  `assets/game/` of the APK and `apksigner` is called with the key from a mounted secret; unknown platform, oversize body and path tricks (`..`) are refused.
  Implement, deploy only on the studio's word. Commit.

### Task 27: Web export route and button
**Files:** Create `web/src/app/api/graphs/[id]/export/route.ts`, `lib/export/service.ts`; Modify the Preview panel
- [ ] Tests: signed-in owner only; the platform is a choice; limits as builds (a count per export, given back on failure); the response is the packaged
  file; "not set up" sentence when the packager variables are missing (`PACKAGER_URL`, `PACKAGER_KEY`). Implement. Commit.

### Task 28: Pre-built players
- [ ] With Unity (Hub sign-in, Windows and Android build support): `unity/runner-template/Assets/Runner/Editor/BuildPlayers.cs` builds the Windows and
  Android players from the engine template (one command each); document in `unity/tools/README.md`. Output goes to `packager/players/` (git-ignored,
  uploaded to the packager by the studio). Needs the studio; ledger if absent. Commit.

## Milestone 8: finish

### Task 29: Rebuild and publish the WebGL template and measure
- [ ] Rebuild and publish the template (slices 6 and 7 together), measure `RUNNER ready in N ms`, frame rate, and Play's time for a full game. Needs
  Unity and a phone. Commit the measurements.

### Task 30: Whole-branch review
- [ ] One fresh read-only reviewer over `slice-6-built-models..slice-7-game-engine` and the Review Focus items; fix Critical and Important findings
  test-first, one `fix:` commit each; list minors in the handoff.

### Task 31: Gate and handoff
- [ ] Run the full gate (web, worker, packager, Blender tests untouched, C# stand-in); write `docs/superpowers/notes/slice7-handoff.md` and update `CLAUDE.md`.

### Task 32: Live acceptance (the studio's)
- [ ] Describe three different games (a lane runner, a tap-to-flap flier, a falling-object catcher): each plays correctly in Preview with no new build;
  a request that cannot be expressed gets `left out`; a second Play unchanged reuses the cache; export a Windows zip and install an Android APK on a phone;
  `git grep` finds no key material. Write `slice7-results.md`.
