# Slice 5 handoff: Blender assets, Prepare Model and Make Shape (written 2026-10-05)

**Update 2026-10-05: the worker is deployed and passes its smoke test on Cloud Run** (private, as a no-roles account, in `us-east1`). What is
left of the studio's setup (the invoker key, the Vercel variables, the budget alert) and the exact commands are in
`slice5-setup-progress.md`; "Blocked on the studio" below is partly done.

Read this after `slice4-handoff.md`. It says where slice 5 stands, what only the studio can do, and how to continue. The authorities are
the spec `docs/superpowers/specs/2026-10-05-blender-assets-design.md` and the plan `docs/superpowers/plans/2026-10-05-slice5-blender-assets.md`
(17 tasks, executed inline, as the user chose).

## What this slice is

Two new steps on the canvas, both done by Blender in a private Cloud Run container that Play calls inline:

- **Prepare Model** takes an uploaded GLB, FBX or OBJ and makes it a small GLB: axes fixed (Y up), at most the triangle budget (default 2,000,
  100 to 5,000), flat colors (the model's own, or one of the five palette swatches), nothing else in the file (no textures, rigs, cameras,
  lights or animations). 3D Model now accepts FBX (binary only) and OBJ besides GLB; a raw FBX or OBJ cannot go into a game, Game Template
  says so in plain words.
- **Make Shape** builds a cube, sphere, cone, cylinder, pyramid, coin or ring in a palette swatch's color.

