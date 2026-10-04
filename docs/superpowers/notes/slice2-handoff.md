# Slice 2 handoff: web foundation (written 2026-10-02, end of session)

**Update 2026-10-04: slice 2 is deployed and checked** at https://punx-gsp.vercel.app. The Vercel and Firebase setup is done, and the
deployed checks passed except the few listed as not run in `slice2-results.md`, which is the record to read first. The sections
"Blocked on the user" and "Next steps once unblocked" below are history. What is still open: the password pre-registration
decision (Google sign-in was added; see the decisions below), the merge, pull request or keep choice for the branches, and slice 1's
player-hardening gate before any use beyond punx.ai.

Read this first in a new session, then `CLAUDE.md`. It says where slice 2 stands, what only the user can do, and
how to continue. The authorities are the spec `docs/superpowers/specs/2026-10-02-web-foundation-design.md` and the
plan `docs/superpowers/plans/2026-10-02-slice2-web-foundation.md` (10 tasks, executed inline, as the user chose).
Slice 1 (the Unity runner template) is in `docs/superpowers/notes/2026-10-02-slice1-handoff.md` and `slice1-results.md`.

## What this slice is

A Next.js 16 app in `web/` for Vercel. A person with a verified `@punx.ai` address signs in with Firebase email-link
sign-in, gets a server session cookie (`__Host-session`), uploads a `settings.json` plus the GLBs it names, and plays
the game in the Unity WebGL template served as static files. Firestore holds run records, Cloud Storage holds files,
both only through the Firebase Admin SDK (rules deny all client access). The editor canvas (slice 3) and the AI step
(slice 4) come later; the user's reference for the canvas is `docs/superpowers/notes/slice3-editor-reference.md`.

## Where it stands

- Branch `slice-2-web-foundation`, **fully pushed** to `PUNX-PH/punx-gsp-2026` (head `20bc1b9`). Nothing unpushed except
  this note (committed locally; ask before pushing).
- **Tests:** web 199 passing (`cd web && npm test`), Unity EditMode 64 and PlayMode 4 (`tools/run-tests.ps1`). Lint and
  `npm run build` are clean. Run the gate as test, lint, build and stop on the first failure.
- **Plan tasks:** 1, 3, 4, 5, 7, 8 are complete in the ledger. The code for 2 (Unity builds and Brotli headers), 6
  (sign-in and sessions) and 9 (pages and Preview) is written and committed, but their **deployed** steps are open (2:
  Step 5, 6: Step 6, 9: Step 7), and **Task 10** (acceptance on the deployment, remove `web/public/spike/`, results note)
  has not started.
- **The final whole-branch review is done** (a fresh opus reviewer, aimed at the auth and upload code): no Critical
  issues, three Important and several Minor findings, **all fixed** except two deferred (below). After Task 10 a short
  second look at anything that changes is enough; do not repeat the whole review.
- The ledger is `.superpowers/sdd/2026-10-02-slice2-web-foundation/progress.md` (git-ignored, so not in the repo): every
  `Ruling:` line and the review's resolution are there. Its important content is repeated below.

## Blocked on the user (nothing else can move)

1. **Vercel does not serve the app.** `https://punx-gsp.vercel.app` returns Vercel's own 404 for every path, even after the
   push. The only deployment on record (seen through GitHub's deployments API) was built from `main`, which has no `web/`
   folder. Ask the user for: which commit/branch is labelled Production, whether the latest build is Ready or Error (and
   the end of its log if Error), the project's **Root Directory** (must be `web`) and **Production Branch** (must be
   `slice-2-web-foundation`; previews are login-protected by default, so the check needs a production deployment).
