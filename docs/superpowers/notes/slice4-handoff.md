# Slice 4 handoff: Describe Game, the AI step (written 2026-10-04)

Read this after `slice3b-results.md`. It says where slice 4 stands, what only the studio can do, and how to continue. The
authorities are the spec `docs/superpowers/specs/2026-10-04-describe-game-design.md` and the plan
`docs/superpowers/plans/2026-10-04-slice4-describe-game.md` (16 tasks, executed inline, as the user chose).

## What this slice is

A person writes a short description of the game (up to 500 characters) and may add a picture. The **Describe Game** step sends
both to Claude Sonnet 5.5 and gets back a palette (five colors) and the three tuning numbers (speed, jump, obstacle spacing),
which flow into the Game Template through two new wires: `palette` (as before) and `feel` (new). It runs inside Play, on the
server. An answer is cached per person (same description, same picture, same model: the card says "Reused your earlier answer"),
and there are daily limits (30 a person, 300 for the whole studio; both are environment settings). In the editor the step has
a prompt box, the picture comes from the Image step wired into it, and the tuning sliders on the Game Template are locked
while a `feel` wire feeds them.

## Where it stands

- Branch `slice-4-describe-game`, cut from `main` at `97bf702`, 19 commits ahead (this note included). **Not pushed, not merged.** Ask before any push
  (the repo is public; pushing `main` starts a production build on Vercel).
- **Plan tasks 1 to 15 are complete** in the ledger (`.superpowers/sdd/2026-10-04-slice4-describe-game/progress.md`,
  git-ignored). The one whole-branch review is done (a fresh reviewer on the most capable model) and its fix pass is committed
  (three Important findings, each fixed test-first; nine deferred minors, below). Task 16 has its gate and review done; the
  studio's setup and the live checks are what is left.
- **The gate on the branch head:** web 873 tests passing (`cd web && npm test`), lint and `npx tsc --noEmit` clean, and
  `npm run build` clean **with `ANTHROPIC_API_KEY` and the other AI variables unset** (the build never needs them).

## What was built (where to look)

```
web/src/lib/ai/        answer.ts (check and repair the model's answer), key.ts (the cache key, the UTC day, the usage document ids),
                       ports.ts + memory.ts + firebase.ts (AnswerCache and UsageLimits: ports, in-memory fakes, Firestore adapters),
                       service.ts (the one place the rules live), prompt.ts (system prompt and answer schema),
                       anthropic.ts (the SDK call), server.ts (wiring from the environment), types.ts
web/src/lib/graph/     nodes/describeGame.ts, registry.ts (the spec), palette.ts (guardPalette), image.ts (pictureForModel),
                       runner.ts (outputs now routed by port name), starter.ts (describedStarterGraph), service.ts, api.ts
web/src/lib/settings.ts  minPlayableSpacing (one rule shared with Unity's check)
web/src/lib/canvas/    cardView.ts, edits.ts (editPrompt)       web/src/app/graphs/[id]/   StepCardView, SettingsPanel, Editor
web/src/app/api/graphs/[id]/play/route.ts   maxDuration 300 (see "Time limit")
```

Rules the service keeps (each has a test): a cache hit costs nothing and uses no count; otherwise the count is taken **before**
the call; a **refusal** and an unusable answer keep the count (the call was made and cost money); a service error or an
unreadable picture **gives it back**; a cache-write failure still returns the answer; nothing the model or the SDK says is
shown to the person (plain sentences prefixed `Describe Game: `) or logged beyond `{ step, outcome, tokens, status }`. The
model's answer is parsed, range-checked, repaired (the obstacle spacing is raised until the game is winnable, with the same
rule Unity uses) and the palette goes through `guardPalette`, so a model-chosen palette is as readable as one taken from pixels.

## Decisions and rulings worth keeping

- **The fix pass (2026-10-04):** (1) the Play route's time limit was 60 s but a model call can take 2 x 60 s (one retry), so the
  step's own timeout never got to fire and the daily count was not given back: `maxDuration` is now 300 and
  `lib/ai/duration.test.ts` holds it above `DEFAULT_TIMEOUT_MS * (MAX_RETRIES + 1) + 30 s`. (2) `guardPalette` drove a light sky
  to black and could not make the panel or ground read on a light sky: it now moves colors apart in the direction that reads
  (this also applies to a palette from pixels; the old tests are unchanged). (3) A float edge in the spacing repair could give a
  value the check then refused: fixed in `settings.ts`.
- **A refusal is retried once on Anthropic's recommended fallback model** (`betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`), which means the call uses the beta messages endpoint. **This is the likeliest thing to need a one-line
  fix at the first live call** (a 400 would show as "The AI service did not answer"; the HTTP status is logged to tell).
- **`max_tokens` 4096 and `maxRetries` 1:** reasoning at low effort counts towards `max_tokens`; one retry keeps the worst case
  at 2 x 60 s.
