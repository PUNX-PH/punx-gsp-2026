# Slice 3a handoff: graph engine (written 2026-10-03)

Read this after `docs/superpowers/notes/slice2-handoff.md` and before `CLAUDE.md`'s other notes. It says where slice 3a
stands, what only the user can do, and how to continue. The authorities are the spec
`docs/superpowers/specs/2026-10-03-graph-engine-design.md` and the plan
`docs/superpowers/plans/2026-10-03-slice3a-graph-engine.md` (14 tasks, executed inline, as the user chose).

## What this slice is

The engine under the node canvas: a saved graph of typed nodes (Reference Image, 3D Model, Palette from Image, Game
Template, Preview), checks that say in plain words what stops it from running, a runner, uploads, and an API. Pressing
Play checks the SAVED graph, runs it, and stores the game as an ordinary slice 2 run, which the existing Preview page
plays. The canvas is slice **3b** (not designed yet; start from `docs/superpowers/notes/slice3-editor-reference.md`).
For now a deliberately plain page at `/graphs` stands in for it.

## Where it stands

- Branch `slice-3a-graph-engine`, cut from `slice-2-web-foundation` at `c2cd993`. **Local only: nothing is pushed**
  (ask before pushing; the repo is public, so scan for secrets and personal paths first).
- **Plan tasks 1 to 13 are complete** in the ledger (`.superpowers/sdd/2026-10-03-slice3a-graph-engine/progress.md`,
  git-ignored). Task 14 (deployed acceptance and wrap-up) has not started and needs the user's setup.
- **The final whole-branch review is done** (a fresh opus reviewer, aimed at the upload, image-decoding and ownership
  code): no Critical findings; two Important and one re-graded finding, **all fixed test-first** (the page lost unsaved
  JSON edits, a skipped node named the wrong failed node, and the failure log lacked the graph id). Eight minors are
  deferred (below). After Task 14 a short second look at anything that changes is enough; do not repeat the review.
- **Tests:** web 432 passing (`cd web && npm test`), lint and `npm run build` clean. The gate is test, lint, build.
  Slice 2's 199 tests are unchanged and still pass (the request guard was extracted from `handlers.ts` without changing
  behavior).
- **Never exercised for real:** the Firebase adapters (`web/src/lib/graph/store/firebase.ts`), `sharp` on Vercel, the
  pages in a browser, and anything involving a signed-in session. All of it is tested against in-memory fakes only.

## What was built (where to look)

```
web/src/lib/graph/
  types.ts registry.ts schema.ts     the vocabulary, the node catalog (plain names, help, ports), the strict parser
  walk.ts checks.ts runner.ts        ordering, "what stops a run", the runner (events through a callback)
  image.ts palette.ts builtin.ts     sharp decoding, palette from pixels, the three built-in GLBs (base64)
  nodes/                             one file per node; index.ts is the EXECUTORS map
  store/ports.ts memory.ts firebase.ts   GraphRecords and GraphFiles ports, fakes, Firestore and Cloud Storage adapters
  service.ts starter.ts api.ts firebase.ts   rules, starter graph, HTTP handlers, wiring
web/src/lib/api/guard.ts             the shared request guard (origin, session, plain failures)
web/src/app/api/graphs/...           the routes;   web/src/app/graphs/...   the plain page
```

## Decisions and rulings worth keeping

