# Slice 4: Describe Game (the AI step)

Date: 2026-10-04. Status: awaiting review. Path: architectural (a new subsystem that calls an external service). Builds on the
graph engine (`2026-10-03-graph-engine-design.md`) and the node canvas (`2026-10-04-node-canvas-design.md`), both live at
https://punx-gsp.vercel.app. The v1 spec (`2026-10-02-studio-platform-v1-design.md`) planned this step as "Prompt and Describe Game";
this spec settles it.

## Purpose

A signed-in `@punx.ai` person types a short description of the game they want, optionally gives a reference picture, and presses Play.
A Claude model turns the words and the picture into the game's palette and its three tuning numbers (how fast, how high the hero
jumps, how far apart the obstacles are). The game plays with those colors and that feel. Today the person picks the picture, the
palette is taken from its pixels, and the numbers come from three sliders; this step lets words and a picture drive all of it.

This slice sets the **look and feel** of the one existing runner template. It does not generate shapes or any 3D assets (slice 5), and
it adds no second template, so a prompt can change how the game looks and feels, not what it is.

**Done for this slice** (each is a check on the live site):

1. Signed out, nothing can trigger an AI call (every graph page and API call is still refused).
2. A person makes the "Describe a game" graph, types a prompt, picks a picture, presses Play, sees the five colors, the three numbers
   and a one-line summary on the Describe Game card, and plays a game with those colors and that feel.
3. Pressing Play again with nothing changed shows "Reused your earlier answer" and makes no new call.
4. Changing the prompt (or the picture) gives a new answer.
5. Plain refusals, each on the step: an empty prompt, a prompt over 500 characters, the daily limit reached, the AI service failing,
   and Claude declining the request.
6. An answer whose numbers cannot be played is repaired or refused plainly (unit-tested with a fake).
7. No secret is in the repository, the API key exists only in Vercel, and the spend shows in the Anthropic console.

## Decisions made with the studio

| Decision | Choice | Why |
|---|---|---|
| What this slice delivers | Prompt and picture set the palette and the three tuning numbers of the existing runner | With one template and built-in shapes, that is all a prompt can change. Generated assets are slice 5 (the v1 spec rules out AI 3D generation for v1: shapes come from uploads or from low-poly shapes Blender can make). |
| Where the prompt is typed | In the Describe Game step itself (a text box), not a separate Prompt step | One step with a prompt and a picture is how people describe it. A separate Prompt step and a `text` wire can come later, if one prompt ever needs to feed several steps. |
| How it runs | Inline in Play, with a cache | Vercel functions run up to 5 minutes by default (Hobby too), so a call of a few seconds needs no queue. Unchanged inputs reuse the stored answer, which makes re-Plays free and repeatable. This is the first slow node, so caching (deferred in the 3a spec) arrives here. |
| Rejected | A "Generate" button outside Play; a background job queue | The button makes the step not a pipeline step and adds a stale state; the queue is for slice 5's Blender jobs. |
| Model | Claude Sonnet 5.5 (`claude-sonnet-5-5`), one named setting | About 1 to 2 US cents per new answer. A change of model is a change of one value. |

## Out of scope for this slice

A separate Prompt step and a `text` wire; generating shapes, models or any 3D asset (slice 5); a second template; editing the AI's
answer by hand (unplug the wire to use the sliders); several pictures; prompt history or chat refinement; a cost screen; streaming
progress while the model works.

## What the person sees

- **A new step, Describe Game.** Its side panel has a text box "Describe your game" (up to 500 characters) and, under it, one plain
  line: "Your description and picture are sent to Anthropic's Claude to make this." It has one optional input, a picture, and two
  outputs, a **palette** (the existing wire type) and a **feel** (a new wire type carrying the three tuning numbers).
- **Game Template** gets one new optional input, **feel**. When a feel is wired in, the three sliders show the AI's numbers and are
  locked with the note "Set by Describe Game"; unplug it and they are the person's again. The palette input behaves as it does now.
