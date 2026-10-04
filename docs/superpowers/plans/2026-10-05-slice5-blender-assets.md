# Slice 5: Blender Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can turn an uploaded GLB, FBX or OBJ into a game-ready GLB (Prepare Model) or make a low-poly shape (Make Shape), both done by Blender in a private Cloud Run container that Play calls inline, with a cache and daily limits.

**Architecture:** Two new steps (`prepare-model`, `make-shape`) call a `BlenderService` on `ExecutorContext.blender` (cache, limits, deadline, then a `BlenderWorker` port). The real worker is an HTTP client for a new `blender-worker/` container (a small Node wrapper that runs one fresh `blender -b` per job with two Python scripts). A job's GLB is stored in the graph's own folder under its SHA-256 and read back through `ctx.readAsset`, so Game Template and Preview barely change. Uploads learn FBX and OBJ; a raw FBX or OBJ cannot reach a game. Play gets a 270 s deadline.

**Tech Stack:** TypeScript, Next.js 16 on Vercel, Firebase Admin (Firestore and Cloud Storage), `google-auth-library` (already installed through `firebase-admin`; declared directly), Vitest; in `blender-worker/`: Node 24 (built-in `node --test`), Blender (LTS) and its Python, Docker or Google Cloud Build, Cloud Run.

**Spec:** `docs/superpowers/specs/2026-10-05-blender-assets-design.md`

## Global Constraints

