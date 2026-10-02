# Web Foundation (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in `@punx.ai` person uploads a settings file and its GLBs to a Vercel-hosted app and plays the game in the Unity runner template, with everyone else refused.

**Architecture:** One Next.js app (`web/`) on Vercel. Logic lives in plain TypeScript modules behind small ports (`AuthPort`, `RunRecords`, `FileStore`) so it is tested with in-memory fakes; thin Firebase adapters and thin route files sit on top. The two Unity builds are static files.

**Tech Stack:** Node.js 24 LTS, Next.js 16 (App Router, TypeScript, npm), Vitest, `firebase` (web SDK, email-link sign-in), `firebase-admin` (sessions, Firestore, Cloud Storage).

**Spec:** `docs/superpowers/specs/2026-10-02-web-foundation-design.md` (parent: `2026-10-02-studio-platform-v1-design.md`). Unity-side references for the shared contract: `unity/runner-template/Assets/Runner/Runtime/Settings/SettingsParser.cs`, `.../Sim/Winnability.cs`, `fixtures/settings/`.

## Global Constraints

- Only a verified `@punx.ai` address (exact domain, lower-cased, one `@`) may sign in; the check runs on `POST /api/session` **and** in `requireUser()` on every request. Refusal text: "Only punx.ai email addresses can sign in".
- Session cookie `__Host-session` (the plan first said `session`; the final review asked for the prefix so no other subdomain can set it): Firebase session cookie, 5 days (`Max-Age=432000`), `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`.
- `POST`, `PUT` and `DELETE` routes require an `Origin` header equal to the site's own origin.
- Limits: GLB at most 4 MB (4 * 1024 * 1024 bytes), settings at most 16 KB (16,384 bytes), at most 20 runs per person, pending ones included ("You have 20 runs. Delete one first."), a pending run older than one hour is deleted when its owner next lists or creates runs.
- Run ids: random 128-bit, URL-safe. Storage path `runs/{runId}/{fileName}`; file names come only from validated settings. Firestore collection `runs`. Firestore and Storage rules deny all client access.
- URLs: `/api/runs/{id}/settings.json` (root-relative, same-origin); templates at `/templates/runner-desktop/` and `/templates/runner-mobile/`; the Preview uses mobile when `matchMedia("(pointer: coarse)")` matches.
- Settings validation must agree with the Unity template on every file in `fixtures/settings/` (it may be stricter on wrongly typed fields, never looser). Messages are ported from `SettingsParser.cs` and `Winnability.cs`.
- Secrets only in Vercel environment variables: `FIREBASE_SERVICE_ACCOUNT` (JSON), `FIREBASE_STORAGE_BUCKET`, `ALLOWED_EMAIL_DOMAIN` (`punx.ai`); public: `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN`. `.env*` is git-ignored. Nobody pastes a key into chat.
- Firebase and Storage in `us-east1`. Every page and route calls `requireUser()` itself; no `proxy.ts`.
- Commands run from `web/` unless stated. Tests: `npm test`. Commits: one per task, conventional style.

## Review Focus

1. **Email link opened on another device or browser** (no remembered address): the sign-in page asks for the address instead of failing. Pinned in Task 6 by the `resolveLinkEmail` tests.
2. **Session expired or revoked mid-use:** every API answers 401 `{"error":"Your session has expired. Sign in again."}` and the page sends the person to sign-in. Pinned in Task 8 (a 401 test per route) and checked on the deployment in Task 9, step 7.
3. **One file used for several roles, or an upper-case `.GLB` name:** needed names are de-duplicated, the run becomes ready after one upload, and the content type is still `model/gltf-binary`. Pinned in Tasks 3 and 7.
4. **Parallel uploads and re-uploads:** three simultaneous PUTs end in one `ready` run with all files; a second PUT of a stored name is refused with 409. Pinned in Task 7.
5. **A settings file saved with a UTF-8 byte-order mark** (common from Windows editors): accepted, and stored without the mark so the Unity player can parse it. Pinned in Tasks 3 and 7.

---