- **On the card,** after Play: five swatches, "speed 7 · jump 2.4 · spacing 14", and the AI's one-line summary (plain text). A cached
  answer says "Reused your earlier answer".
- **A second starter graph,** "Describe a game": Reference Image, Describe Game, Game Template, Preview. The empty-graph screen and
  the New graph button offer it next to the existing starter (picture, Palette from Image, Game Template, Preview), which keeps
  working with no AI and no cost. A second starter avoids the clash of two palette wires into one input (an occupied input refuses a wire).
- **Plain errors on the step:** "Describe your game first." / "The description is longer than 500 characters." / "The AI could not
  make a playable game from this. Try different words." / "You have used today's AI answers. Try again tomorrow." / "The AI service
  did not answer. Try again." / "The AI declined this request. Try different words."

## Architecture

```
Play -> runner -> Describe Game executor -> answer cache (Firestore)  hit: the stored answer
                         |                                            miss: limits -> DescribeGame port -> Claude
                         +-> check and repair the answer -> outputs { palette, feel } -> Game Template -> Preview
```

### The engine changes (the only changes outside the new step)

- **A step may have several outputs.** Today an executor returns one `output` and the runner hands it to every wire leaving the step.
  An executor may now return `outputs`, a map from output port name to value; `output` stays as the shorthand for a step with one
  output port. The runner routes each wire by its `from.port`. Tested with a fake two-output step in `runner.test.ts` (a wire from
  each port reaches the right input; a failed step still skips what depends on it).
- **A new wire type, `feel`:** `{ type: "feel", tuning }`, with the plain word "feel" in `WIRE_WORDS`, a color in each theme (held
  to the contrast test) and the wire rule unchanged (it is generic over `WireType`).
- **Game Template** reads `inputs.feel` when present and then ignores its own `tuning` setting; the saved setting is kept, so
  unplugging restores the sliders' values.
- **The palette guard is split out.** `makePalette` ends with the slot and readability rules (score on the background 4.5, HUD text
  on the panel 3, ground on the background 1.5). That part becomes `guardPalette(slots)` so it can also run on five given colors;
  `makePalette` calls it, so its behavior and tests do not change.
- **`ExecutorContext` gains `ai`,** the Describe Game service (cache, limits and the port below), wired in `lib/graph/firebase.ts`
  with in-memory fakes in tests, the same pattern as the stores.

### The Describe Game step

- **Settings:** `{ prompt: string }`. Saving refuses a non-string or a prompt over 500 characters (counted in characters, not bytes);
  an empty prompt can be saved (a half-built graph can always be saved) and stops Play with "Describe your game first."
- **Inputs:** `image` (optional). If a wired source failed, the step is skipped, as for every step.
- **Outputs:** `palette`, `feel`. Its result (shown on the card) is `{ palette, tuning, summary, reused }`.

### The AI call

- **Port:** `describeGame({ prompt, picture? }) -> { palette, tuning, summary }`, with a fake for tests and one real adapter, so every
  rule in this spec is tested without the network. The real call is first exercised on the live site.
- **Adapter:** Anthropic's TypeScript SDK (`@anthropic-ai/sdk`, a new dependency, installed only with the studio's yes), server side only.
  The model comes from one constant, overridable by `AI_MODEL`. The request has **no tools**, a low effort setting, a 60 second timeout,
  and asks for a JSON answer in a fixed shape (structured output): `palette` with named colors `background`, `ground`, `panel`,
  `accent` and `score` (each `#rrggbb`), `tuning` with `speed`, `jumpHeight` and `obstacleSpacing`, and `summary` (at most 140
  characters). The ranges (speed 1 to 20, jump 1.5 to 5, spacing 4 to 40) are in the prompt and checked afterwards, not trusted. The
  exact request fields are taken from Anthropic's current API reference when the adapter is written (not from memory), and the
  server-side refusal fallback the guide recommends for this model is included unless the studio declines it.
