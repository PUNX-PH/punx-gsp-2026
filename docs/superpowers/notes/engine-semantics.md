# Engine semantics (slice 7)

The one description of how a GameSpec plays. The TypeScript simulator (`web/src/lib/engine/`) and the C# engine
(`unity/runner-template/Assets/Runner/Runtime/Engine/`) both implement exactly this; shared fixtures keep them equal. A change here is a change to both.

## Numbers and time

- One step is 1/60 s. Time in the spec is in milliseconds; the engine converts with `steps = floor((ms * 60 + 500) / 1000)`, at least 1. The first step runs with `step = 1`.
- **Milli**: every position, size, speed and counter is an integer in thousandths of a unit (1 unit = 1000). Speeds are Milli per second; a step moves
  `speed / 60` truncated toward zero (C# `long` division, TS `Math.trunc`). Products use 64-bit integers (TS: values stay under 2^53 by the clamps).
- Counters clamp to **-1,000,000 to 1,000,000** after every change.
- Random: `xorshift32` seeded from `spec.seed` (an integer 1 to 4294967295, default 1): `x ^= x << 13; x ^= x >>> 17; x ^= x << 5` on uint32. Only
  `spawn` uses it, one draw per spawned object unless the pattern says otherwise: `next() % n` for a choice among n.

## Step order

Each step runs, in this order: (1) input, (2) controls, (3) moves, (4) spawns, (5) collisions, (6) rules in written order, (7) cleanup, (8) ends.
Events raised in a phase are queued and handled in phase 6 in the order raised; actions run immediately; an action may raise more events, which are
handled in the same phase after the queue (at most 200 actions per step, then the round is `lost`).

## World

The play field is `0..width` by `0..height` Milli, origin at the lower left, y up. `scroll` moves every `platform`, `hazard` and `pickup` toward -x
(camera `side`) or -y (`top`, `behind`) by `scroll / 60` per step, added to its own moves. `gravity` (Milli per second squared, may be 0) adds to the
hero's vertical speed each step when the hero has a `jump` or `flip` control: `vy -= gravity / 60`.

## Who exists at the start

The hero, every spawner, and every entity that is not a **template** exist at step 0, in declaration order, at their `x`,`y`. A template is an entity that a `spawn` behavior or `spawn` action names, or the first `projectile`: it exists only as the objects made from it. A made object starts at the position its spawner or action gives and takes its velocity from its own `move` or `fall` (scaled by the ramp and `speedUp`, or replaced by the spawner's nonzero `speed`).

A counter named `time` is set to the whole seconds elapsed (`step / 60`, truncated) at the start of phase 1.

## Behaviors

| name | parameters | meaning |
|---|---|---|
| `move` | `dir` (`left`,`right`,`up`,`down`), `speed` | constant velocity in `dir` |
| `lane` | `count` (2 to 5), `switchMs` | the entity sits in one of `count` equal lanes across the axis perpendicular to travel (y for camera `side`, x for `top` and `behind`), starting in lane `count / 2` rounded down; lane i has its center at `span * (2i + 1) / (2 * count)`; a `switchLane` control moves it one lane over `switchMs` |
| `oscillate` | `axis` (`x`,`y`), `amplitude`, `periodMs` | triangle-wave offset around the start position, integer math |
| `fall` | `speed` | constant downward speed (like `move` `down`) |
| `follow` | `target`, `speed` | each step moves toward the nearest live entity of type `target` at `speed`, per axis, never overshooting |
| `control` | `on` (`tap`,`hold`), `does`, `power` | input drives an action, see Controls |
| `spawn` | `entity`, `pattern`, `intervalMs`, `speed`, `ramp` | makes the entity a **spawner**: it is neither drawn nor collidable (its `w` and `h` may be 0) and its `x`,`y` is where `stream` spawns; see Spawn patterns. A nonzero `speed` replaces the spawned entity's `move` or `fall` speed |
| `lifetime` | `ms` | the entity is destroyed after `ms` |

## Controls

| name | meaning |
|---|---|
| `jump` | on input, if the entity is on the floor (its y is at or below its start y), `vy = power`; a jumper cannot fall below its start y |
| `flap` | on input, `vy = power` wherever the entity is |
| `flip` | on input, gravity direction for this entity flips sign |
| `fire` | on input, spawns the first `projectile` entity type at the entity with `vy = power` (cooldown 10 steps) |
| `switchLane` | on input, moves one lane toward the end it is not at (alternates) |
| `thrust` | while `hold` is on, `vy += power / 60` each step, otherwise gravity applies |

## Spawn patterns

| name | meaning |
|---|---|
| `random` | at the far edge (x = width for `side`, y = height for `top` and `behind`), along the other axis at `next() mod (span - size + 1)` (0 when the span is smaller than the size) |
| `lanes` | at the far edge, in lane `next() mod count` of the hero's `lane` count, positioned like the lane behavior (its center on the lane center) |
| `wave` | along the edge at `trunc((span - size) * v / 60)` where `ph = step mod 120`, `v = ph <= 60 ? ph : 120 - ph`; no random draw |
| `rain` | at the top edge (y = height), x as `random` along the width |
| `stream` | at the far edge, at the spawner's own position |

Spawn timing: the first spawn after `intervalMs`, then every `intervalMs`. With `ramp`, the interval shrinks and the speed grows by the difficulty ramp.
A spawn is skipped (silently) when 150 objects are live or when it would exceed 10 spawns in the last 60 steps.

## Events

| name | parameters | raised when |
|---|---|---|
| `start` | none | the first step |
| `tick` | `everyMs` | every `everyMs` of game time |
| `tap` | none | the input is newly pressed |
| `hold` | none | every step the input is held |
| `release` | none | the input is newly released |
| `collide` | `a`, `b` | a live `a` and a live `b` overlap (once per pair per step) |
| `exitBounds` | `entity` | a live object of that type is completely outside the field |
| `counterReaches` | `counter`, `value` | the counter first becomes `>= value` (once per crossing) |

Overlap: `box` against `box` by closed intervals on both axes; `circle` is the circle of diameter `min(w,h)`; mixed pairs use the circle's bounding box.

Cleanup (phase 7) removes destroyed objects and any object other than the hero that is outside the field by more than its own size.

## Conditions

A rule's `when` is a list of `{ counter, op, value }` joined by `and`; `op` is `<`, `<=`, `==`, `>=` or `>`. An empty or missing list is true.

## Actions

| name | parameters | meaning |
|---|---|---|
| `add` | `counter`, `n` | `counter += n`, clamped |
| `set` | `counter`, `n` | `counter = n`, clamped |
| `destroy` | `target` (`a`,`b`,`self`) | the object is removed at cleanup; `a` and `b` are the colliding pair of a `collide` event, `self` is the exiting object of an `exitBounds` event and the hero otherwise |
| `spawn` | `entity` | creates one object of that type at its own start position |
| `bounce` | `target` (`a`,`b`) | the object's vertical speed is negated |
| `win` | none | the round ends `won` |
| `lose` | none | the round ends `lost` |
| `speedUp` | `percent` | every spawner's speed grows by `percent` (at most +300 total) |

## Ends

`ends.timeLimitMs` (0 for none): when game time reaches it, the round is `won` if `ends.winOnTime` is true, else `lost`. `ends.scoreToWin` (0 for none):
the round is `won` when `score >= scoreToWin`. If a counter named `lives` exists and reaches 0 or less, the round is `lost`. The first end reached in
rule order wins; after an end no more steps change anything.

## Difficulty

`difficulty.rampMs` (0 for none) is the time over which spawn speed grows to `+speedPercent` percent (cap 300) and spawn intervals shrink by
`spawnPercent` percent (cap 90), linearly by integer step: `factor = min(step, rampSteps) * percent / rampSteps` (integer division).