### Task 1: Toolchain and app scaffold

**Files:** Create `web/` (generated app), `web/vitest.config.ts`, `web/src/lib/smoke.test.ts`. Modify `web/package.json` (scripts), `.gitignore` if `web/.env*` is not already ignored.

**Interfaces:** Produces: `npm test` (Vitest, Node environment, `@` alias to `src`), `npm run build`, `npm run lint`.

- [ ] **Step 1 (you): allow installing Node.js 24 LTS.** Run `node -v` first; if it is missing or below 20.9, ask the person before installing, then install Node 24 LTS (`winget install OpenJS.NodeJS.LTS`, or the nodejs.org installer). Open a new shell and check `node -v` and `npm -v`.
- [ ] **Step 2: Scaffold.** From the repo root run `npx create-next-app@latest web` choosing: TypeScript, ESLint, App Router, `src/` directory, no Tailwind, no React Compiler, import alias `@/*`, npm. Check `npx create-next-app@latest --help` if a flag is unclear. Confirm `web/.gitignore` ignores `.env*`, `.next`, `node_modules`, `.vercel`, and that no `web/.git` folder was created.
- [ ] **Step 3: Add Vitest** (`npm i -D vitest`), a `test` script (`vitest run`), and `vitest.config.ts` with `environment: "node"` and `resolve.alias` `@` -> `src`. Write `src/lib/smoke.test.ts` asserting `1 + 1 === 2` through an `@/`-aliased import of a one-line `src/lib/smoke.ts`.
- [ ] **Step 4: Verify.** `npm test` -> 1 passed. `npm run build` -> exits 0. `npm run lint` -> exits 0. Delete the smoke files.
- [ ] **Step 5: Commit** `chore: scaffold the Next.js app and test runner`.

---

### Task 2: Spike: the Unity builds on Vercel

**Files:** Create `tools/publish-template.ps1`, `web/public/templates/runner-desktop/**`, `web/public/templates/runner-mobile/**` (copied builds), `web/public/spike/frame.html`, `web/public/spike/runs/test/{settings.json,hero.glb,obstacle.glb,coin.glb}`. Modify `web/next.config.ts`.

**Interfaces:** Produces: `tools/publish-template.ps1 -Target desktop|mobile|both` (copies `Builds/runner-<t>` to `web/public/templates/runner-<t>`, excluding `runs/`, replacing the old copy); `next.config.ts` `headers()` rules for `*.unityweb`. This task answers Risk 1 of the spec.

- [ ] **Step 1: Write `tools/publish-template.ps1`** in the style of `tools/serve.ps1` (param block, fails with a clear message if `Builds/runner-<t>/index.html` is missing). Run it for both targets (the final slice 1 builds are in `Builds/`). Check: `web/public/templates/runner-desktop/Build/` holds four files, no `runs` folder, total under 8 MB per target.
- [ ] **Step 2: Add header rules** in `next.config.ts` for three source patterns under `/templates/`: `*.wasm.unityweb` (`Content-Type: application/wasm`), `*.framework.js.unityweb` (`application/javascript`), `*.data.unityweb` (`application/octet-stream`), each with `Content-Encoding: br`. Match `tools/serve.ps1`, which already does this locally. Use path-to-regexp syntax, e.g. `/templates/:dir/Build/:file(.*\\.wasm\\.unityweb)`.
- [ ] **Step 3: Spike files.** Copy the three sample GLBs and `settings.json` from `unity/runner-template/Assets/StreamingAssets/sample/` into `web/public/spike/runs/test/`. `frame.html` is a page whose body is one full-window `<iframe src="/templates/runner-desktop/index.html?settings=/spike/runs/test/settings.json">`.
- [ ] **Step 4 (you): create the Vercel project** from the GitHub repo `PUNX-PH/punx-gsp-2026`, root directory `web`. Vercel protects preview deployments by default, so set the project's **Production Branch** to `slice-2-web-foundation` for now (Settings, Git) and check the plan terms (Hobby is personal and non-commercial). Ask the person before pushing the branch (nothing is pushed without their say-so), then push it. Record the production URL as `<site>` in the ledger (it is not secret).
- [ ] **Step 5: Verify on the deployment.** (a) `curl -sI <site>/templates/runner-desktop/Build/runner-desktop.wasm.unityweb` shows `content-encoding: br` and `content-type: application/wasm`; likewise for `.data.unityweb` and `.framework.js.unityweb`. (b) Open `<site>/spike/frame.html` in the built-in browser: the runner appears in the iframe within 15 s, with no console errors. (c) Open `<site>/templates/runner-mobile/index.html?settings=/spike/runs/test/settings.json` the same way. Expected: all three pass. **If (a) fails**, note it in the ledger and check whether the player still loads through its decompression fallback; record the load time and decide with the person whether that is acceptable before going on.
- [ ] **Step 6: Commit** `feat: publish the Unity templates and serve them with Brotli headers`.