- **Run model:** one request runs the whole graph and returns every node's state; the runner emits events through a
  callback so streaming or polling can be added when a slow node (AI, Blender) arrives. **Caching is deferred** to that
  slice (the user's choice).
- **Two layers of checks:** save refuses only malformed graphs (schema, wire types, one wire per input, files that
  exist and are the right kind), so a half-built graph can always be saved; Play (`checkGraph`) reports every problem on
  its node at once (422). A loop cannot be drawn with today's five node types, so that check is a guard for later types.
- **One run per graph:** Preview reads every model first, then deletes the graph's earlier run (ignoring a 404), then
  creates the new run. A failed Play after that point leaves the graph without a run, and the page forgets the link.
- **A connected input whose source failed makes its node skipped**, never defaulted.
- **Palette:** median cut, then slots by lightness for the template (0 background and HUD text, 1 ground, 2 HUD panel,
  4 score text), then a contrast guard (4.5, 3, 1.5). Flat or tiny pictures are filled out with lightness variations.
- **Firestore:** the adapter strips `undefined` (a model asset has no width) with a JSON round trip, because Firestore
  refuses undefined values. `MemoryGraphRecords` rejects ids Firestore rejects (empty, `/`, `.`, `..`, leading `__`),
  so the service's malformed-id check is testable. `sha256Hex` and `randomId` are now exported from `runs/service.ts`.
- `sharp` is a direct dependency (`^0.35.5`). It is in Next's default external packages, so `next.config.ts` is
  unchanged. If the Vercel function cannot load it, the fallback is pure-JavaScript decoders (spec, Risk 1).
- The graph API logs `graphId`, the handler and the failure kind only, never messages or file contents; the run API
  keeps `runId`.

## Blocked on the user

Everything in Task 14 waits for slice 2's deployment (see `slice2-handoff.md`: the Vercel project settings, the Firebase
confirmations, the environment variables, and the password pre-registration decision). Then the user clicks the
emailed sign-in link and runs the phone check.

## Next steps once unblocked, in order

1. Slice 2's own deployed checks first (Task 2 Step 5, Task 6 Step 6, Task 9 Step 7, Task 10 of that plan).
2. Plan Task 14: deploy this branch; on the deployment create the starter graph, upload a picture and press Play (this
   is also the first proof that `sharp` loads on Vercel); then the seven done-criteria in the spec; fix any
   Firebase-adapter bug with a failing contract test first (`store/store.test.ts`).
3. Write `docs/superpowers/notes/slice3a-results.md`, update `CLAUDE.md` and this note, then finish the branches with the
   user per `finishing-a-development-branch` (merge order: slice 1, slice 2, then this).
4. Brainstorm slice 3b (the canvas) with the reference note; the open questions there (how much of the n8n look to
   keep, preview beside the canvas or separate, which nodes are in the starter) are still open.

## How to work here

Same as slice 2 (`slice2-handoff.md`): Node in Git Bash needs `export PATH="/c/Program Files/nodejs:$PATH"`, run web
commands from `web/`, work test-first, mutation-check security rules, ask before any push or install. A long heredoc
containing quotes can break the Git Bash tool; use the editor tools for files with apostrophes or backslashes.

## Known risks and deferred items

- **Deferred minors from the final review** (none blocks anything; the ledger has the file and line):
  1. A file nothing refers to is judged by its upload time, so a picture uploaded long ago is deleted on the save that
     stops using it (choosing it again means uploading it again).
  2. If a file record exists but its bytes do not (a commit whose result was unknown, then the cleanup delete),
     re-uploading the same bytes returns early and never stores them. Fix: one `files.put` on that early return.
  3. The 413 message repeats the raw `?name=`; clean it or leave it out.
  4. Shortening a name with `slice` can cut an emoji in half, which Firestore may refuse; use `Array.from` or
     `toWellFormed()`. Try an emoji file name in Task 14.
  5. Width and height ignore EXIF rotation, so portrait phone photos are reported swapped. Try one in Task 14.
  6. Duplicate React keys in the colour swatches when a palette has duplicate colours (a flat picture).
  7. Plain-page rough edges: Delete has no try/catch, a cleared tuning field becomes 0, old Play results stay after edits.
  8. Parse errors repeat user strings of any length; cap them near 40 characters.

- Unverified until the deployment: `sharp` in a Vercel function, the Firestore and Cloud Storage adapters, the pages.
- Two simultaneous Plays of one graph can leave an extra run behind (it shows in the runs list and can be deleted); a
  graph open in two tabs is last-write-wins. Both are accepted in the spec.
- The Unity player is unchanged; the slice 1 hardening follow-ups remain a gate before any use beyond punx.ai.
