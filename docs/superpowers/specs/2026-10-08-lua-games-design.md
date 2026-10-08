# Slice 8: games written as scripts (Lua in the Unity player) — design

Status: draft for review (2026-10-08). Adds a second way for Describe Game to make a game, with no limit on what the game can do. Slice 7's rules engine stays as the simple mode.

## Purpose

A creator describes **any** game in words, with pictures, and gets that game. The fixed vocabulary of slice 7's rules engine will always have limits; here Claude writes the game's logic as a script,
so a platformer, a shooter, a puzzle or something nobody has named is limited only by the game API below. Success: five games a creator would call unlike each other (for example a lane runner, a
top-down shooter with several enemy kinds, a platformer with moving platforms, a bouncing-ball breaker, a timing game with a health bar), each described in words, play correctly in the published
player with **no new Unity build**, and the same files make a Windows zip and an Android APK.

## Constraints (carried over)

- The runtime is the **pre-built Unity player** (WebGL in Preview, Windows and Android as packaged builds). Unity's terms bar a server running the Editor for other people's games, so no per-game build,
  and no generated C#: a built player cannot compile new C#, and its Runtime is distributed as it was built.
- Blender still builds the models Claude asks for (slice 6's builder); the node canvas, sign-in, caches, limits, export and the packager are unchanged.
- **Code now exists in a game, so where it runs is the whole safety story.** A script runs only inside the player's interpreter, on the player's own machine (the browser's WebGL sandbox, a Windows or
  Android process), and sees only the game API: no files, no network, no OS, no secrets, no way to load other code. Nothing generated ever runs on our servers. Limits keep a script from hanging or
  flooding the player. The creator's own uploads and prompts stay untrusted input.
- Unity AI is an Editor tool for developers and is not used.
- Smallest thing that works: the API below is the first version and grows only when a described game needs it.

## The script and its API

One Lua file (`game.lua`, at most 64 KiB, Lua 5.2 semantics as MoonSharp gives them). Callbacks the script may define (all optional, at least one of `update`, `on_tap`, `on_drag` or `init` required):
`init()`, `update(dt)`, `on_tap(x, y)`, `on_hold(x, y)`, `on_release(x, y)`, `on_drag(x, y, dx, dy)`, `on_collide(a, b)`, `on_exit(obj)` (left the field).

Globals (units are whole game units, y up, z away from the screen):

| Table | What it offers |
|---|---|
| `game` | `game.win(message)`, `game.lose(message)`, `game.score`, `game.lives` (read and write numbers), `game.time` (seconds played), `game.width`, `game.height`, `game.over` |
| `world` | `world.spawn(kind, props)` returns an object; `world.find(tag)`, `world.count(tag)`, `world.clear()`, `world.gravity(g)`, `world.bounds(w, h)`, `world.camera{ mode = "side"\|"top"\|"chase"\|"fixed", follow = obj, x, y, z, zoom }` |
| objects | fields `x y z vx vy vz w h d tag alive color data` (`data` is the script's own table); methods `obj:destroy()`, `obj:set_color(c)`, `obj:play(animation)`, `obj:distance(other)`. `kind` is a model name from the game's assets or a primitive (`box sphere capsule cylinder cone plane`). Props: position, size, color (palette slot 1 to 5 or `#rrggbb`), velocity, `gravity`, `solid`, `tag`, `life` (seconds), `spin` (degrees a second) |
| `input` | `input.x`, `input.y` (pointer in field units), `input.down`, `input.dx`, `input.dy` |
| `ui` | `ui.text(id, string, { x, y, size, color, align })`, `ui.bar(id, value, max, { x, y, w, h, color })`, `ui.clear(id)` |
| `timer` | `timer.after(seconds, fn)`, `timer.every(seconds, fn)` return an id; `timer.cancel(id)` |
| globals | `rand()` (0 to 1, seeded: the same game plays the same), `rand_int(a, b)`, `print(...)` (to the developer log), and the `math`, `string` and `table` libraries without `math.random` |

Collisions and gravity are the player's own light implementation (boxes and circles, no Unity physics module). `on_collide` is raised for pairs of `solid` objects that overlap.

**Not available:** `os`, `io`, `debug`, `require`, `load`, `loadstring`, `dofile`, `collectgarbage`, `coroutine`, `setmetatable` on globals, anything not listed. MoonSharp's hard sandbox preset is the base; the host removes the rest.

## Limits (enforced by the player)

Instructions per frame **200,000** (the interpreter yields every N instructions and the host treats a yield as "over budget": the game stops with a plain message); objects alive **300**; spawns per second **120**;
timers **50**; ui elements **24**; string length **2,000**; table size read from `data` is the script's own. A frame that takes more than 250 ms for three frames in a row stops the game. Any Lua error stops the game
and shows "The game stopped: <message> (line N)" with a **Describe again** hint; the first error is also written to the developer log. A stopped game never takes the page down.

## Making the game (web side)

1. **Describe Game** gains a mode, **Make a game: Script** (the default for new steps; **Rules** is slice 7's mode; **Off** is the old colors and feel). `makeGame` becomes `"script" | "rules" | "off"`; a saved `true` means rules, `false` means off.
2. **Claude writes** `{ script, leftOut, assets }` in structured outputs (a string, a string and a list: small, so no grammar problem). The system prompt states the API and the limits, how to say what was left
   out, and carries **two or three complete example games** (the corpus below); the person's words stay in the user's turn.
3. **The server checks** the script before accepting it: size, valid Lua syntax (one new dependency, a small pure-JS Lua parser, to be approved at the plan), none of the removed names used as identifiers, at least one required
   callback, assets named `[a-z][a-zA-Z0-9]{0,15}` with at most 6. A failure gets **one retry** that says why. There is **no server-side playtest**: only the player can run a script. That is the cost of "no limits", and
   it is why runtime errors are shown plainly and why a regenerate path exists.
4. **Assets** are built exactly as in slice 7 (`designEntityAssets`); an asset that fails is a plain shape. The script refers to models by name.
5. **Game Template** writes a settings file with `"script": { "file": "game.lua", "models": ["hero", "coin"] }` (plus the filler runner fields and a five-color palette, as slice 7 does), and the run holds `game.lua` and one
   `entity-NAME.glb` per model that exists. A model named in the script but with no file is a box.
6. **Cache and limits** as slice 7: the game is cached per person (as text), one AI count per call (retries count), counts given back on failure. **Regenerate:** Describe Game gets a **Try again** switch, off by default, that skips the cache once;
   a changed description is a new key as ever.
7. **Export:** the packager accepts `game.lua` (name and size checked) beside `settings.json` and the models; Windows and Android builds read it from `StreamingAssets/game/` as they do now.

## Running the game (Unity side)

`Runtime/Script/`: `ScriptHost` (MoonSharp, the sandbox preset, the removed names, the instruction budget through a yielding coroutine, error capture), `GameApi` (the tables above, bound to the host), `ScriptWorld` (objects, collisions, gravity, timers,
spawn caps), `ScriptView` (draws objects with the existing model loading and primitives made in code, the camera modes, the ui). `RunnerBootstrap` chooses by the settings: a `script` key plays the script, a `game` key plays the rules engine, neither plays the
runner as before. MoonSharp is vendored into the project as source (BSD-3-Clause, its licence file kept beside it); it is pure C#, so IL2CPP and WebGL builds carry it.

## Tests

- **Web (Vitest, no new runtime dependency beyond the parser):** the script checks (every refusal), the prompt (built from one table of the API so the prompt, the checks and the docs cannot disagree), the author, the service
  (retry, cache, limits, regenerate), the node, Game Template, Preview, the packager's new file, and settings.
- **Unity EditMode** (needs the Hub sign-in): the sandbox (each removed name is nil or an error, an infinite loop is stopped by the budget, a huge allocation loop hits the object or string caps, an error stops the game without throwing out of the host), the API
  contract (one test per table entry), collisions and gravity, timers, and **the example games**: each `Tests/Scripts/*.lua` is run for N frames with scripted input and must reach its expected score or state.
- **Unity PlayMode:** each example game boots to ready in the player, draws objects, and ends in `win` or `lose` when driven; a script with an error shows the message and the page survives.
- **The example corpus** (about ten games across genres) is both the test set and the source of the prompt's examples, and the web side syntax-checks every one.

## Risks and open points

- **No server-side playtest** (above): some generated games will not work, will be unfair or will be dull. Mitigation: examples in the prompt, the retry, plain errors, **Try again**.
- **MoonSharp** has been unmaintained for years (it still runs on IL2CPP and WebGL in practice). The first milestone is a spike that proves it in this player (WebGL build, the instruction budget, the sandbox) before anything else is built; if it fails,
  the fallback is another pure-C# interpreter and the API in this spec does not change.
- **Unity cannot run today** (Hub sign-in): the spike, every Unity test and the rebuilt template wait for it. Web-side work can be built and tested first.
- **Fairness of Lua's `math.random`:** replaced by the seeded `rand()` so a game replays the same; scripts that need more get `rand_int`.
- **Script size and token cost:** a 64 KiB script is a lot of tokens; the prompt asks for small games and the cap on output tokens bounds a call.

## Build order (one plan, milestones)

1. **Spike** (needs Unity): MoonSharp in the template, a WebGL build, the budget and the sandbox, measured size and start time.
2. The game API and host in C#, with the sandbox and API tests and the first three example games.
3. The view: objects, camera modes, ui, the end screen, the error screen.
4. The web side: the script checks and parser, the prompt and author, the service, the node mode and settings, Game Template and Preview, the packager, **Try again**.
5. The example corpus (about ten games), the prompt's examples, the live prompt check.
6. Rebuild and publish the template and the players (slice 7's Task 29 included); live acceptance with the five unlike games.

## Not in this slice

Sound, multi-touch, saving, networking, 3D physics, text entry, levels loaded from separate files, a script editor, sharing games between people, and any change to the rules engine.