- Steps: `prepare-model` "Prepare Model" and `make-shape` "Make Shape"; every failure sentence starts with the step's label and a colon, like the other steps.
- Prepare Model settings `{ triangles, color }`: `triangles` a whole number from **100** to **5000** (default **2000**); `color` is `"original"` (default) or a swatch number **1 to 5**. Make Shape settings `{ shape, color }`: `shape` one of `cube, sphere, cone, cylinder, pyramid, coin, ring` (default `cube`); `color` a swatch **1 to 5** (default **4**). Swatches are the wired palette's colors, or `SAMPLE_PALETTE` when none is wired.
- Formats: GLB, **binary** FBX and OBJ; the kind is decided from the file's bytes, never its name or declared type. `.blend` stays refused. Uploads stay at **4 MB**. A raw FBX or OBJ wired into a Game Template role is refused: "Game Template: the hero model is an FBX file. Put a Prepare Model step after it." (hero, obstacle or collectible; FBX or OBJ).
- Time (one place: `lib/graph/playTime.ts`): Play deadline `PLAY_BUDGET_MS = 270_000`; `MIN_START_MS = 10_000`; the worker call timeout is the smaller of `CALL_TIMEOUT_MS = 65_000` and the time left; the worker kills a job at `WORKER_JOB_LIMIT_MS = 60_000`; the Play route's `maxDuration` stays 300. A cache hit never needs time.
- Limits: `BLENDER_DAILY_LIMIT_PER_PERSON` default **60**, `BLENDER_DAILY_LIMIT_TOTAL` default **600**, per UTC day in Firestore collection `blenderUsage`, counted by transaction **before** the call; `0` means nobody; junk falls back to the default. Given back when the worker never answered or the result could not be used; kept when Blender ran and refused the file.
- Cache: Firestore `blenderOutputs/{key}`, key = SHA-256 of `JSON.stringify([JOB_VERSION, kind, graphId, ...])` (`JOB_VERSION = 1`; bump it whenever a Blender script or the worker's output changes). A record whose stored file is gone is a miss.
- Every GLB the worker returns is checked with `checkGlb` before it is kept. Derived files live at `graphs/{graphId}/assets/{sha256}` (the existing `GraphFiles` port), are readable only by SHA-256 that this Play stored or verified, and go with the graph.
- Sentences (after the step label): "Play ran out of time. Press Play again; finished steps are kept, so it carries on." / "You have used today's 60 Blender jobs. Try again tomorrow." (the number is the configured limit) / "Blender is busy today. Try again tomorrow." / "This file has no 3D shape in it." / "This file could not be read as a GLB, FBX or OBJ." / "This file is larger than 32 MB." / "This model took longer than 60 seconds. Try a simpler one." / "This file could not be prepared. Try another one." / "The Blender service did not answer. Try again."
- Worker: input cap **32 MiB** (Cloud Run's HTTP/1 request limit, below the spec's 50 MB: ledger it as a ruling), memory 2 GiB, max instances 2, concurrency 1, private. Blender runs as `blender -b --factory-startup --disable-autoexec -noaudio --python-exit-code 1`, in a throwaway folder, as an unprivileged user, with an environment holding no secrets; it never gets the network on purpose, and its output is never logged or returned. Error codes only: `bad-request` 400, `too-big` 413, `bad-format` 415, `empty` 422, `failed` 500, `timeout` 504.
- Secrets: `BLENDER_WORKER_URL` and `BLENDER_WORKER_KEY` only in Vercel (the key Sensitive), never in git, never logged, never read at import or build time. The build must pass with no `BLENDER_*` variable. Logs carry the step, the outcome, counts and an HTTP status; never a file, a name or Blender's output.
- Test first; mutation-check the limits, the cache key, the deadline arithmetic and the wrapper's timeout (break the rule once, see a test fail, restore it).
- Ask before: installing Blender, `npm install` (Task 9), building or deploying the image, any push. The repo is public and `main` deploys to production: scan what you push for secrets and personal paths. Every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commands run from `web/` (`export PATH="/c/Program Files/nodejs:$PATH"` in Git Bash) unless a task says `blender-worker/`. The web gate is `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, stopping at the first failure. Use the editor tools for files containing backslashes or apostrophes.
- Execution is inline (the user's choice in earlier slices): keep the ledger in `.superpowers/sdd/2026-10-05-slice5-blender-assets/progress.md` (git-ignored), one fresh whole-branch review at the end, one fix pass.

## Review Focus

Failure modes the spec implies that no single task's tests would otherwise pin, most likely first:

1. A "GLB" from the worker that Unity could not use (empty, not a GLB, a `uri`, a missing or negative triangle count): it must become "did not answer" with the count given back, never a stored file (Tasks 4 and 5).
2. A cache record whose file is gone, and a Play with no time left: the first is a miss, the second still answers a hit and refuses a miss before taking a count (Task 4).
3. Lookalike uploads: JSON, CSV or HTML named `.obj`, an ASCII FBX, a NUL byte in an "OBJ", an FBX named `.glb`, a `.blend` (Task 2).
4. A wrapper that trusts its input: bad query values, a body over the cap, bytes that do not match the claimed format, a Blender that hangs, one that writes nothing, and a secret in the wrapper's own environment (Task 12).
5. A palette wire that is missing, so swatches fall back to the sample palette, and a palette change that does not change the picked color: the step must not rerun (Tasks 1 and 6).

## Rulings already made in this plan

Copy these to the ledger as `Ruling:` lines at Setup (the spec is the authority; each is a smaller or safer reading of it):

- The cache key and the derived files are per **graph** (graph id in the key), not per owner: the files live in the graph's folder and go with it. Cost if wrong: the same model in two graphs is prepared twice.
- **Binary FBX only.** Blender's importer reads binary FBX; an ASCII FBX gets a plain refusal at upload (the spec's risk list said both). Cost if wrong: a rare ASCII file must be re-saved.
- **Only Game Template refuses a raw FBX or OBJ** (the spec said Game Template and Preview): Preview only receives GLB sources from Game Template, and the run service re-checks every GLB it stores. Cost if wrong: none.
- Blender's limit counters live in their own collection `blenderUsage` (the spec said their own documents with their own prefix): the same effect, less code. Cost if wrong: none.
- Rigs and animations are dropped silently in v1 (the spec's "note on the card" is removed: the worker does not report it). Cost if wrong: a person wonders where the animation went.

---

### Task 1: Shared vocabulary, the color rule, and Play's clock

**Files:**
- Create: `web/src/lib/blender/types.ts`, `web/src/lib/blender/color.ts`, `web/src/lib/graph/playTime.ts`
- Modify: `web/src/lib/graph/types.ts`
- Test: `web/src/lib/blender/color.test.ts`, `web/src/lib/graph/playTime.test.ts`

**Interfaces:**
- Produces in `lib/blender/types.ts`: `SHAPES` (the seven names, in the order above) and `type Shape`; `SHAPE_NAMES: Record<Shape, string>` ("Cube", "Sphere", "Cone", "Cylinder", "Pyramid", "Coin", "Ring"); `type ModelFormat = "glb" | "fbx" | "obj"`; `TRIANGLES = { min: 100, max: 5000, default: 2000 }`; `type Swatch = 1 | 2 | 3 | 4 | 5`; `MAX_WORKER_INPUT_BYTES = 32 * 1024 * 1024`; `interface MadeModel { bytes: Uint8Array; trianglesBefore: number | null; trianglesAfter: number }`; `interface BlenderWorker { prepare(input: { bytes: Uint8Array; format: ModelFormat; triangles: number; color: string | null; timeoutMs: number }): Promise<MadeModel>; shape(input: { shape: Shape; color: string; timeoutMs: number }): Promise<MadeModel> }`; `class BlenderRefusedError(code: "empty" | "bad-format" | "too-big" | "timeout" | "failed")` (Blender ran and said no; carries `code` only); `class BlenderUnavailableError(status?: number)` (as `AiUnavailableError`); `interface BlenderJob { user: User; graphId: string; derived: DerivedFiles; deadline: number }`; `interface MadeResult { sha256: string; size: number; trianglesBefore: number | null; trianglesAfter: number; reused: boolean }`; `interface BlenderService { prepare(job: BlenderJob, input: { sha256: string; bytes: Uint8Array; format: ModelFormat; triangles: number; color: string | null }): Promise<MadeResult>; shape(job: BlenderJob, input: { shape: Shape; color: string }): Promise<MadeResult> }`.
- Produces in `lib/graph/types.ts`: `interface DerivedFiles { put(bytes: Uint8Array): Promise<string>; recall(sha256: string): Promise<boolean> }` (`put` stores a GLB a step made and returns its SHA-256; `recall` makes an earlier stored file readable again, or says it is gone); `ExecutorContext` gains `graphId: string`, `derived: DerivedFiles`, `blender: BlenderService`, `deadline: number` (epoch ms); the `model` `WireValue` gains `format: ModelFormat`; `AssetInfo` gains optional `format?: ModelFormat` (missing means `"glb"`).
- Produces in `lib/blender/color.ts`: `resolveColor(setting: unknown, palette: readonly string[] | null): string | null`: `"original"` gives `null`; a swatch 1 to 5 gives that entry of `palette` (or of `SAMPLE_PALETTE` when `palette` is null or the entry is not `#rrggbb`), lower-cased; anything else throws.
- Produces in `lib/graph/playTime.ts`: `PLAY_BUDGET_MS`, `MIN_START_MS`, `CALL_TIMEOUT_MS`, `WORKER_JOB_LIMIT_MS` (the Global Constraints values), `RAN_OUT_OF_TIME` (the sentence, without a label), `timeLeft(deadline: number, now: number): number` (never below 0).

- [ ] **Step 1: Write the failing tests.** `color.test.ts`: `"original"` gives `null` with or without a palette; swatch 4 with the palette `["#1b1f3b","#ff6f59","#ffd166","#06d6a0","#FFFFFF"]` gives `"#06d6a0"` and swatch 5 gives `"#ffffff"`; no palette gives the sample palette's entry; an entry that is not `#rrggbb` falls back to the sample's; `0`, `6`, `2.5`, `"4"` and `"red"` throw. `playTime.test.ts`: `timeLeft(1000, 400) === 600` and `timeLeft(1000, 2000) === 0`; and the relationships that keep Play inside its limit: `PLAY_BUDGET_MS + 30_000 <= maxDuration * 1000` where `maxDuration` is read from the text of `web/src/app/api/graphs/[id]/play/route.ts` (as `lib/ai/duration.test.ts` does), `CALL_TIMEOUT_MS >= WORKER_JOB_LIMIT_MS + 5_000`, `MIN_START_MS < CALL_TIMEOUT_MS`.
- [ ] **Step 2: Run** `npx vitest run src/lib/blender/color.test.ts src/lib/graph/playTime.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the files above. Then `npx tsc --noEmit`: add `format: "glb"` wherever existing code or tests build a `model` wire value (`nodes/model.ts` reads `info.format ?? "glb"`; the rest are tests).
- [ ] **Step 4: Run** the two test files and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the Blender vocabulary, the color rule and Play's clock`.

### Task 2: FBX and OBJ uploads

**Files:**
- Create: `web/src/lib/modelFiles.ts`
- Modify: `web/src/lib/graph/image.ts` (`FileKind`, `sniffKind`), `web/src/lib/graph/service.ts` (`addAsset`), `web/src/lib/graph/nodes/model.ts`, `web/src/lib/graph/registry.ts` (the 3D Model help line), `web/src/lib/canvas/files.ts`
- Test: `web/src/lib/modelFiles.test.ts`, `web/src/lib/graph/image.test.ts`, `web/src/lib/graph/service.test.ts`, `web/src/lib/graph/nodes/nodes.test.ts`, `web/src/lib/canvas/files.test.ts`

**Interfaces:**
- Produces in `modelFiles.ts` (like `checkGlb`, never throws): `checkFbx(name: string, bytes: Uint8Array): GlbResult` and `checkObj(name: string, bytes: Uint8Array): GlbResult` (reuse the `{ ok: true } | { ok: false; error }` shape, errors prefixed `${name}: `). FBX: the 20-byte header `Kaydara FBX Binary  ` then a NUL, `0x1A`, `0x00`, then a little-endian version number of at least 6100; an ASCII FBX (starts `; FBX `) fails with "an ASCII FBX file; save it as a binary FBX, or as a GLB". OBJ: no NUL byte, the first 64 KB decoded leniently as UTF-8 has at most 1% replacement characters (a stray Latin-1 byte in a comment is fine, a binary blob is not), and at least one line starting `v ` and one starting `f ` in the whole file; otherwise "not an OBJ file (it needs vertices and faces)".
- Produces: `FileKind` gains `"fbx" | "obj"`; `sniffKind` returns `"fbx"` for the binary header or `; FBX `, and `"obj"` only when the text passes the OBJ test (checked last); a stored FBX has `{ kind: "model", contentType: "application/octet-stream", format: "fbx" }`, an OBJ `{ kind: "model", contentType: "text/plain", format: "obj" }`, a GLB gets `format: "glb"`; the refusal sentence is "not a PNG, JPEG, GLB, FBX or OBJ file"; the 3D Model help is "A model of your own, as a GLB, FBX or OBJ file."; `fileProblem` says "a 3D model (a GLB, FBX or OBJ file)"; the model executor's wire value and result carry `format` (`info.format ?? "glb"`).

- [ ] **Step 1: Write the failing tests.** `modelFiles.test.ts`: a binary FBX header with version 7400 passes; the same with version 100 fails as damaged; an ASCII FBX gets the ASCII sentence; a small cube OBJ passes; JSON, CSV, HTML, a Markdown file, an OBJ with vertices and no faces, an OBJ with a NUL byte and a random binary blob each fail, while an OBJ with a Latin-1 byte in a comment and one with a byte order mark pass; the file name is in every sentence. `image.test.ts`: `sniffKind` says `fbx` for both FBX headers, `obj` for the cube, `null` for the lookalikes, and `glb` or `png` still win for their own bytes. `service.test.ts` (`addAsset`): an FBX named `model.glb` is stored as `fbx`; OBJ bytes named `thing.png` as `obj`; each stores `kind: "model"` with the right `format` and `contentType`; the lookalikes and a `.blend` (`BLENDER` header) are refused with the new sentence and the file's name; a 4 MB limit message is unchanged. `nodes.test.ts`: the model executor's output wire has `format` (`"glb"` for an asset recorded without one, `"fbx"` for one recorded with it). `files.test.ts`: the wrong-kind sentence names GLB, FBX or OBJ.
- [ ] **Step 2: Run** the five files. Expected: FAIL.
- [ ] **Step 3: Implement** as above; update the existing tests that expect the old refusal sentence.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: FBX and OBJ uploads, decided from their bytes`.

### Task 3: The cache key, the job cache port, and one limit parser

**Files:**
- Create: `web/src/lib/blender/key.ts`, `web/src/lib/blender/ports.ts`, `web/src/lib/blender/memory.ts`, `web/src/lib/dailyLimit.ts`
- Modify: `web/src/lib/ai/server.ts` (use `dailyLimit`)
- Test: `web/src/lib/blender/key.test.ts`, `web/src/lib/blender/memory.test.ts`, `web/src/lib/dailyLimit.test.ts`

**Interfaces:**
- Produces: `JOB_VERSION = 1`; `prepareKey(input: { graphId: string; inputSha: string; triangles: number; color: string | null }): Promise<string>` and `shapeKey(input: { graphId: string; shape: Shape; color: string }): Promise<string>`, each the SHA-256 (`sha256Hex` from `lib/runs/service`) of `JSON.stringify([JOB_VERSION, "prepare", graphId, inputSha, triangles, color])` or `JSON.stringify([JOB_VERSION, "shape", graphId, shape, color])`; `interface CachedJob { sha256: string; size: number; trianglesBefore: number | null; trianglesAfter: number; createdAt: number }`; `interface JobCache { get(key: string): Promise<CachedJob | null>; put(key: string, value: CachedJob): Promise<void> }`; `MemoryJobCache` (copies on put and get, yields to other callers like `MemoryAnswerCache`; exposes `jobs: Map`); `dailyLimit(value: string | undefined, fallback: number): number` (a whole number of 0 or more and nothing else, otherwise the fallback). The per-person and per-site counters reuse `UsageLimits`, `MemoryUsageLimits`, `dayOf`, `personDocId` and `siteDocId` from `lib/ai`.

- [ ] **Step 1: Write the failing tests.** `key.test.ts`: the key for one fixed input equals the SHA-256 of that exact JSON text (pins the format); changing any one field (graph, input sha, triangles, color null vs `"#aaaaaa"`, shape) changes the key; a prepare key never equals a shape key even for look-alike values; the same input twice gives the same key. `memory.test.ts`: a stored job comes back equal but is a copy (changing it does not change the stored one); a missing key gives `null`. `dailyLimit.test.ts`: the table from `aiConfigFromEnv`'s tests (empty, text, negative, fractional, spaces, `1e3`, unset all give the fallback; `"0"` gives 0; `"5"` gives 5).
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** `ai/server.ts` keeps its tests green with `dailyLimit` replacing its private `limit`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the Blender job cache key and port`.

### Task 4: The Blender service

**Files:**
- Create: `web/src/lib/blender/service.ts`
- Test: `web/src/lib/blender/service.test.ts`

**Interfaces:**
- Consumes: Task 1's types, Task 3's key, port and fakes, `UsageLimits`, `dayOf`, `RAN_OUT_OF_TIME`, `timeLeft`, `MIN_START_MS`, `CALL_TIMEOUT_MS`, `NodeError`.
- Produces: `makeBlenderService(deps: { cache: JobCache; limits: UsageLimits; worker: BlenderWorker; perPerson: number; total: number; now: () => number; log?: (info: object) => void }): BlenderService`. Order of work for both kinds: key; cache hit whose file `job.derived.recall(sha)` confirms (answer `reused: true`, nothing counted, no clock check); otherwise less than `MIN_START_MS` left means "Play ran out of time" (nothing taken); take a count; call the worker with `timeoutMs = Math.min(CALL_TIMEOUT_MS, timeLeft(...))`; `job.derived.put(bytes)`; `cache.put` (a failure is logged, never fatal). Log fields only `step` (`"prepare-model"` or `"make-shape"`), `outcome` (`reused`, `made`, `person-limit`, `site-limit`, `refused`, `unavailable`, `unexpected`, `cache-write-failed`, `no-time`), counts and `status`. Giving a count back never throws (a failure there is swallowed).

- [ ] **Step 1: Write the failing tests** with `MemoryJobCache`, `MemoryUsageLimits`, a fake worker that records calls and replies as told, a fake `derived` (`put` stores under `sha256Hex(bytes)`, `recall` reports membership) and a fixed clock. Names and assertions: (1) "makes a prepared model with the worker, stores it, caches it and counts one job" (one worker call; the call carries format, triangles, color; `put` got the worker's bytes; the cache holds the key; `reused: false`; the counter is 1). (2) "answers a repeat from the cache: no worker call, no count, `reused: true`". (3) "a cache record whose file is gone is a miss and is made again". (4) "a cache hit still answers when no time is left". (5) "a miss with less than 10 seconds left says Play ran out of time, calls nothing and takes no count". (6) "the worker gets 65 seconds, or less when the deadline is nearer" (check `timeoutMs` for 200 s and for 20 s left). (7) "the person limit and the site limit each say their sentence and call nothing" (with the configured number in the first). (8) `it.each` over the five refusal codes for Prepare Model: the count stays, the sentence is the table's, and the label prefix is `Prepare Model: `. (9) "the worker not answering (`BlenderUnavailableError` with a status, and a plain `Error`) gives the count back and says it did not answer; the log has the status and no message". (10) "`derived.put` failing gives the count back and says it did not answer". (11) "a failing `cache.put` still returns the model". (12) "a failing `limits.give` does not hide the plain sentence". (13) Make Shape: made, cached by its own key (a different shape or color is a new job), any `BlenderRefusedError` becomes "did not answer" with the count given back, sentences start `Make Shape: `. (14) "nothing logged contains the bytes, a file name or an error message" (JSON of every log call). (15) "ten simultaneous different prepares with a person limit of 3 call the worker exactly three times" (the rest get the limit sentence).
- [ ] **Step 2: Run** `npx vitest run src/lib/blender/service.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the service. The refusal sentences are in the Global Constraints; a Prepare Model refusal keeps the count, a Make Shape one gives it back.
- [ ] **Step 4: Run** the file, then **mutation-check**: take the count after the call instead of before (test 15 must fail); drop the `recall` check (test 3 must fail); skip the clock check on a miss (test 5 must fail). Restore each. Then `npm test`.
- [ ] **Step 5: Commit** `feat: the Blender service`.

### Task 5: The worker client

**Files:**
- Create: `web/src/lib/blender/client.ts`
- Test: `web/src/lib/blender/client.test.ts`

**Interfaces:**
- Produces: `makeBlenderWorker(deps: { baseUrl: string; getIdToken: () => Promise<string>; fetch?: typeof fetch }): BlenderWorker`. Prepare: `POST {base}/prepare?format=..&triangles=..&color=original|%23rrggbb`, `Content-Type: application/octet-stream`, the bytes as the body; shape: `POST {base}/shape`, JSON `{ shape, color }`. Both send `Authorization: Bearer <token>` and `AbortSignal.timeout(timeoutMs)`. A 200 must carry a body that passes `checkGlb` and an `X-Triangles-After` that is a whole number of 1 or more (`X-Triangles-Before` is optional: absent or invalid gives `null`). A JSON `{ "error": code }` with the matching status (413 `too-big`, 415 `bad-format`, 422 `empty`, 504 `timeout`, 500 `failed`) becomes `BlenderRefusedError(code)`; everything else (other statuses, a body that is not that JSON, network errors, aborts, a token failure, a bad GLB or bad counts) becomes `BlenderUnavailableError` (with the status when there was a response). Nothing the response says is kept.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` and `builtinModel("hero")` as the valid GLB: the exact URL (a trailing slash on the base is tolerated), method, headers and body of each call; the success path returns the bytes and counts; each of the five codes with its status gives the matching `BlenderRefusedError`; a 401, 403, 404, 502, 503 and a `bad-request` 400 give `BlenderUnavailableError` with the status; a 500 with a text body gives `BlenderUnavailableError(500)` and the error's message holds nothing of the body; a 200 with an empty body, a non-GLB body, a GLB with a `uri` (`checkGlb` refuses it) and counts `"0"`, `"-3"`, `"abc"` and missing each give `BlenderUnavailableError(200)`; `X-Triangles-Before: "abc"` gives `null`; a fetch that never settles with `timeoutMs: 20` ends in `BlenderUnavailableError` without a status; `getIdToken` rejecting gives `BlenderUnavailableError` and the worker is never called.
- [ ] **Step 2: Run** `npx vitest run src/lib/blender/client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the Blender worker client`.

### Task 6: The two steps, and Game Template refusing raw models

**Files:**
- Create: `web/src/lib/graph/nodes/prepareModel.ts`, `web/src/lib/graph/nodes/makeShape.ts`
- Modify: `web/src/lib/graph/registry.ts`, `web/src/lib/graph/nodes/index.ts`, `web/src/lib/graph/nodes/gameTemplate.ts`
- Test: `web/src/lib/graph/nodes/prepareModel.test.ts`, `web/src/lib/graph/nodes/makeShape.test.ts`, `web/src/lib/graph/nodes/gameTemplate.test.ts`, `web/src/lib/graph/schema.test.ts`, `web/src/lib/graph/checks.test.ts`, `web/src/lib/canvas/addMenu.test.ts`

**Interfaces:**
- Produces in the registry: `prepare-model`: label "Prepare Model", help "Makes a model of yours game-ready: small, in flat colors."; inputs `model` (required, type `model`, label "3D model", missing "Prepare Model needs a model. Connect a 3D Model.") and `palette` (optional, "Colors to paint the model with. Without one, a sample palette is used."); output `model` ("The prepared model."); `defaultParams() => ({ triangles: 2000, color: "original" })`; `shapeProblem` accepts exactly those two keys, "triangles must be a whole number from 100 to 5000." and "color must be \"original\" or a swatch from 1 to 5." otherwise. `make-shape`: label "Make Shape", help "Builds a simple low-poly shape.", input `palette` (optional), output `model` ("The shape."); `defaultParams() => ({ shape: "cube", color: 4 })`; `shapeProblem` accepts exactly those two keys, "shape must be one of cube, sphere, cone, cylinder, pyramid, coin or ring." and "color must be a swatch from 1 to 5." Both: `final: false`, `incompleteProblem: () => null`.
- Produces: `prepareModel` and `makeShape` executors. Prepare Model reads the model's bytes (missing: `NodeError("Prepare Model: the model is missing. Choose it again.")`), resolves the color with `resolveColor(params.color, inputs.palette colors or null)`, calls `ctx.blender.prepare({ user: ctx.user, graphId: ctx.graphId, derived: ctx.derived, deadline: ctx.deadline }, ...)`, and returns `output: { type: "model", sha256, name, size, format: "glb" }` where `name` is the original's name with its extension replaced by `.glb`, and `result: { trianglesBefore, trianglesAfter, size, color, reused }` (`color` the resolved hex or `null`). Make Shape returns the same wire with `name: "<shape>.glb"` and `result: { shape, color, trianglesAfter, size, reused }`.
- Game Template: a role whose wired model has `format !== "glb"` throws `NodeError("Game Template: the <role> model is an FBX file. Put a Prepare Model step after it.")` (`FBX` or `OBJ` in capitals).

- [ ] **Step 1: Write the failing tests.** `schema.test.ts`: the registry's type list now has `make-shape` and `prepare-model` too, both parse with their default settings, and every bad setting above is refused (`triangles` 99, 5001, 2000.5, `"2000"`; `color` `0`, `6`, `"red"`; an extra key; a missing key; `shape` `"torus"`). `checks.test.ts`: a Prepare Model with no model wire stops Play with its `missing` sentence. `addMenu.test.ts`: from a `model` output the menu offers Prepare Model with `wireInto: "model"` (and Game Template, as before); from a `palette` output it offers Prepare Model and Make Shape with `wireInto: "palette"`. `prepareModel.test.ts` and `makeShape.test.ts` with a fake `ctx.blender` that records its inputs: the exact call arguments (format taken from the wire, triangles from the settings, color `null` for `"original"`, the swatch's hex from a wired palette, the sample palette's with none wired), the output wire and the result, a palette whose swatch color is unchanged gives an identical call, a missing file's sentence, and that a `NodeError` from the service passes through unchanged. `gameTemplate.test.ts`: an FBX wired to `hero`, an OBJ to `obstacle` and an FBX to `collectible` are each refused with their role in the sentence; a GLB passes as before.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement**; register both executors in `nodes/index.ts`.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the Prepare Model and Make Shape steps`.

### Task 7: Play gives steps their graph, a derived-files store, the Blender service and a deadline

**Files:**
- Modify: `web/src/lib/graph/service.ts` (`GraphServiceDeps`, `play`)
- Test: `web/src/lib/graph/play.test.ts`, `web/src/lib/graph/service.test.ts`

**Interfaces:**
- Produces: `GraphServiceDeps.blender?: BlenderService` (without one, a private `noBlender` whose calls throw `NodeError("<label>: The Blender service did not answer. Try again.")`, label `Prepare Model` or `Make Shape`); `play` builds the context with `graphId: id`, `deadline: now() + PLAY_BUDGET_MS`, `blender: deps.blender ?? noBlender`, `derived` (`put(bytes)` stores with `files.put(id, sha, bytes, "model/gltf-binary")` under `sha256Hex(bytes)`, adds the sha to a per-Play readable set and returns it; `recall(sha)` is true only when `files.get(id, sha)` finds the file, and then adds it to the set), and `readAsset` reading a sha that is in `record.assets` **or** in the readable set.

- [ ] **Step 1: Write the failing tests** (in-memory fakes, a fake `blender`): the context an executor sees has the graph's id and a deadline exactly `PLAY_BUDGET_MS` after the fake clock; a file `derived.put` stored is readable with `readAsset` in the same Play, is in the files port under the graph's id, and is not in `record.assets`; a sha nobody stored or recalled reads as `null`, even if the same sha exists in another graph's folder; `recall` of a missing file is `false` and of a stored one `true`; deleting the graph removes derived files; with no `blender` dep a Prepare Model fails with the plain sentence while a graph without it plays; end to end with real executors and a fake `blender` that returns the built-in hero GLB: model, Prepare Model, Game Template (hero) and Preview play, and the Preview run's `hero.glb` is the prepared file; the same with Make Shape into the collectible.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Play lends steps a derived-files store and a deadline`.

### Task 8: Describe Game honours Play's deadline

**Files:**
- Modify: `web/src/lib/ai/types.ts` (`DescribeGameService.describe` input gets `deadline?: number`; `DescribeGameModel.ask` request gets `timeoutMs?: number`), `web/src/lib/ai/service.ts`, `web/src/lib/ai/anthropic.ts`, `web/src/lib/graph/nodes/describeGame.ts`
- Test: `web/src/lib/ai/service.test.ts`, `web/src/lib/ai/anthropic.test.ts`, `web/src/lib/graph/nodes/describeGame.test.ts`

**Interfaces:**
- Produces: with a `deadline`, after the cache check and before taking a count, less than `MIN_START_MS` left throws `Describe Game: ` + `RAN_OUT_OF_TIME`; otherwise `model.ask` gets `timeoutMs = Math.min(60_000, Math.floor(timeLeft / (MAX_RETRIES + 1)))` (the SDK retries once, so both attempts fit); `makeClaudeModel` uses a request's `timeoutMs` when given, its default otherwise; the node passes `ctx.deadline`. `service.ts` imports `DEFAULT_TIMEOUT_MS` and `MAX_RETRIES` from `lib/ai/anthropic.ts` (they are exported there; importing that file makes no client and reads no key).

- [ ] **Step 1: Write the failing tests.** service: a hit still answers with no time left; a miss with 5 s left throws the sentence, calls no model and takes no count; the model is asked with `60_000` at 200 s left and `10_000` at 20 s left; with no `deadline` nothing changes (`timeoutMs` undefined). anthropic: the stand-in client sees the request's timeout, and the default without one. node: `ctx.deadline` reaches `ai.describe`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Describe Game stops in time for Play's deadline`.

### Task 9: The Firestore adapter, the real wiring and the environment

**Files:**
- Create: `web/src/lib/blender/firebase.ts`, `web/src/lib/blender/idToken.ts`, `web/src/lib/blender/server.ts`
- Modify: `web/src/lib/ai/firebase.ts` (`FirestoreUsageLimits` takes a collection name, default `aiUsage`), `web/src/lib/graph/firebase.ts` (pass `blender: getBlenderService()`), `web/.env.example`, `web/package.json` (declare `google-auth-library`)
- Test: `web/src/lib/blender/server.test.ts`

**Interfaces:**
- Produces: `FirestoreJobCache implements JobCache` (collection `blenderOutputs`; values through the same JSON round trip as `FirestoreAnswerCache`); `blenderConfigFromEnv(env): { perPerson: number; total: number }` (defaults 60 and 600, via `dailyLimit`); `getBlenderService(stores?: { cache?: JobCache; limits?: UsageLimits }): BlenderService` (built per request; limits `new FirestoreUsageLimits("blenderUsage")`; the worker made lazily on the first call from `BLENDER_WORKER_URL` and `BLENDER_WORKER_KEY`, and missing either throws `BlenderUnavailableError` at that moment; logging through `logOutcome` from `lib/ai/server`); `idToken.ts` exports `makeIdTokenSource(keyJson: string, audience: string): () => Promise<string>` using `google-auth-library` (`GoogleAuth` with the service-account credentials, `getIdTokenClient(audience)`, `idTokenProvider.fetchIdToken(audience)`); an unparseable key throws `BlenderUnavailableError`.
- **Ask the user before `npm install google-auth-library@^11.1.0`** (it is already in `node_modules` through `firebase-admin`; this only declares it in `package.json` and the lock file).

- [ ] **Step 1: Write the failing tests** (`server.test.ts`, as `lib/ai/server.test.ts`): config defaults and the environment's values; junk falls back; making the service with nothing set does not throw; with no URL or key a `prepare` call says "Prepare Model: The Blender service did not answer. Try again." and the count is given back (use fakes for the stores); `idToken.ts` and `firebase.ts` are exercised only on the deployment, as slice 4's adapters were.
- [ ] **Step 2: Run** `npx vitest run src/lib/blender/server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the files; `.env.example` gains `BLENDER_WORKER_URL`, `BLENDER_WORKER_KEY` (one line of JSON, the invoker-only service account's key), `BLENDER_DAILY_LIMIT_PER_PERSON`, `BLENDER_DAILY_LIMIT_TOTAL` with the same style of comments as slice 4's block.
- [ ] **Step 4: Run** the full web gate with `BLENDER_*` unset (`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`). Expected: PASS.
- [ ] **Step 5: Commit** `feat: wire Blender to Firestore and the worker`.

### Task 10: What the editor shows and edits

**Files:**
- Modify: `web/src/lib/canvas/cardView.ts`, `web/src/lib/graph/edits.ts`
- Test: `web/src/lib/canvas/cardView.test.ts`, `web/src/lib/graph/edits.test.ts`

**Interfaces:**
- Produces: `ResultView` gains `{ kind: "made"; line: string; swatch: string | null; reused: boolean }`; `StepData` gains optional `swatches: string[]` (only for the two new step types: the colors of the palette wired into the step when its source has run, otherwise `SAMPLE_PALETTE`); `edits.ts` gains `editSettings(graph: Graph, nodeId: string, patch: Record<string, unknown>): Edit` (merges the patch into the node's settings, `touched: [nodeId]`). The card line for Prepare Model: `"9,400 triangles to 2,000, 41 KB, flat #ff6f59"`, or `"... to 2,000, 41 KB, original colors"` for `color: null`, or `"2,000 triangles, 41 KB, ..."` when `trianglesBefore` is `null` (numbers with `toLocaleString("en-US")`, sizes with `formatSize`); for Make Shape `"Sphere, 80 triangles, 3 KB"` with the shape's `SHAPE_NAMES` name and `swatch` the color.

- [ ] **Step 1: Write the failing tests** for the four line shapes above and `reused: true` from the result; a failed or not-yet-run step gives `none`; `swatches` is the upstream palette node's colors after a run (a Palette from Image result, a Describe Game result's `palette`), the sample palette when nothing is wired or the source has not run; `editSettings` merges (`{ color: 2 }` keeps `triangles`), touches only that step, and leaves the input graph unchanged.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the card view and edits for the Blender steps`.

### Task 11: The panels, the cards and the editor wiring

**Files:**
- Modify: `web/src/app/graphs/[id]/SettingsPanel.tsx`, `StepCardView.tsx`, `icons.tsx`, `editor.module.css`, `Editor.tsx`
- Test: `web/src/app/graphs/[id]/panels.test.tsx`

**Interfaces:**
- Produces: `SettingsPanelProps.onSettings: (nodeId: string, patch: Record<string, unknown>) => void`; the 3D Model picker's `accept` is `.glb,.fbx,.obj` and its note "A GLB, FBX or OBJ file, up to 4 MB. An FBX or OBJ needs a Prepare Model step before the game."; Prepare Model's panel has a labelled number input for the triangle budget (`min` 100, `max` 5000, `step` 100) and a choice "Keep the model's colors" plus five swatches, each a button with `aria-pressed` and an `aria-label` like "Swatch 2, #ff6f59"; Make Shape's panel has seven shape buttons (names from `SHAPE_NAMES`, `aria-pressed` on the current one) and the five swatches; the swatches use `data.swatches`; `StepCardView` renders `made` as the line, a swatch chip when `swatch` is set (hex filtered to `#rrggbb`) and "Reused your earlier result" when `reused`; `icons.tsx` gets an icon for each new type; the `Editor` calls `apply(editSettings(...))` from `onSettings`. Use one template-literal text node per sentence (React SSR splits adjacent text nodes with comments).

- [ ] **Step 1: Write the failing tests** in `panels.test.tsx` with `renderToString`: the 3D Model panel's accept and note; Prepare Model with the defaults shows 2000, "Keep the model's colors" pressed and five swatches with the `data.swatches` colors; with `color: 3` swatch 3 is pressed; Make Shape shows seven buttons with the right one pressed; a Prepare Model card with a `made` result shows the line, the chip and "Reused your earlier result" only when reused; a hostile swatch value (`"red;background:url(x)"`) renders no chip.
- [ ] **Step 2: Run** `npx vitest run "src/app/graphs/[id]/panels.test.tsx"`. Expected: FAIL.
- [ ] **Step 3: Implement**, using the existing classes where they fit; new ones (`.shapeButtons`, `.swatchRow`, `.swatch`) read colors from the theme tokens, and `tokens.test.ts` must stay green.
- [ ] **Step 4: Run** `npm test`, `npm run lint`, `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the Prepare Model and Make Shape panels and cards`.

### Task 12: The worker's HTTP wrapper

**Files:**
- Create: `blender-worker/package.json` (`"type": "module"`, `"scripts": { "test": "node --test" }`, no dependencies), `blender-worker/server.mjs`, `blender-worker/test/fake-blender.mjs`
- Test: `blender-worker/test/server.test.mjs`

**Interfaces:**
- Produces: `createWorker(options: { blenderBin: string; extraArgs?: string[]; scriptsDir: string; workRoot?: string; jobLimitMs?: number; maxInputBytes?: number }): http.Server` (defaults: 60_000 ms, 32 MiB, the OS temp folder) and, when run as the main file, a server on `$PORT` (default 8080) with `blenderBin = $BLENDER_BIN`. Routes: `GET /healthz` 200; `POST /prepare?format=glb|fbx|obj&triangles=100..5000&color=original|#rrggbb` (body: the file); `POST /shape` (JSON `{ shape, color }` with the seven names and `#rrggbb`); other paths 404, other methods 405. Each job: a fresh folder under `workRoot`; Blender spawned as `blenderBin [...extraArgs] -b --factory-startup --disable-autoexec -noaudio --python-exit-code 1 -P <scriptsDir>/prepare.py|shape.py -- --in .. --format .. --out out.glb --stats stats.json --triangles N --color C` (shape: `--shape S --color C --out .. --stats ..`), `stdio: "ignore"`, `cwd` the folder, and an environment of only `HOME`, `TMPDIR`, `LANG=C.UTF-8` and `PATH=/usr/bin:/bin`; killed with SIGKILL at the job limit; the folder removed afterwards whatever happened. The Blender script's exit codes: 0 ok, 3 `empty`, 4 `bad-format`, anything else (and no output file) `failed`. Success: 200, `Content-Type: model/gltf-binary`, `X-Triangles-After` (and `X-Triangles-Before` when the stats file has it). Errors: JSON `{ "error": code }` with the Global Constraints' statuses, and nothing else in the body. The wrapper checks the first bytes match the claimed format (GLB `glTF`, FBX `Kaydara FBX Binary  `, OBJ no NUL byte in the first 64 KB) and answers `bad-format` before starting Blender.

- [ ] **Step 1: Write the failing tests** (`node --test`, `blenderBin: process.execPath`, `extraArgs: [fake-blender.mjs]`; the fake reads the arguments after `--`, writes a tiny valid-looking GLB and a stats file, and obeys markers in its input: `EMPTY` exits 3, `BROKEN` exits 4, `SLEEP` hangs, `NOOUT` exits 0 without output, `CRASH` exits 1; it exits 7 if it sees any environment variable whose name contains `SECRET`): healthz; a happy prepare (200, GLB magic, the two headers); a happy shape; every bad query value (format, triangles 99 and 5001 and `abc`, color `red`) gives 400 `bad-request`; a body over a small `maxInputBytes` gives 413 `too-big` (also by `Content-Length` before reading); format `fbx` with OBJ text gives 415 `bad-format` and Blender is never started; the five marker cases map to 422, 415, 504, 500 and 500; the hung Blender is really gone after the timeout (its pid is not alive; use `jobLimitMs: 300`); with `SECRET_TEST` set in the wrapper's own environment the job still succeeds (the fake would exit 7); the work folder count under `workRoot` is unchanged after every case, including the failures; a bad shape or color is 400; the response bodies of every error are exactly `{"error":"<code>"}`.
- [ ] **Step 2: Run** `node --test` from `blender-worker/`. Expected: FAIL (`server.mjs` missing).
- [ ] **Step 3: Implement** with Node built-ins only.
- [ ] **Step 4: Run** `node --test`, then **mutation-check**: pass the whole `process.env` to Blender (the secret test must fail); skip the kill (the timeout test must fail). Restore each.
- [ ] **Step 5: Commit** `feat: the Blender worker's HTTP wrapper`. Ledger a Ruling for the 32 MiB cap (spec said 50 MB; Cloud Run's HTTP/1 request limit is 32 MiB, verify in the Cloud Run docs and quote the figure).

### Task 13: The container, the smoke script and the notes

**Files:**
- Create: `blender-worker/Dockerfile`, `blender-worker/.dockerignore`, `blender-worker/smoke.mjs`, `blender-worker/README.md`, `blender-worker/fixtures/cube.obj`, `blender-worker/fixtures/empty.obj`

**Interfaces:**
- Produces: an image from `node:24-bookworm-slim` that installs the system libraries headless Blender needs (start with `libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libegl1 libsm6 libxkbcommon0`, add whatever `ldd` on the `blender` binary reports missing), downloads the **current LTS release** of Blender from `download.blender.org` and verifies its published SHA-256 (look up the exact version and checksum when writing this, put both in `ARG`s and say where they came from in a comment), creates an unprivileged user, copies `server.mjs` and `scripts/`, sets `BLENDER_BIN`, and runs `node server.mjs`; `smoke.mjs <baseUrl> [token]` posts `fixtures/cube.obj` to `/prepare` (`format=obj&triangles=2000&color=original`) and `empty.obj` (expects 422) and a shape (`sphere`, `#06d6a0`), asserting 200, the `glTF` magic and the headers; the README has the commands to run the wrapper's tests, build the image (Docker, or `gcloud builds submit` for Cloud Build), run the smoke test (against `http://localhost:8080`, or against Cloud Run with `gcloud auth print-identity-token`), and deploy: `gcloud run deploy blender-worker --source blender-worker --region <the Cloud Storage bucket's region> --no-allow-unauthenticated --max-instances 2 --concurrency 1 --memory 2Gi --cpu 1 --timeout 120`, plus creating the invoker-only service account and key.

- [ ] **Step 1: Write the files.** `cube.obj` is a unit cube (8 `v` lines, 6 quad `f` lines); `empty.obj` has comments only.
- [ ] **Step 2: Check what can be checked here:** `node --check blender-worker/smoke.mjs`; `node blender-worker/smoke.mjs` against a wrapper started in this session with the fake Blender from Task 12 (the smoke script must pass against it).
- [ ] **Step 3: Do not build the image or deploy.** Those are the studio's (Task 17). Write the ledger line `Task 13: image not built (needs Docker or Cloud Build)`.
- [ ] **Step 4: Commit** `feat: the Blender worker's container, smoke test and notes`.

### Task 14: The Blender scripts (needs Blender installed)

**Files:**
- Create: `blender-worker/scripts/prepare.py`, `blender-worker/scripts/shape.py`, `blender-worker/scripts/common.py`, `blender-worker/tests/test_blender.py`

**Interfaces:**
- `common.py`: `parse_args(argv)` (the arguments after `--`), `flatten_materials(objects, color_hex_or_none)`, `export_glb(path)`, `write_stats(path, before, after)`, `triangle_count(objects)`; the exporter call sets `export_format="GLB"`, `export_yup=True`, `export_apply=True`, and turns off cameras, lights, animations, skinning, morph targets, extras, texture coordinates and images (check each option name against the installed Blender: `bpy.ops.export_scene.gltf.get_rna_type().properties.keys()`; an invalid name is an error, so the tests catch it).
- `prepare.py`: exits 0 and writes the GLB and the stats; exit 3 when the scene holds no mesh after import; exit 4 when the importer raises. Steps as in the spec: empty factory scene; import by `--format` (`bpy.ops.import_scene.gltf`, `bpy.ops.import_scene.fbx`, `bpy.ops.wm.obj_import`); keep meshes, join, apply transforms; triangulate; decimate (collapse) to at most `--triangles`, repeating with the ratio scaled by budget/actual up to 8 times; flatten materials (each material to its base color, or one color for `--color #rrggbb`); export. `shape.py`: `cube`, `sphere` (icosphere, 1 subdivision), `cone` (8 vertices), `cylinder` (8), `pyramid` (a 4-vertex cone), `coin` (12-vertex cylinder, diameter 1.0, thickness 0.15, flat faces toward the GLB's +Z), `ring` (torus, 12 by 6 segments, outer diameter 1.0, facing +Z); every shape is one object with one flat material, 1.0 units tall in the GLB's Y except the coin and the ring, whose Y extent is their diameter 1.0.
- **Stop here and ask the user to install Blender** (the current LTS; a portable zip or `winget install BlenderFoundation.Blender`, and say where it landed so the tests can find it). If they decline for now, write the scripts from the spec, ledger `Task 14: scripts written, not run (no Blender)`, and continue; Task 17 runs the tests.

- [ ] **Step 1: Write the failing tests** in `tests/test_blender.py` (Python `unittest`, run as `blender -b --factory-startup --python-exit-code 1 -P blender-worker/tests/test_blender.py`; it builds its inputs with `bpy` into a temp folder and runs the scripts through `subprocess` with `bpy.app.binary_path`; a helper reads a GLB's JSON chunk for accessor min/max, triangle counts and materials): a cube OBJ with budget 2000 keeps 12 triangles, Y extent 1.0, one flat material; a 5,000-triangle icosphere OBJ with budget 200 ends at 200 or fewer and at least 20; a box 1 x 1 x 4 along Z exported to FBX by Blender comes out with a Y extent of 4 (axes fixed); GLB in gives GLB out; `--color #06d6a0` leaves one material whose base color is that color, `original` keeps each material's base color; a textured model leaves no images in the output; an OBJ of comments only exits 3; bytes `Kaydara FBX Binary  ` plus junk exit 4; for each of the seven shapes a valid GLB (re-imports with `bpy`), the expected triangle count (cube 12, pyramid 6 or 8 by construction, the rest whatever the construction gives: assert a range and write the exact count into the test once seen), one material of the given color, and the coin's Y extent 1.0 and Z extent 0.15.
- [ ] **Step 2: Run** the test command above. Expected: FAIL (scripts missing).
- [ ] **Step 3: Implement** the scripts. Fix the tests only if a number the plan guessed was wrong, and ledger it.
- [ ] **Step 4: Run** the test command. Expected: PASS. Run `node --test` in `blender-worker/` too.
- [ ] **Step 5: Commit** `feat: the Blender scripts, tested on fixtures`.

### Task 15: The gate and one fresh whole-branch review

- [ ] **Step 1: The full gate.** From `web/`, with every `BLENDER_*` variable unset: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`; from `blender-worker/`: `node --test`. Stop at the first failure.
- [ ] **Step 2: One fresh whole-branch review** (a reviewer on the most capable model, aimed at `lib/blender/service.ts` and its limit and cache rules, `client.ts`, the `play` context changes, `server.mjs` (input validation, the kill, the environment), the upload sniffing in `modelFiles.ts` and `image.ts`, and the new scripts if they ran). Give it the Review Focus section verbatim and the ledger's `Ruling:` lines. Fix Critical and Important findings test-first in ONE pass; ledger minors as `Final: minor (deferred): ...`. No re-review.
- [ ] **Step 3: Commit** the fixes (`fix: ...`, one commit per finding) and re-run the gate.

### Task 16: The handoff

**Files:**
- Create: `docs/superpowers/notes/slice5-handoff.md`
- Modify: `CLAUDE.md` (Status and Work in progress)

- [ ] **Step 1: Write the handoff** (what is built and where; the rulings; what is unproven until the worker is live: the real Cloud Run call and auth, cold start, Blender memory on real FBX files, the Firestore and Storage adapters, a prepared GLB in Unity's Preview; the studio's setup in order; the live checks; the deferred minors; optional hardening: a locked-down network with no internet egress for the worker). Update `CLAUDE.md`.
- [ ] **Step 2: Commit** `docs: slice 5 handoff`. Ask before pushing.

### Task 17: The studio's setup, and the live acceptance (needs the studio)

- [ ] **Step 1 (the studio, once; ask before each):** install Blender here if Task 14 was deferred, and run its tests; enable Cloud Run, Cloud Build and Artifact Registry in the Google Cloud project; build and deploy the worker (the README's commands, in the same region as the Storage bucket); run `node blender-worker/smoke.mjs <url> <identity token>`; create the invoker-only service account and key; add `BLENDER_WORKER_URL` and `BLENDER_WORKER_KEY` (Sensitive) in Vercel and redeploy; set a budget alert on the project; read Cloud Run's current free-tier figures and write them into the results note.
- [ ] **Step 2: The seven done-criteria on the live site,** in a real browser: (1) signed out, every graph and API call is still refused, and `curl` on the worker's address gives 403; (2) an FBX or OBJ through Prepare Model into the hero, Play, the card's facts, and the game plays with it; (3) a Make Shape sphere into the collectible, Play, plays; (4) Play again unchanged: both cards say "Reused your earlier result" and Cloud Run's request count does not move; (5) the refusals: a raw FBX into Game Template, an OBJ with no faces, a file that is not a model, a 4 MB+ upload, a very heavy model (the 60 s sentence, if one can be found), the daily limit (set `BLENDER_DAILY_LIMIT_PER_PERSON=1` for the test, redeploy, then **restore it**), the worker unreachable (temporarily set a wrong `BLENDER_WORKER_URL`, then restore it); (6) covered by tests; (7) `git grep` for key material finds nothing and the Google Cloud console shows the spend.
- [ ] **Step 3: Write `docs/superpowers/notes/slice5-results.md`** (who checked what, what was not run, the cold-start time and the cost of a job read in the console), update the handoff and `CLAUDE.md`, commit `docs: slice 5 results`, and ask before pushing.