---

### Task 3: Settings validator

**Files:** Create `web/src/lib/settings.ts`. Test: `web/src/lib/settings.test.ts`.

**Interfaces:** Produces:
`interface GameSettings { schemaVersion: number; template: string; palette: string[]; roles: { hero: string; obstacle: string; collectible: string }; tuning: { speed: number; jumpHeight: number; obstacleSpacing: number } }`;
`type SettingsResult = { ok: true; settings: GameSettings; text: string } | { ok: false; error: string }`;
`validateSettings(text: string): SettingsResult` (a leading U+FEFF is removed; `text` in the result is the input without it);
`rolesNeeded(s: GameSettings): string[]` (unique file names, in the order hero, obstacle, collectible).

- [ ] **Step 1: Write the failing tests.** (a) One test reads every `fixtures/settings/*.json` (path `../fixtures/settings` from `web/`); a table maps each `invalid-*` file to the substring its error must contain: malformed-json `not valid JSON`, schema-version-2 `schemaVersion`, unknown-template `template`, palette-four-colors and palette-bad-hex `palette`, roles-missing `roles`, role-path-parent, role-path-subfolder and role-not-glb `roles.hero`, speed-0 and speed-21 `speed`, jump-height-1 and unwinnable-jump `jumpHeight`, spacing-3 and unwinnable-spacing `obstacleSpacing`. Every `valid*` file must be accepted. A fixture with no table entry fails the test ("add it to the table"). (b) `""`, `"   "` and an HTML error page are rejected with `not valid JSON`. (c) Winnability by value, for `(speed, jumpHeight, spacing)`: `(1,1.5,4)`, `(1,5,40)`, `(2,2.2,12)`, `(3,2.2,12)` fail on `jumpHeight`; `(20,1.5,4)`, `(20,1.5,6)`, `(20,5,4)` fail on `obstacleSpacing`; `(6,2.2,12)` passes; the `(3,2.2,12)` error contains `at least 3.1` and `(3,3.1,12)` passes; the `(20,5,4)` error contains `at least 27.1` and `(20,5,27.1)` passes. (d) `"﻿" + valid.json` is accepted and the result's `text` does not start with U+FEFF. (e) `"speed": "fast"` is rejected with `speed`. (f) `rolesNeeded` on one file for all three roles returns one name; on `hero.glb, hero.glb, coin.glb` returns `["hero.glb","coin.glb"]`; `Hero.GLB` passes validation.
- [ ] **Step 2: Run and see it fail.** `npm test -- settings` -> FAIL (module missing).
- [ ] **Step 3: Implement `settings.ts`.** Port `SettingsParser.Validate` and `Winnability.Check` with the same order of checks, ranges (`speed` 1 to 20, `jumpHeight` 1.5 to 5, `obstacleSpacing` 4 to 40), role-name pattern `^[A-Za-z0-9_-]+\.[Gg][Ll][Bb]$`, and message texts; number formatting in messages matches C#'s `0.##` (so `200`, `2.2`, `4.8`). Size limit (16 KB) is the caller's job.
- [ ] **Step 4: Verify.** `npm test -- settings` -> all pass.
- [ ] **Step 5: Commit** `feat: settings validator that agrees with the Unity template`.