- **The picture** is read by the existing image reader, re-encoded by `sharp` as a JPEG of at most 1024 pixels on its long side, and
  sent in place of the upload: metadata is dropped and the token cost stays small.

### Checking and repairing the answer

Nothing the model says is trusted.

1. The JSON is parsed against the fixed shape; colors must be `#rrggbb`; numbers finite and in range; the summary a string of at most
   140 characters with no control characters. Any miss fails the step ("The AI could not make a playable game from this...").
2. The five named colors are put in the template's slot order (background, ground, panel, accent, score) and run through
   `guardPalette`, so the HUD stays readable whatever the model chose.
3. The tuning goes through `winnabilityError`, the same rule the game uses. If that is the only problem, `obstacleSpacing` is raised
   to the smallest playable value (deterministic, no second call). Any other failure fails the step.
4. The summary is only ever shown as plain text (React escapes it).

### The cache

Firestore collection `aiAnswers`, one document per answer, with the id the SHA-256 of `[version, model, uid, prompt trimmed,
picture hash or none]`. It holds the checked answer, the time and the token counts. The person's uid is in the key, so nobody can
reuse (or infer) another person's prompts. Entries do not expire in this slice (they are a few hundred bytes). Two simultaneous
Plays that both miss may both call the model: accepted, it costs a cent.

### Limits

- **Per person:** 30 new answers per UTC day (`AI_DAILY_LIMIT_PER_PERSON`). A counter document `aiUsage/{uid}_{yyyymmdd}` is
  incremented in a Firestore transaction **before** the call and given back if the call failed for a reason that is not the person's
  (the service, a timeout), not when Claude declined.
- **Whole site:** 300 a day (`AI_DAILY_LIMIT_TOTAL`), a document `aiUsage/total_{yyyymmdd}`, in case a bug ever loops.
- **Real cap:** the monthly spend limit set in Anthropic's console.
- Cache hits cost no count. Both limits are env settings (not secrets), so a test can set them low on the live site.

### Settings and secrets

| Variable | Kind | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret, Vercel Sensitive, server only | The studio's Anthropic key. Never in the repository, never logged, never sent to the browser. |
| `AI_MODEL` | plain, optional | Overrides the default model. |
| `AI_DAILY_LIMIT_PER_PERSON`, `AI_DAILY_LIMIT_TOTAL` | plain, optional | The limits above (defaults 30 and 300). |

Firestore rules stay deny-all; everything goes through the Admin SDK on the server.

## Security

- The prompt and the picture are untrusted input. The model has no tools and its answer is checked, so an instruction hidden in a
  prompt or in the picture can at worst produce odd but valid colors or numbers, or wasted cost, which the limits bound.
- The checks above run on the server; the browser is never trusted with a limit, a cache key or a model name.
- Failures are reported by kind in plain words; the SDK's or the service's own messages are never shown or logged. Logs carry the
  graph id, the step, the outcome and token counts, never the prompt, the picture or the key.
- **Data leaves the studio.** The description and a downscaled copy of the picture go to Anthropic. The panel says so in one line.
  Whether that suits the studio's data terms is the studio's decision, and it should be made before the live check.
- Ownership is unchanged: a person can only run their own graph, and the cache is keyed by person.

## Error handling

| Cause | On the step |
|---|---|
| Empty prompt | "Describe your game first." |
| Over 500 characters | "The description is longer than 500 characters." (also refused on save) |
| Answer not in shape, out of range, or unplayable beyond repair | "The AI could not make a playable game from this. Try different words." |
| Daily limit (person or site) reached | "You have used today's AI answers. Try again tomorrow." (the site limit says "The AI is busy today. Try again tomorrow.") |
| Service error, timeout, or a missing or rejected key | "The AI service did not answer. Try again." (a missing or rejected key is also logged by kind, for the studio) |
| Claude declines (`refusal`) | "The AI declined this request. Try different words." |