- **Cache key** = SHA-256 of `[ANSWER_VERSION, model, uid, prompt, pictureSha]`. **Any change to the system prompt or the schema
  needs an `ANSWER_VERSION` bump** or old cached answers keep coming back. Limits are by UTC day (`aiUsage` documents
  `u_{uid}_{yyyymmdd}` and `site_{yyyymmdd}`), counted in transactions.
- **`AI_DAILY_LIMIT_PER_PERSON=0` switches Describe Game off for everyone** (a limit of 0 refuses at once); an unreadable value falls
  back to the default.

## Unproven until the key exists

Only the live site can show these; nothing in the tests touches the real Anthropic API or Firestore:

1. The real Claude call: the request shape (`output_config` with `format: json_schema`, the images block, the beta header), the
   refusal fallback, and that the answer parses.
2. The Firestore adapters (`aiAnswers`, `aiUsage`, the transactions): tested against the in-memory fakes only.
3. That a Play with a model call fits Vercel's limit on the Hobby plan (300 s with Fluid compute; a real call is a few seconds).
4. What one answer costs (read it in the Anthropic console after the first Play).

## Blocked on the studio (do these once, in order)

1. Create an Anthropic account and an **API key with a monthly spend limit** in the console (a small limit is fine: one answer is
   cents or less; the in-app daily limits are a second guard).
2. **Decide whether sending a description and a picture to Anthropic fits the studio's data terms.** The editor says so on the
   step ("Your description and picture are sent to Anthropic's Claude to make this."), but the decision is the studio's.
3. In Vercel, Project Settings, Environment Variables: add `ANTHROPIC_API_KEY` (**Sensitive**, Production). Optional:
   `AI_MODEL`, `AI_DAILY_LIMIT_PER_PERSON`, `AI_DAILY_LIMIT_TOTAL` (see `web/.env.example`). Redeploy.
4. Then, with the user: push the branch, wait for the build, and run the seven done-criteria below.

## The live checks (plan Task 16, Step 5)

1. Signed out, every graph and API call is still refused (`curl`).
2. Make the "Describe a game" graph, type a prompt, pick a picture, Play: swatches, numbers and a summary show, and the game plays.
3. Play again unchanged: the card says "Reused your earlier answer" and the Anthropic console shows no new request.
4. Change the prompt: a new answer.
5. Refusals: an empty prompt; 501 characters (paste); the limit (set `AI_DAILY_LIMIT_PER_PERSON=1` in Vercel for the test, redeploy,
   then **restore it**); a wrong key (temporarily); a prompt Claude declines, if one can be found. Also a very long prompt, a hostile
   one ("ignore your instructions and..."), and no picture.
6. Covered by tests.
7. A search of the repo for the key pattern finds nothing, and the console shows the spend. **Note:** `git grep sk-ant` will hit
   two fixture strings in `web/src/lib/ai/anthropic.test.ts` (`sk-ant-secret`, `sk-ant-test-key`); they are test values, not keys.
   Narrow the pattern (for example `sk-ant-api`) or rename the fixtures first.

Then write `slice4-results.md` (who checked what, what was not run, the cost of one answer), update this note and `CLAUDE.md`, and
ask before pushing.

## Deferred minors from the final review (not fixed; the studio decides)

1. After a refusal fallback, the code reads the first text block of the answer, which could be the declined model's partial text,
   and `usage` may count only the last hop (a cost log only).
2. The prompt box's `maxLength` counts UTF-16 units, the counter and the server count characters: an emoji-heavy prompt can be
   stopped by the box earlier than the limit.
3. `cleanPrompt` deletes tab and carriage return instead of making a space, does not normalise Unicode, and does not strip
   direction or tag characters (from the prompt or the model's summary). The summary is shown as text, never as markup.
4. The model's numbers are not rounded (a card can show 7.123456; a locked slider can sit off its step).
5. The system prompt misdescribes the slots (the accent is unused by Unity; the background color doubles as the HUD text).
   Fixing it changes the prompt: bump `ANSWER_VERSION`.
6. Logs lack the graph id (Vercel's request log has the path), and a missing key is logged the same as a timeout.
7. If giving a count back fails inside the error path, the person sees the generic sentence instead of the plain one.
8. The described starter blocks Play until a picture is chosen, although the step's picture is optional.
9. Test hygiene: `server.test.ts` "does not keep the count" never checks the count; the `sk-ant-*` fixtures (above).
   Also worth doing: pin the SDK's `logLevel` so an `ANTHROPIC_LOG` variable cannot make it log request bodies.

## How to work here

Same as slices 2 to 3b: Node in Git Bash needs `export PATH="/c/Program Files/nodejs:$PATH"`, run web commands from `web/`, work
test-first, ask before any push or install. The Bash tool turns backslash escapes (`\n`, `\u...`) into real characters: write files
with those, or with apostrophes in long text, using the editor tools. The graph and API stay server-side: the Anthropic key is read
only when an answer has to be asked for, never at import or build time.