Results are cached per graph by a hash of the inputs; there are daily limits (60 jobs a person, 600 for the studio); and Play now has a
270-second deadline that Blender steps and Describe Game both honour (a step that cannot start in time says "Play ran out of time. Press Play
again; finished steps are kept, so it carries on."). Describe Game choosing shapes from the prompt is a later follow-up.

## Where it stands

- Branch `slice-5-blender-assets`, cut from `main` at `165ec0a` (the spec and plan commits), 17 commits (this note included). **Not pushed, not
  merged.** Ask before any push (the repo is public; pushing `main` starts a production build).
- **Plan tasks 1 to 16 are done** (ledger: `.superpowers/sdd/2026-10-05-slice5-blender-assets/progress.md`, git-ignored). The one whole-branch
  review is done (a fresh Opus 5.5 reviewer; one Critical and three Important findings, all fixed; the minors are below). Task 17, the
  studio's setup and the live checks, is what is left.
- **The gate:** web 1125 tests passing, lint, `tsc` and `npm run build` clean with no `BLENDER_*` variable set; the worker's wrapper 29 tests
  (`npm --prefix blender-worker test`); the Blender scripts 13 tests on Blender 5.2.2 LTS, which is installed on this machine at
  `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.
- **Run for real once:** the wrapper with the real Blender and `smoke.mjs` passed end to end (about 2 to 2.6 s a job on this Windows
  machine), and two real Blender outputs are kept as fixtures that the app's own GLB check and the client accept
  (`web/src/lib/blender/blenderOutput.test.ts`).

## What was built (where to look)

```
blender-worker/        server.mjs (the HTTP wrapper), scripts/{prepare,shape,common}.py, Dockerfile, smoke.mjs, README.md (the API,
                       the tests, the deploy), tests/test_blender.py, server.test.mjs, fixtures/ (fake Blender, cube.obj, empty.obj)
web/src/lib/blender/   types.ts, key.ts, ports.ts, memory.ts, service.ts (the rules), client.ts (the worker call), idToken.ts,
                       firebase.ts, server.ts (wiring), color.ts, fixtures/*.glb
web/src/lib/graph/     nodes/prepareModel.ts, nodes/makeShape.ts, registry.ts (two specs), playTime.ts (the clock), service.ts (Play's
                       context: graphId, derived files, deadline, the Blender service), image.ts + ../modelFiles.ts (FBX and OBJ)
web/src/lib/ai/        the Describe Game service now takes Play's deadline
web/src/app/graphs/[id]/  panels, cards and icons for the two steps; lib/canvas/cardView.ts holds what the cards show
```

## Decisions and rulings worth keeping

- **Cloud Run, inline and cached, no queue.** Jobs are capped at 60 s, so Play waits for them like it waits for Claude. The cache key is the
  SHA-256 of `[JOB_VERSION, kind, graphId, ...]`; **bump `JOB_VERSION` (`web/src/lib/blender/key.ts`) whenever a Blender script or the
  worker's output changes.** A cache record whose file is gone is a miss.
- **Limits are taken before the call** and given back when the worker never answered or its result could not be used; they are kept when
  Blender ran and refused the file (Prepare Model only; a shape has no file to refuse). Counters live in the `blenderUsage` collection.
- **The worker's input cap is 32 MiB** (Cloud Run's documented HTTP/1 request limit), not the v1 spec's 50 MB; uploads stop at **4 MB**
  because of Vercel's request-body limit (larger models need direct-to-storage uploads: a separate feature).
- **Binary FBX only** (Blender's importer does not read ASCII FBX). Blender does not rescale models: the Unity template already fits every
  model to a target height. Rigs and animations are dropped silently.
- **Blender 5.2.2 LTS is pinned in the Dockerfile** (checksum verified), the same release the scripts are tested on. The sphere is an
  icosphere with 2 subdivisions (80 triangles); the ring's tube has six sides.
- **The worker's errors are codes only.** 413, 415, 422, 500 and 504 mean Blender ran and refused the file; **503 `unavailable` means the
  service itself is broken** (the web app never blames the person's file for that, and gives the count back).
- **Cloud Run reserves some paths ending in "z"**, so the health route is `/health`, not `/healthz`.
- Derived files live at `graphs/{id}/assets/{sha256}` through the existing files port, not a `derived/` folder; a step can read one only
  after this Play stored or recalled it.
- Describe Game's model timeout is now the smaller of 60 s and half the time left (the SDK retries once); this changes slice 4's code.

## Unproven until the worker is live

Only the live site can show these: the real Cloud Run call and its auth (the ID token from the invoker key), the container build (the
library list in the Dockerfile, Blender in Cloud Run's sandbox), cold-start time (expected 10 to 20 s), Blender's memory on real FBX files, the
Firestore and Storage adapters, and a prepared GLB actually playing in Unity's Preview (do this one by eye).

## Blocked on the studio (do these once, in order; I ask before each)

1. `blender-worker/README.md` has every command. In your Google Cloud project: enable Cloud Run, Cloud Build and Artifact Registry.
2. **Make the no-roles runtime account and deploy as it** (README steps 1 and 2), in the same region as the Cloud Storage bucket. This is
   the security-critical step: without `--service-account`, Cloud Run runs the worker as the default Compute Engine account, which can hold
   the Editor role.
3. Make the invoker account and its key **outside the repository** (step 3), add `BLENDER_WORKER_URL` and `BLENDER_WORKER_KEY` (Sensitive)
   in Vercel, redeploy, delete the key file. Set a budget alert on the project.
4. Run `node blender-worker/smoke.mjs <url> "$(gcloud auth print-identity-token)"`: all lines must pass, including the "no token is refused".
5. Read Cloud Run's current free-tier and pricing figures (I could not get them from the quotas page) and write them into the results note.
6. Then push the branch with me, wait for the build, and run the live checks below.

## The live checks (plan Task 17)

1. Signed out, every graph and API call is still refused, and `curl` on the worker's address gives 403.
2. Upload an FBX or OBJ to a 3D Model step, wire it through Prepare Model into the hero, Play: the card shows the triangle counts, size and
   color; the game plays with that hero.
3. A Make Shape sphere into the collectible, Play: plays.
4. Play again unchanged: both cards say "Reused your earlier result" and Cloud Run's request count does not move.
5. The refusals: a raw FBX into Game Template; an OBJ with no faces; a file that is not a model; a 4 MB+ upload; a very heavy model (the 60 s
   sentence, if one can be found); the daily limit (`BLENDER_DAILY_LIMIT_PER_PERSON=1` for the test, redeploy, then **restore it**); the worker
   unreachable (a wrong `BLENDER_WORKER_URL` temporarily, then restore it).
6. Covered by tests.
7. A search of the repository for key material finds nothing, and the Google Cloud console shows the spend.

Then write `slice5-results.md` (who checked what, what was not run, cold-start time and the cost of a job), update this note and `CLAUDE.md`,
and ask before pushing.

## Deferred minors from the final review (not fixed; the studio decides)

1. FBX versions 6100 to 7099 are accepted at upload, but Blender 5.2 needs 7100 or newer: such a file uploads, then says it "could not be
   read" and keeps the count (`OLDEST_FBX_VERSION` in `web/src/lib/modelFiles.ts`).
2. A request for the path `//` crashes the wrapper process (an unhandled rejection from `new URL` in the log call); only a caller with the
   invoker identity can send it, and Cloud Run restarts the instance.
3. When the client's call is cut off first (Play's clock is nearer than 65 s) the wrapper keeps Blender running to its 60 s limit and holds
   one of the two instances; kill the child when the response closes. The person is also told "did not answer" where the cause was Play's
   clock, and a cold start counts against the 65 s.
4. `client.ts` does not bound the token fetch by the call's timeout.
5. `derived.recall` downloads the whole file just to check it exists, and Preview then reads it again; `looksLikeObj` needs a space after
   `v` and `f`, so an OBJ that uses tabs is refused.

**Optional hardening:** run Blender under `prlimit --as=...` so a decompression bomb (an FBX with compressed arrays) cannot take the whole
container out of memory; a locked-down network with no internet egress for the worker; workload identity federation instead of a JSON key.

## How to work here

Same as slices 2 to 4. Node in Git Bash needs `export PATH="/c/Program Files/nodejs:$PATH"`; run web commands from `web/` and worker
commands with `npm --prefix blender-worker test`; work test-first; ask before any push, install or deploy. The Blender tests run inside
Blender: `blender -b --factory-startup --python-exit-code 1 -P blender-worker/tests/test_blender.py` (about 2 minutes; pass test names after
`--` to run one). The Bash tool turns backslash escapes into real characters: write files with those using the editor tools.