A failed step marks what depends on it as skipped, as for every step; nothing else in the graph is affected.

## Testing and acceptance

- **Test-first, pure code, with fakes:** the two-output runner; the `feel` wire through the wire rule and the canvas edits; the Describe
  Game checks (`shapeProblem`, `incompleteProblem`, an empty prompt, 500 characters and 501, an emoji counted once); the executor with
  a fake port (a hit, a miss, the limits, the refund, a refusal, a timeout); answer checking (a table of bad shapes, bad colors, out-of-range
  numbers) and repair (spacing raised, jump too low failing); `guardPalette` on the same cases `makePalette` already has; the cache key
  (the same inputs give the same key, any change gives another, a different person gives another); Game Template with and without a feel.
- **Render tests:** the Describe Game card (swatches, numbers, summary, "Reused your earlier answer", each error), the settings panel (the
  box, the counter, the notice), the locked sliders, the Add menu entry, the second starter, the contrast of the new wire color in both themes.
- **Deployed checks, in a real browser** (needs the Anthropic key and a spend limit set by the studio): the seven done-criteria above;
  a prompt with and without a picture; a very long and a hostile prompt ("ignore your instructions and..."), which must still give a
  valid answer or a plain refusal; the daily limit with `AI_DAILY_LIMIT_PER_PERSON` set to 1 for the test; the cost of one answer read in
  the Anthropic console.
- **Local checks until then:** `npm test`, `npm run lint`, `npm run build`. The real adapter is not exercised before the deployment.

## Risks

1. **Quality is partly taste.** The checks make the game readable and playable, not pretty. Judged by eye on a few real prompts with the studio.
2. **Latency.** The first Play after a change takes a few seconds longer; the step shows "Running…" as today.
3. **Cost.** Bounded by the limits and the spend cap; a typical answer is about 3,000 input tokens (instructions, prompt, a 1024-pixel
   picture) and a few hundred output tokens.
4. **A model is retired or its API changes.** One constant and one adapter change; the API shapes are re-read from Anthropic's reference when built.
5. **The first step with two outputs.** The runner change is small and tested, but it touches every run, so the slice 3a runner tests
   must all keep passing unchanged.
6. **The studio's setup before the live check:** an Anthropic account, an API key with a monthly spend limit, and the Vercel variable.

## Repository layout

```
web/src/lib/ai/                 port.ts (the DescribeGame port), anthropic.ts (the real adapter), answer.ts (parse, check, repair),
                                cache.ts and limits.ts (ports, memory fakes, Firestore adapters), service.ts (cache, limits, call)
web/src/lib/graph/              types.ts (the feel wire, outputs map, ExecutorContext.ai), registry.ts (Describe Game, Game Template's
                                feel input), runner.ts (route by output port), palette.ts (guardPalette), starter.ts (the second starter),
                                nodes/describeGame.ts, nodes/gameTemplate.ts (reads a feel)
web/src/lib/canvas/             cardView.ts (the Describe Game result), addMenu.ts, tuning.ts (locked sliders)
web/src/app/graphs/             NewGraphButton.tsx (the second starter), [id]/SettingsPanel.tsx, StepCardView.tsx, icons.tsx,
                                editor.module.css (the feel color in both themes)
web/package.json                adds @anthropic-ai/sdk
docs/superpowers/notes/         slice4-results.md (after the live checks)
```

## Changes to earlier specs

- **Graph engine (3a):** an executor may return `outputs` by port name, and the runner routes by `from.port`; `ExecutorContext` gains `ai`;
  the "no draft `settings` until slice 4" note is resolved by two typed wires (palette, feel) instead of a draft `settings` object.
  Caching, deferred there until the first slow node, is built here for this step only.
- **v1 spec:** Describe Game outputs a palette and a feel (not a draft `settings`), and has the prompt box itself instead of a
  separate Prompt step; the `text` wire type is not added in this slice.