---

### Task 4: GLB checker

**Files:** Create `web/src/lib/glb.ts`, `web/src/lib/testing/glb.ts` (test helper). Test: `web/src/lib/glb.test.ts`.

**Interfaces:** Produces: `checkGlb(name: string, bytes: Uint8Array): { ok: true } | { ok: false; error: string }`; test helper `makeGlb(json: unknown | string, options?: { magic?: string; version?: number; declaredLength?: number; bin?: Uint8Array; firstChunkType?: number }): Uint8Array`.

- [ ] **Step 1: Write the failing tests.** Accepted: the real sample `unity/runner-template/Assets/StreamingAssets/sample/hero.glb`; a `makeGlb({asset:{version:"2.0"}})`; the same with a BIN chunk. Rejected with these message tails (each prefixed `"<name>: "`): empty and 11 bytes, wrong magic `glTF`: `not a GLB file (wrong header)`; version 1: `wrong GLB version (need 2)`; declared length not equal to size: `file length does not match its header`; first chunk not `JSON`, or JSON that does not parse: `damaged (the JSON part is missing or not valid)`; `asset.version` `"1.0"`: `not glTF 2`; `buffers:[{uri:"x.bin"}]` and `images:[{uri:"a.png"}]` and a `data:` uri: `refers to files outside itself`.
- [ ] **Step 2: Run and see it fail.** `npm test -- glb` -> FAIL.
- [ ] **Step 3: Implement `checkGlb`** over a `DataView`: 12-byte header (magic, version, length), first chunk header (length, type `0x4E4F534A`), decode and parse the JSON chunk with `TextDecoder`, then check `asset.version` starts with `2` and no `buffers[].uri` / `images[].uri`. Never throws on any input.
- [ ] **Step 4: Verify.** `npm test -- glb` -> all pass.
- [ ] **Step 5: Commit** `feat: GLB checker`.

---

### Task 5: Request guards

**Files:** Create `web/src/lib/access.ts`, `web/src/lib/body.ts`. Test: `web/src/lib/access.test.ts`, `web/src/lib/body.test.ts`.

**Interfaces:** Produces: `isAllowedEmail(email: string | null | undefined, domain: string): boolean`; `sameOrigin(req: Request): boolean` (the `Origin` header equals `new URL(req.url).origin`; a missing header is false); `class TooLargeError extends Error`; `readBodyCapped(req: Request, maxBytes: number): Promise<Uint8Array>`.

- [ ] **Step 1: Write the failing tests.** `isAllowedEmail(_, "punx.ai")`: true for `a@punx.ai` and `A@PUNX.AI`; false for `x@punx.ai.evil.com`, `x@notpunx.ai`, `x@sub.punx.ai`, `x@punx.ai ` (trailing space), `a@b@punx.ai`, `punx.ai`, `@punx.ai`, `""`, `null`, `undefined`. `sameOrigin`: true for equal origins; false for a missing header, `null`, a different host, a different scheme. `readBodyCapped`: a body under the cap returns the bytes; a `Content-Length` over the cap throws `TooLargeError` without reading the stream; a stream with no `Content-Length` that exceeds the cap throws `TooLargeError`; an empty body returns zero bytes.
- [ ] **Step 2: Run and see it fail.** `npm test -- access body` -> FAIL.
- [ ] **Step 3: Implement.** `readBodyCapped` reads `req.body` chunk by chunk, counting bytes, and stops at the first chunk that passes the cap.
- [ ] **Step 4: Verify.** `npm test -- access body` -> all pass.
- [ ] **Step 5: Commit** `feat: email, origin and body-size guards`.

---

### Task 6: Sign-in and session

**Files:** Create `web/src/lib/auth/ports.ts`, `web/src/lib/auth/session.ts`, `web/src/lib/auth/firebaseAdmin.ts`, `web/src/lib/auth/memory.ts` (fake), `web/src/app/api/session/route.ts`, `web/src/lib/firebaseClient.ts`, `web/src/lib/signInState.ts`, `web/src/app/sign-in/page.tsx`, a minimal signed-in home `web/src/app/page.tsx` (email, sign-out), `firebase.json`, `firestore.rules`, `storage.rules`, `web/.env.example`. Test: `web/src/lib/auth/session.test.ts`, `web/src/lib/signInState.test.ts`.