2. **Firebase and environment.** The user says they enabled Google and Email/Password and created Firestore and Storage.
   Still to confirm: the **Email link (passwordless sign-in)** toggle inside Email/Password; `punx-gsp.vercel.app` in
   Authentication, Settings, Authorized domains; the Blaze plan with a budget alert (Storage needs it); a registered web
   app (for the four `NEXT_PUBLIC_*` values); a service-account key; and the Vercel environment variables listed in
   `web/.env.example` (`FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_STORAGE_BUCKET`, `ALLOWED_EMAIL_DOMAIN=punx.ai`, and
   `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID`, `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN`). The
   `NEXT_PUBLIC_*` values are baked in at build time, so the project must be redeployed after they are set. Secrets go
   straight into Vercel (or the user's own `web/.env.local`), never into chat or the repo.
3. **A decision on password pre-registration** (see "Known risks"): disable "Enable create (sign-up)" and create staff
   accounts in the console, or use Google-only sign-in.
4. The user's own steps once it is up: click the emailed sign-in link, and run the phone check (open the deployed Preview
   on a phone; this also closes slice 1's phone check).

An alternative that bypasses Vercel: the user creates `web/.env.local` themselves with the Firebase values and the
bucket, and the app is run locally (`npm run dev`, or `npm run build` then `npm start -- -p 3100`) against the real
Firebase to exercise the Firestore and Storage adapters and the sign-in flow for the first time. Never print or paste
that file.

## Next steps once unblocked, in order

1. Task 2, Step 5: on the deployment, `curl -sI` the three `.unityweb` files (expect `content-encoding: br` and the right
   type), open `/spike/frame.html` and the mobile template (the spike files are still in `web/public/spike/`).
2. Task 6, Step 6: sign in (the user clicks the link), non-punx.ai refused, sign-out works; check the Vercel function logs
   if a sign-in fails (a failing Firebase is now a logged 500 with the failure kind and code, never a sign-in loop).
3. Task 9, Step 7: upload `fixtures/settings/valid.json` with the three sample GLBs from
   `unity/runner-template/Assets/StreamingAssets/sample/` and play the Preview; then sign out in a second tab and press a
   button in the first (expect a redirect to `/sign-in`). Fix any Firebase-adapter bug with a failing test first.
4. Task 10: remove `web/public/spike/`, run the six done-criteria from the spec on the deployment, write
   `docs/superpowers/notes/slice2-results.md`, update this note and `CLAUDE.md`, then `task-done` each open task.
   Then finish the branch with the user (merge, pull request, or keep) per `finishing-a-development-branch`.
   Also verify in the deployment's response headers that the template pages carry
   `Content-Security-Policy: frame-ancestors 'self'; connect-src 'self' blob: data:` (the later rule must win on Vercel).

## How to work here

- Node.js 24.19.0 and npm are installed (with the user's yes, via winget). A shell opened before that does not see it: in
  Git Bash `export PATH="/c/Program Files/nodejs:$PATH"`. Run web commands from `web/`.
- Unity 6000.3.25f1 is installed. `tools/run-tests.ps1 -Platform EditMode|PlayMode`, `tools/build-webgl.ps1 -Target
  desktop|mobile|both` (about 8 minutes for both), `tools/publish-template.ps1 -Target both` (copies `Builds/` into
  `web/public/templates/`; every republish adds about 15 MB to the repo's history, so do it only when the template
  changes). Run PowerShell tools from Git Bash as `powershell -NoProfile -ExecutionPolicy Bypass -File ...`.
- The in-app browser pane is often hidden, which stops `requestAnimationFrame`; to test the player anyway, replace
  `window.requestAnimationFrame` with a `MessageChannel` loop right after navigating (see `slice1-results.md`).
- **Ask before any push, install, or other outside-the-worktree action.** A plain `git push` was once run without asking
  (the user's yes had been for the first 7 commits); it was scanned clean afterwards, but do not repeat it. The repo is
  public: scan what you push for secrets and personal paths first.
- Work test-first, mutation-check security rules, and keep Git Bash backslash traps in mind (use script files or the
  editor tool for edits containing backslashes). Pure logic sits behind ports with in-memory fakes in `web/src/lib/**/memory.ts`.

## Decisions and rulings worth keeping

- Vercel from day one; real accounts, `@punx.ai` only (Firebase email-link sign-in, domain checked on the server at
  sign-in **and** on every request, verified email required); all-Firebase storage (Firestore + Cloud Storage, Blaze
  plan); uploads go through the server (4 MB GLB cap fits under Vercel's 4.5 MB limit), so no signed links; accounts and
  AI came into scope on the user's choice, with the work split into three web slices.
- **Google sign-in was added on 2026-10-04** next to the email link ("Continue with Google" on `/sign-in`, a popup, then the same
  `/api/session` path). The server did not change: it checks the verified address and the `@punx.ai` domain on the ID token
  whatever the provider. The `hd` parameter sent to Google is only a hint for its account chooser. Both providers are enabled in
  Firebase. A Google-only setup (turn the Email/Password provider off) would close the password pre-registration risk below.
- The cookie is `__Host-session` (the plan said `session`; the final review asked for the prefix). Origin is checked on
  every POST, PUT and DELETE; every page and route calls `requireUser`/`currentUser` itself; there is no `proxy.ts`.
- A refused credential (`AuthRejectedError`) is a 401 or a redirect; any other failure from Firebase is a logged 500. Logs
  carry the run id and the failure's kind and code, never a message or file contents.
- `checkGlb` reads the file like glTFast: exactly one JSON part, at most one binary part, nothing else, and no `uri` key
  anywhere in any case. Settings must be strict UTF-8.
- **The winnability rule is numerically identical in Unity and the web:** `Winnability.cs` does its arithmetic in double
  from the float inputs (Mono and IL2CPP disagreed in float), and `web/src/lib/settings.ts` rounds inputs with
  `Math.fround` then does doubles. `fixtures/settings/winnability-grid.txt` (made by Unity, 1,974,723 tunings, 1,279,527
  playable) is reproduced by both `WinnabilityGoldenTests.cs` and `settings.test.ts`. If the rule changes on purpose,
  regenerate it with the explicit Unity test (`Regenerate_the_golden_file`, run by name with
  `.superpowers/sdd/.../run-explicit-unity-test.ps1` or `-testFilter`), then rebuild and republish the templates.
- The template pages carry `connect-src 'self' blob: data:`, so the player cannot fetch from another origin (verified in a
  browser with a `no-cors` fetch). The slice 1 follow-ups about hardening the player's own loader (download provider,
  instantiation mask) remain a gate before any use beyond punx.ai (`slice1-results.md`).
- `recordFile` replaces the whole `files` map in the Firestore transaction (file names contain dots); stores refuse an
  existing name (`ifGenerationMatch: 0`), so two simultaneous uploads of one file cannot overwrite each other.

## Known risks and deferred items

- **Password pre-registration.** Firebase cannot disable password sign-up while keeping email links, and the Admin SDK
  redacts `passwordHash`, so no server check can see it. Someone who knows a staff address could register an unverified
  password account for it before that person's first email-link sign-in; afterwards the account is verified and the
  attacker's password still works. Options: turn off "Enable create (sign-up)" and create staff accounts in the console,
  or use Google sign-in and refuse the `password` provider. The user has not decided.
- Deferred review items: an object stored but never recorded blocks its name (the upload form makes a fresh run each time,
  so a retry works; pending runs are removed after an hour), and the sign-in page's cross-device path uses
  `window.prompt`, which some in-app mail browsers return null from.
- Unverified until the deployment: that Vercel sends the Brotli headers for `.unityweb`, that the template CSP wins over
  the all-routes CSP there, that `firebase-admin` works from the Vercel environment variable, that sign-in emails are not
  filtered as spam, and the Blaze cost (a budget alert should exist).
- The committed Unity builds were republished after the Winnability change (`20bc1b9`); the old ones are in history.
- Slice 1 leftovers: the phone check, and the minor items listed in `slice1-results.md`.

## Open questions for the user

- Vercel settings (above), the Firebase confirmations, and the password pre-registration choice.
- Merge, pull request, or keep the branches (`slice-1-unity-runner` and `slice-2-web-foundation`; `main` is still the
  setup commit). Slice 2 builds on slice 1, so they would merge in that order.
- Whether to plan slice 3 (the node editor, n8n-style but easier to understand) next; brainstorm it first, with the
  reference note.
