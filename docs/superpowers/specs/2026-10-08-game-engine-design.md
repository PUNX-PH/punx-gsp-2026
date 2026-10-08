# Slice 7: the game engine (a described game, not a template) — design

Status: draft for review (2026-10-08). Replaces "Describe Game tunes one fixed runner" with "Describe Game writes a game".

## Purpose

A creator describes a hypercasual game in words, with pictures, and gets that game, not one fixed template. Success: three quite different
hypercasual games (for example a lane runner, a tap-to-flap flier, a falling-object catcher) are each described in words and play correctly in
the published player with **no new Unity build**.

**The creator describes the game; the platform generates all of it.** The game runs in Unity (the pre-built WebGL player), and **Claude handles the
assets**: for every entity in the spec Claude also writes the asset (a Blender recipe, built by the private worker), so the creator wires no art nodes.
Uploaded models and pictures remain optional references.

## Constraints (carried over)

- Hypercasual only: one core mechanic, one-touch controls, about a minute a session, low-poly or flat art, small builds.
- **Data, never code.** Claude returns a GameSpec in a fixed JSON schema; the web app repairs it and the player repeats every check. A hostile
  prompt can at worst make a small, bounded game. Nothing in a spec is evaluated as an expression or run as a script.
- The runtime is a **pre-built Unity WebGL player** that reads the spec (Unity's terms bar cloud Editor builds). Blender still prepares the art.
- The node canvas, sign-in, caches, limits and the Play flow are unchanged. The current runner keeps working.
- Smallest thing that works: the vocabulary below is closed and is grown only when a described game needs it.

## GameSpec

One JSON document, versioned (`"engine": 1`). Sections:

- **world**: `camera` (`side`, `top`, `behind`), `gravity` (number, may be 0), `bounds` (width, height or lane count), `scroll` (speed, may be 0).
- **entities**: up to 12 named types. Each has `role` (`hero`, `hazard`, `pickup`, `platform`, `projectile`), `model` (an input name from the
  graph, or a primitive: box, sphere, capsule, cylinder), `size`, `collider` (`box`, `circle`), `color`, and `behaviors`.
- **behaviors** (closed list, each with numeric parameters):
  `move{dir,speed}`, `lane{count,switchTime}`, `oscillate{axis,amplitude,period}`, `fall{speed}`, `follow{target,speed}`,
  `control{tap|hold -> jump|flip|fire|switchLane|thrust}`, `spawn{entity,pattern,interval,speed,ramp}`, `lifetime{seconds}`.
  Spawn patterns: `random`, `lanes`, `wave`, `rain`, `stream`.
- **rules**: up to 40 of `{ on, when?, do[] }`.
  - Events: `start`, `tick(every N s)`, `tap`, `hold`, `release`, `collide(A,B)`, `exitBounds(A)`, `counterReaches(name,value)`.
  - Conditions: comparisons of named **counters** (`score`, `lives`, `time`, plus up to 6 more) with numbers: `<`, `<=`, `==`, `>=`, `>`, and `and`.
  - Actions: `add(counter,n)`, `set(counter,n)`, `destroy(A|B)`, `spawn(entity)`, `bounce(A)`, `win`, `lose`, `speedUp(factor)`.
- **ends**: how a round finishes (`lose` when lives reach 0, `win` at a score, or time up), and the score shown.
- **difficulty**: a ramp of spawn interval and speed over time, with caps.
- **look**: palette and feel from today's Describe Game output, kept as they are.

Caps (checked on both sides): entities 12, rules 40, counters 9, live objects 150, spawn rate 10 per second, rule actions per tick 200, spec size 64 KiB.

## Engine semantics

Fixed timestep (60 Hz), deterministic given the spec and the input log. Order each step: input, controls, moves, spawns, collisions, rules
(in the written order), cleanup, ends. Counters are numbers, clamped. The semantics are written once in `docs/superpowers/notes/engine-semantics.md`
(the first task) and implemented **twice**: C# in the player (`Runtime/Engine/`) and TypeScript in `web/src/lib/engine/` (the simulator). A shared
fixture set (specs, input logs, expected state at checkpoints) keeps the two equal, as the kit does.

## Making the game (web side)

1. **Describe Game** gains a new output, `game` (a GameSpec), beside `palette` and `feel`. Claude Sonnet 5.5 writes it in structured outputs, from the
   words, the picture, and the list of models wired in. Same limits, caching (`RECIPE_VERSION` style key) and "give back on failure" as Build Model.
2. **Repair**: clamp numbers, drop unknown behaviors, rules and actions, fix references, enforce the caps.
3. **Playtest** (`web/src/lib/engine/playtest.ts`): the simulator runs the spec for 60 s of game time with three bots (idle, random taps, a simple
   reactive bot). It rejects a spec that is lost within 3 s with idle input, cannot be lost or won by any bot in 60 s with no way to end, or breaks a
   cap. One repair retry goes back to Claude with the reason; then a plain message.
4. **Game Template** accepts the spec and writes it into the settings file (`game` key); no `game` key means today's runner, byte for byte.
5. The current runner is expressed as a **built-in spec** and the old settings are translated to it, so old graphs and settings play as before.
   A test proves the built-in spec behaves like the C# runner on a recorded input log.

## Making the game (Unity side)

`Runtime/Engine/`: `SpecParser` (raw text, same messages as the web), `World`, `Entity`, `Behaviors/*`, `RuleEngine`, `Spawner`, `Collisions`
(box and circle only, no physics module), `EngineView` (draws entities with the existing model loading, lit look and quality governor), `Hud`.
Entities draw with the glTF models the graph supplied or built-in primitives made in code (no `CreatePrimitive`). Touch or click is the only input.

## Build order (one plan, milestones)

1. Semantics note, GameSpec types, schema, repair and checks (web), shared fixtures.
2. TypeScript simulator and playtest, with the fixtures.
3. C# engine, run against the same fixtures (compiled and run on the .NET stand-in until Unity can run).
4. Claude authoring: prompt, schema, cache, limits, the repair retry; Describe Game and Game Template changes; settings contract.
5. The runner as a built-in spec; migration and the "old games play the same" tests.
6. **Claude-made assets:** each entity carries an `art` request (a role, a kind and a short description). A new step in Play designs each entity's
   recipe (the Build Model designer, reused), builds it on the worker (Standard by default, High on request), caches it, and binds the GLB to the
   entity; an entity whose build fails falls back to a flat primitive of its color. Wired-in models, when present, override the generated ones.
   The canvas starter "Describe a game" is Reference Image (optional), Describe Game, Game Template, Preview. Limits and give-back rules as in slice 6;
   a game of up to 12 entities can cost up to 12 Blender jobs, so the plan must cap generated assets per game (proposed: 6, the rest primitives).
7. Rebuild and publish the template, measure, live checks (needs Unity Hub sign-in, a phone, the funded key).

## Risks and open points

- **Unity cannot run today** (Hub sign-in). Milestone 3's engine is proven only by the shared fixtures on the stand-in; shaders and PlayMode stay
  unproven until sign-in, as in slice 6.
- **"Any game" is bounded by the vocabulary.** Games that need physics, text input, multiple touches or 3D navigation are out. A request that cannot be
  expressed gets the nearest expressible game and a plain note saying what was left out (the playtest cannot detect this; Claude is told to say it).
- **Cost and time** of one authoring call plus one retry, and Play's total time, are unmeasured.
- **Two implementations can drift**; the fixtures and a mutation check of each rule step are the guard.

## Not in this slice

New genres of input (swipe, drag, multi-touch), sound, saved or shared games, multiplayer, a visual rule editor, a compression library.