**Interfaces:** Consumes: `isAllowedEmail`, `sameOrigin`. Produces:
`interface AuthPort { verifyIdToken(idToken: string): Promise<{ uid: string; email?: string; emailVerified: boolean }>; createSessionCookie(idToken: string, maxAgeMs: number): Promise<string>; verifySessionCookie(cookie: string): Promise<{ uid: string; email?: string; emailVerified: boolean }> /* checks revocation, throws if invalid */; revokeRefreshTokens(uid: string): Promise<void> }`;
`interface User { uid: string; email: string }`;
`startSession(auth, idToken, domain): Promise<{ ok: true; cookie: string; maxAgeMs: number } | { ok: false; status: 401 | 403; error: string }>`;
`requireUser(auth, cookie: string | undefined, domain): Promise<User | null>`;
`endSession(auth, cookie | undefined): Promise<void>`; `sessionCookieHeader(value: string, maxAgeMs: number): string` and `clearedSessionCookieHeader(): string`;
`getAuthPort(): AuthPort` (the Firebase Admin adapter); `readSessionCookie(req: Request): string | undefined`;
`resolveLinkEmail(stored: string | null, ask: () => string | null): string | null`.

- [ ] **Step 1 (you): Firebase project.** Create a Firebase project; create Firestore (production mode) and the default Storage bucket in `us-east1`; upgrade to the Blaze plan and set a low budget alert (Cloud Storage requires it; the free allowance still applies); enable Email/Password with **Email link** sign-in; add `localhost` and the Vercel production domain `<site>` to Authentication, Settings, Authorized domains. Create a service-account key. In Vercel set `FIREBASE_SERVICE_ACCOUNT` (the key's JSON), `FIREBASE_STORAGE_BUCKET`, `ALLOWED_EMAIL_DOMAIN=punx.ai`, and the `NEXT_PUBLIC_FIREBASE_*` web config plus `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=punx.ai`; put the same in `web/.env.local` for local runs. Never paste keys into chat.
- [ ] **Step 2: Write the failing tests** with an in-memory `AuthPort` fake (`memory.ts`). `startSession`: a verified `a@punx.ai` token succeeds with `maxAgeMs` 432,000,000 and returns the fake's cookie; unverified email, `x@punx.ai.evil.com` and `x@notpunx.ai` give 403 `Only punx.ai email addresses can sign in` and create no cookie; `verifyIdToken` throwing, and `createSessionCookie` throwing (sign-in not recent), give 401 `Sign in again.`. `requireUser`: `undefined` cookie, an invalid or revoked cookie, and a valid cookie whose address no longer passes the domain test all return `null`; a valid one returns `{uid, email}`. `endSession` revokes the user's tokens and is quiet on a bad cookie. `sessionCookieHeader` contains `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=432000`. `resolveLinkEmail`: a stored address is returned without asking; with none stored it asks and returns the answer; a cancelled prompt (`null`) or blank answer returns `null`.
- [ ] **Step 3: Run and see them fail.** `npm test -- session signInState` -> FAIL.
- [ ] **Step 4: Implement** `session.ts`, `signInState.ts` and the fake. `firebaseAdmin.ts` initialises `firebase-admin` once from `FIREBASE_SERVICE_ACCOUNT` and implements `AuthPort` with `verifyIdToken`, `createSessionCookie`, `verifySessionCookie(cookie, true)` and `revokeRefreshTokens`. `api/session/route.ts`: `POST` (JSON `{idToken}`, `sameOrigin` required, sets the cookie, returns 204) and `DELETE` (clears it); the Firebase-bound parts are checked in step 6.
- [ ] **Step 5: Implement the pages.** `sign-in/page.tsx` (client): if `isSignInWithEmailLink(auth, location.href)`, get the address with `resolveLinkEmail(localStorage.getItem("signInEmail"), () => window.prompt("Confirm your email address"))`, `signInWithEmailLink`, post the ID token to `/api/session`, go to `/`; otherwise a form that refuses an address failing `isAllowedEmail(email, NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN)` and calls `sendSignInLinkToEmail` with `url: location.origin + "/sign-in"`, `handleCodeInApp: true`, remembering the address in `localStorage`. `page.tsx` (server): `requireUser`, redirect to `/sign-in` if `null`, else show the address and a sign-out button. Deny-all `firestore.rules` and `storage.rules`.
- [ ] **Step 6: Verify.** `npm test` -> all pass; `npm run build` -> exits 0. **(you)** deploy the branch, open `<site>`: it redirects to `/sign-in`; a non-punx.ai address is refused on the page; your punx.ai address receives a link, and after clicking it you land on `/` showing your address; sign-out returns to sign-in. Deploy the rules: `npx firebase-tools login` then `npx firebase-tools deploy --only firestore:rules,storage --project <project-id>` (or paste both files into the console).
- [ ] **Step 7: Commit** `feat: punx.ai-only email-link sign-in with server sessions`.

---

### Task 7: Run service

**Files:** Create `web/src/lib/runs/types.ts`, `web/src/lib/runs/service.ts`, `web/src/lib/runs/memory.ts` (fakes), `web/src/lib/runs/firebase.ts` (adapters). Test: `web/src/lib/runs/service.test.ts`.

**Interfaces:** Consumes: `validateSettings`, `rolesNeeded`, `checkGlb`, `makeGlb` (Task 4 test helper, for the GLB bytes in these tests), `User`. Produces:
`interface Run { id: string; ownerUid: string; ownerEmail: string; status: "pending" | "ready"; createdAt: number; needed: string[]; files: Record<string, { size: number; sha256: string }> }`;
`interface RunRecords { create(run: Run): Promise<void>; get(id: string): Promise<Run | null>; listByOwner(uid: string): Promise<Run[]>; recordFile(id: string, name: string, meta: { size: number; sha256: string }): Promise<Run> /* atomic: adds the file, sets status "ready" when every needed name is present, returns the run */; delete(id: string): Promise<void> }`;
`interface FileStore { put(runId: string, name: string, bytes: Uint8Array, contentType: string): Promise<void>; get(runId: string, name: string): Promise<Uint8Array | null>; deleteRun(runId: string): Promise<void> }`;
`class RunError extends Error { constructor(readonly status: 400 | 404 | 409, message: string) }`;
`makeRunService(deps: { records: RunRecords; files: FileStore; now: () => number; newId: () => string }): RunService` with
`createRun(user, settingsText): Promise<{ id: string; needed: string[] }>`, `putFile(user, id, name, bytes): Promise<Run>`, `readFile(user, id, name): Promise<{ bytes: Uint8Array; contentType: string }>`, `listRuns(user): Promise<Run[]>`, `deleteRun(user, id): Promise<void>`.

- [ ] **Step 1: Write the failing tests** against the in-memory fakes. `createRun`: invalid settings throw `RunError(400, <the validator's message>)`; the stored `settings.json` equals the validated text with any BOM removed; `needed` is de-duplicated; the 21st run (pending counted) throws `RunError(409, "You have 20 runs. Delete one first.")`; with a fake clock, a pending run older than 1 hour is deleted (record and files) by the next `listRuns` and `createRun`, a younger one is kept. `putFile`: a name not in `needed` (including `settings.json`) gives 400; a bad GLB gives 400 with `checkGlb`'s message; a second PUT of a stored name gives 409 `hero.glb was already uploaded`; another owner's run gives 404; three `Promise.all` PUTs end with status `ready`, four stored files and `needed` order preserved; one file used for all three roles is `ready` after one PUT; each stored file's `sha256` equals the known SHA-256 of its bytes. `readFile`: the owner gets bytes with `application/json` for `settings.json` and `model/gltf-binary` for `hero.glb` and `Hero.GLB`; another owner, a missing run and a name not in `files` all throw the same `RunError(404, "Not found")`. `deleteRun` removes record and files, and is 404 for another owner. `listRuns` returns only the caller's runs.
- [ ] **Step 2: Run and see it fail.** `npm test -- service` -> FAIL.
- [ ] **Step 3: Implement `service.ts`** (SHA-256 with `crypto.subtle`, hex; ids from `newId`, default 16 random bytes as base64url; content type from the lower-cased extension). Implement `memory.ts` fakes faithfully (atomic `recordFile`). Implement `firebase.ts`: Firestore `runs` collection with `recordFile` as a transaction that sets `files.<name>` and `status`; Cloud Storage via the Admin SDK at `runs/{runId}/{name}`; `listByOwner` queries on `ownerUid` only and sorts in memory (no composite index).
- [ ] **Step 4: Verify.** `npm test -- service` -> all pass; `npm test` and `npm run build` still pass. The Firebase adapters are exercised in Task 9.
- [ ] **Step 5: Commit** `feat: run service with Firestore and Cloud Storage adapters`.

---

### Task 8: Run API

**Files:** Create `web/src/lib/api/handlers.ts`, `web/src/app/api/runs/route.ts`, `web/src/app/api/runs/[id]/route.ts`, `web/src/app/api/runs/[id]/files/[name]/route.ts`, `web/src/app/api/runs/[id]/[file]/route.ts`. Test: `web/src/lib/api/handlers.test.ts`.

**Interfaces:** Consumes: `AuthPort`, `requireUser`, `readSessionCookie`, `sameOrigin`, `readBodyCapped`, `TooLargeError`, `RunService`, `RunError`. Produces: `makeApi(deps: { auth: AuthPort; runs: RunService; domain: string }): { listRuns(req); createRun(req); deleteRun(req, id); putFile(req, id, name); getFile(req, id, file) }`, each returning a `Response`. The route files are thin wrappers (`params` is a Promise in Next 16) passing real dependencies.

- [ ] **Step 1: Write the failing tests** (fake auth and fake run service, `Request` objects). For each of the five handlers: no cookie gives 401 `{"error":"Your session has expired. Sign in again."}`. For `createRun`, `deleteRun` and `putFile`: a missing or foreign `Origin` gives 403 `{"error":"Request not allowed"}`. `createRun`: body over 16,384 bytes gives 413; a valid body returns 201 `{id, needed}`; a `RunError` maps to its status and message. `putFile`: body over 4 MB gives 413 `{"error":"hero.glb: larger than 4 MB"}`; success returns the run. `getFile`: headers `Content-Type` (from the service), `X-Content-Type-Options: nosniff`, `Cache-Control: private`; a `RunError(404)` gives 404 `{"error":"Not found"}`. A non-`RunError` exception gives 500 `{"error":"Something went wrong on our side"}`, and the logged text contains the run id and none of the file bytes.
- [ ] **Step 2: Run and see it fail.** `npm test -- handlers` -> FAIL.
- [ ] **Step 3: Implement `handlers.ts`** and the four route files. `createRun` reads the raw body with `readBodyCapped(req, 16384)` and decodes it as UTF-8 text.
- [ ] **Step 4: Verify.** `npm test` -> all pass; `npm run build` -> exits 0.
- [ ] **Step 5: Commit** `feat: authenticated run API`.

---

### Task 9: Pages and Preview

**Files:** Create `web/src/lib/preview.ts`, `web/src/app/runs/new/page.tsx`, `web/src/app/runs/[id]/preview/page.tsx`, `web/src/app/runs/[id]/preview/PreviewFrame.tsx`. Modify `web/src/app/page.tsx` (runs list, Delete, New run link), `web/next.config.ts` (security headers). Test: `web/src/lib/preview.test.ts`.

**Interfaces:** Produces: `pickTemplate(coarsePointer: boolean): "runner-mobile" | "runner-desktop"`; `previewUrl(runId: string, template: "runner-mobile" | "runner-desktop"): string` (`/templates/<template>/index.html?settings=/api/runs/<runId>/settings.json`, run id URL-encoded).

- [ ] **Step 1: Write the failing tests.** `pickTemplate(true)` is `runner-mobile`, `pickTemplate(false)` is `runner-desktop`; `previewUrl("abc", "runner-desktop")` equals the exact string above; an id containing `/` or `?` is encoded.
- [ ] **Step 2: Run and see it fail.** `npm test -- preview` -> FAIL.
- [ ] **Step 3: Implement `pickTemplate` and `previewUrl` in `preview.ts`.**
- [ ] **Step 4: Run and see it pass.** `npm test -- preview` -> all pass.
- [ ] **Step 5: Implement the pages.** Home page: lists the caller's runs (status, created time, Preview for `ready`, Delete) and links to `/runs/new`. `/runs/new` (client): one settings-file input and one multi-file `.glb` input; it POSTs the settings text to `/api/runs`, then PUTs each name in `needed` in parallel (the browser adds `Origin`), finding each among the chosen files by exact name and reporting missing ones before any upload ("Choose hero.glb, coin.glb"); it shows each file's result or error text and links to Preview when all succeed; a 401 anywhere redirects to `/sign-in`. Preview page (server): `requireUser` (redirect if `null`); the run must exist, be owned by the caller and be `ready`, else `notFound()`. `PreviewFrame` (client) picks the template with `matchMedia("(pointer: coarse)")` and renders a full-window iframe. In `next.config.ts` add, for all routes, `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy: frame-ancestors 'self'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- [ ] **Step 6: Verify locally.** `npm test` and `npm run build` pass.
- [ ] **Step 7 (you): deployed run.** Ask before pushing, deploy, and while signed in upload `fixtures/settings/valid.json` with the three sample GLBs from `unity/runner-template/Assets/StreamingAssets/sample/`: Preview plays. This is the first use of the Firebase adapters; fix any adapter bug here with a failing test where one can be written. Then sign out in a second tab and press a button (Delete or upload) in the first: it goes to `/sign-in`, not to a blank error.
- [ ] **Step 8: Commit** `feat: runs list, upload and Preview pages`.

---

### Task 10: Acceptance and handover

**Files:** Delete `web/public/spike/`. Create `docs/superpowers/notes/slice2-results.md`. Modify `docs/superpowers/notes/2026-10-02-slice1-handoff.md` and `CLAUDE.md` (status).

- [ ] **Step 1: Remove the spike** (`web/public/spike/`) and redeploy.
- [ ] **Step 2: Run the six done-criteria from the spec on the deployment** and write each result in `slice2-results.md`: (1) signed out, `curl -s -o /dev/null -w "%{http_code}" <site>/api/runs` is 401 and a page request redirects to `/sign-in`; (2) a punx.ai sign-in works (you) and `x@notpunx.ai` is refused on the page; (3) the sample run plays on desktop and, **(you)** on a phone (this also closes slice 1's phone check; note the device, browser and version, and the fps shown by opening the Preview template URL once with `&debug=1` added); (4) one bad file of each kind is refused with its message: settings `fixtures/settings/invalid-unwinnable-jump.json`, a GLB with the wrong header, a GLB over 4 MB, a GLB with an external `uri`; (5) a second punx.ai account (or a signed-out request) cannot read the first run's `/api/runs/<id>/settings.json` (404); (6) `git grep -n -i -E "private_key|BEGIN PRIVATE|service_account" -- . ':!docs'` finds nothing, and `git ls-files web | grep -E "\.env"` lists only `.env.example`.
- [ ] **Step 3: Record limits and risks seen:** Brotli header result from Task 2, sign-in email delivery (spam or not), cold-start time of the first request, and the Blaze cost shown in the Firebase console, and the repository size after committing the two Unity builds (`git count-objects -vH`).
- [ ] **Step 4: Update the handoff and `CLAUDE.md`** to say slice 2 is done (or what is open), and what slice 3 is.
- [ ] **Step 5: Commit** `docs: slice 2 results and handoff`.
