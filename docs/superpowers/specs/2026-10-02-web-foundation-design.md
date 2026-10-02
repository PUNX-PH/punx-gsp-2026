# Web foundation (slice 2): design

Date: 2026-10-02. Status: awaiting review. Path: architectural (new subsystem). Parent:
`2026-10-02-studio-platform-v1-design.md`, which this slice amends (see "Changes to the v1 spec").

## Purpose

A person with a punx.ai email address opens the deployed site, signs in, uploads the files of a game
(a `settings.json` and one GLB model per role), presses Preview, and plays it in the Unity runner template
inside the site. Everyone else is refused.

This is the base the node editor (slice 3) and the AI step (slice 4) are built on. It settles the hosting,
sign-in, storage and serving questions first, with the smallest feature that exercises all of them.

**Done for this slice** (each is a check in "Testing and acceptance"):

1. Signed out, every page leads to sign-in and every API call is refused.
2. Signing in works only for a verified `@punx.ai` address.
3. A signed-in person uploads a valid run and plays it from the deployed site, on a desktop and on a phone.
4. An invalid run (unwinnable tuning, a GLB with the wrong header, too large, or not self-contained) is
   refused with a plain message that names the cause.
5. One person cannot read or delete another person's run.
6. No secret is in the repository.

## Decisions made with the studio

| Decision | Choice | Why |
|---|---|---|
| Hosting | Vercel from day one | The tool is meant to live on the web. Local-first would mean reworking storage later. |
| Who can sign in | Real accounts, `@punx.ai` addresses only | Bounds cost and abuse. Opening to outside creators is later work (quotas, open sign-up). |
| Identity | Firebase Authentication, email-link sign-in | Proves mailbox ownership with any mail provider, sends its own emails, and the studio already uses Firebase. |
| Data and files | Firebase: Firestore for records, Cloud Storage for files | One backend vendor. Needs the Blaze plan for the bucket (checked in the Firebase docs on 2026-10-02); the free allowance still applies on Blaze. |
| Scope split | Three web slices: this foundation, then editor and runner, then prompt and AI | Each ends in something that runs in a browser, so Vercel and sign-in problems surface early. |

Rejected: Vercel Blob with a Firebase database (a second storage vendor for no gain once Firebase is
chosen), and Vercel with Neon Postgres and a self-run auth library (more to build and secure, more
email infrastructure).

## Out of scope for this slice

The node canvas, graphs, the runner and its cache, Prompt and Describe Game, Blender, FBX/OBJ/image
uploads, palette extraction, sharing a run with other people, open sign-up and quotas, an admin screen.

## Architecture

```
Browser --sign-in link--> Firebase Auth
   |  ID token
   v
Vercel (Next.js app)
   /api/session ---------> verify token, check @punx.ai, set session cookie
   /api/runs ... --------> requireUser() -> Firestore (run records) + Cloud Storage (files)
   /api/runs/{id}/{file} -> owner-only, same-origin file route
   /templates/runner-desktop|mobile/  (static Unity builds)
   /runs/{id}/preview ---> iframe: template page ?settings=/api/runs/{id}/settings.json
```

### Units

| Unit | Does | Interface | Depends on |
|---|---|---|---|
| Sign-in page | Sends the emailed link and completes sign-in in the browser | Firebase web SDK; then `POST /api/session {idToken}` | Firebase Auth |
| Session | Turns an ID token into a server session cookie, and ends it | `POST /api/session`, `DELETE /api/session` | Firebase Admin |
| `requireUser()` | The one guard every page and API calls; re-checks the cookie, `email_verified` and the domain on each request | `requireUser() -> {uid, email}` or a 401 / redirect | Session |
| Settings validator | Validates a settings file exactly as the Unity template does | `validateSettings(text) -> {ok, settings} \| {ok:false, error}` | none (pure), shared `fixtures/settings` |
| GLB checker | Checks an uploaded GLB before it is stored | `checkGlb(bytes) -> {ok} \| {ok:false, error}` | none (pure) |
| Run store | Creates, reads, lists and deletes runs and their files | `createRun`, `putFile`, `getFile`, `listRuns`, `deleteRun` | Firestore, Cloud Storage |
| Run API and file route | HTTP over the run store; serves a run's files to its owner | See "Run flow" | `requireUser()`, run store, validators |
| Preview page | Picks the build and embeds the template with the run's settings URL | `/runs/{id}/preview` | Run store |
| Templates | The two Unity WebGL builds as static files | `/templates/runner-desktop/`, `/templates/runner-mobile/` | none |

The validator and the GLB checker are pure functions with no network, so they are tested without Firebase.

## Sign-in and access

- The sign-in page asks for an email address and sends a Firebase email link. It refuses an address that does
  not end in `@punx.ai` before sending, so no junk accounts or emails are created; that is a convenience, and
  the server below is the authority. The link opens the site, which completes sign-in and sends the ID token to
  `POST /api/session`.
- The server verifies the ID token with the Firebase Admin SDK, then accepts it only if `email_verified` is
  true **and** the part of the address after the last `@` equals `punx.ai` (lower-cased, exact match; so
  `x@punx.ai.evil.com`, `x@notpunx.ai` and `x@sub.punx.ai` are refused). Anything else gets "Only punx.ai
  email addresses can sign in", and no cookie is set.
- It then creates a Firebase session cookie (5 days), set `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`.
- `requireUser()` verifies the session cookie with revocation checking and repeats the domain test on every
  request, so removing an address from the allowed domain, or revoking a user in Firebase, takes effect at once.
- Pages redirect to `/sign-in`; API routes return 401 with a JSON message. A coarse redirect in the app's
  request proxy is allowed for convenience, but it is never the only check: each page and route calls
  `requireUser()` itself.
- Every state-changing route (`POST`, `PUT`, `DELETE`) also requires an `Origin` header equal to the site's
  own origin, as a second defence against cross-site requests.
- Sign-out ends the cookie and revokes the user's refresh tokens.

## Run data and storage

A **run** is one game: a settings file and its model files.

Firestore, collection `runs`, document id = a random 128-bit id (URL-safe):

```
{ ownerUid, ownerEmail, status: "pending" | "ready", createdAt,
  needed: ["hero.glb", "obstacle.glb", "coin.glb"],      // unique file names from settings.roles
  files:  { "settings.json": {size, sha256}, "hero.glb": {size, sha256}, ... } }   // what is stored so far
```

Cloud Storage, bucket created in `us-east1` (an Always Free region next to Vercel's default region),
objects at `runs/{runId}/{fileName}`. Firestore rules and Storage rules deny all client access; only the
server (Admin SDK) reads or writes. The rules files are in the repo and deployed with the Firebase CLI.

Limits: a GLB is at most 4 MB (under Vercel's 4.5 MB request and response limit for functions), a settings
file at most 16 KB, and one person may keep at most 20 runs, pending ones included (a 21st is refused with "You have 20 runs.
Delete one first."). A `pending` run older than one hour is deleted when its owner next lists or creates
runs. The SHA-256 of each file is stored for the runner's future cache keys.

## Run flow

All routes call `requireUser()`; the three that change state also check `Origin`.

1. `POST /api/runs` with the settings text. The server runs the settings validator (the same rules, messages
   and winnability check as the template), enforces the run cap, creates the run as `pending`, stores
   `settings.json`, and returns `{id, needed}`.
2. `PUT /api/runs/{id}/files/{name}` with the raw file as the body, once per name in `needed`. The name must be
   in `needed`; the body is read with a hard 4 MB cap; `checkGlb` runs on the bytes **before** anything is
   written to Storage. When the last needed file is stored, the run becomes `ready`.
3. `GET /api/runs/{id}/{file}` returns a stored file to its owner. `{file}` is looked up in the run's `files`
   map and never used to build a path from raw input. A missing run, a run owned by someone else and a file
   not in the map all return the same 404. Responses carry the correct type (`application/json`,
   `model/gltf-binary`), `X-Content-Type-Options: nosniff` and `Cache-Control: private`.
4. `DELETE /api/runs/{id}` removes the objects and the record (owner only).
5. `GET /api/runs` lists the caller's runs.

`checkGlb` accepts a file only if it is 12 bytes or more with magic `glTF`, version 2, a declared length equal to
the file size, a first chunk of type `JSON` that parses, `asset.version` starting with `2`, and **no external
references**: no `buffers[].uri` and no `images[].uri` (a self-contained GLB keeps its data in the file). Each
failure has its own message, for example "hero.glb: not a GLB file (wrong header)" or "hero.glb: refers to
files outside itself".

## Serving and Preview

- The two Unity builds are copied to `web/public/templates/runner-desktop/` and `runner-mobile/` by
  `tools/publish-template.ps1` (the `Builds/` output without `runs/`) and committed. They are about 7.7 MB
  each and change rarely; every rebuild adds that much to the repository's history, which is acceptable for
  now and revisited if it hurts.
- Response headers for `*.unityweb` files: `Content-Encoding: br` and a MIME type from the extension
  underneath. If Vercel will not send these, the build's decompression fallback (already on) still works,
  only slower; the plan tests this first.
- The settings URL is root-relative, `/api/runs/{id}/settings.json`. The template turns it into an absolute
  URL against its own page (fixed in slice 1, `UrlTools.ToAbsolute`) and loads the GLBs beside it, so every
  request is same-origin and carries the session cookie.
- `/runs/{id}/preview` checks the owner and that the run is `ready`, then renders a full-window iframe of
  `/templates/runner-mobile/index.html` when the device's primary pointer is coarse (a touch screen), and
  `runner-desktop` otherwise, with `?settings=/api/runs/{id}/settings.json`.
- The app sends `X-Frame-Options: SAMEORIGIN` and a `frame-ancestors 'self'` content-security-policy so only
  the site can embed its own pages.
- Pages: `/sign-in`, `/` (your runs, with Preview and Delete), `/runs/new` (pick the settings file and the
  models; shows each file's result), `/runs/{id}/preview`. The interface is plain and functional; it is
  replaced by the editor in slice 3.

## Security

- Untrusted input: every uploaded byte and every filename. File names come only from the validated settings
  (letters, digits, `-`, `_`, plus `.glb`, as the template already requires), and Storage paths are built
  from the run id the server generated.
- Secrets live in Vercel environment variables only: `FIREBASE_SERVICE_ACCOUNT` (the service-account JSON,
  server-side), `FIREBASE_STORAGE_BUCKET`, `ALLOWED_EMAIL_DOMAIN` (`punx.ai`). The Firebase web config
  (`NEXT_PUBLIC_FIREBASE_*`) is public by design. `.env*` files are git-ignored. Nobody pastes a key into
  chat.
- Firebase's authorized domains list holds only the production domain and `localhost`; preview deployments
  get a preview-only domain added by hand when needed.
- This slice does not harden the Unity player's own loader (the follow-ups listed in the slice 1 results: a
  download provider that allows only the role URL and caps its size, an instantiation mask, a same-origin rule
  for `settings`). It makes the player safe to expose to the studio in practice: run files are readable only
  by their owner, GLBs are checked to be self-contained, and the only origin involved is the site's own. The
  player-side hardening stays a gate before any use beyond punx.ai.

## Error handling

Every failure says what and why in plain words and keeps the page usable: "settings.tuning.jumpHeight: 2.2 m is
too low to jump an obstacle at 2 m/s ...", "hero.glb: larger than 4 MB", "You have 20 runs. Delete one first.",
"Only punx.ai email addresses can sign in". Server errors that are not the person's fault say "Something went
wrong on our side" and are logged with the run id, never with file contents.

## Testing and acceptance

- **Test-first, pure code.** The settings validator is run against every file in `fixtures/settings` and must
  agree with the Unity template on all of them (accept and reject), including the winnability messages. The
  domain rule has a table of addresses, including the lookalikes above. `checkGlb` is tested on slice 1's real
  sample GLB and on GLBs built in memory by a test helper: empty, wrong magic, wrong version, wrong declared
  length, invalid JSON, and one with an external `uri`.
- **Test-first, with fakes.** `requireUser()`, the run API and the file route run against an in-memory run
  store: signed out, wrong domain, unverified email, someone else's run, over the cap, oversize body, name not
  in `needed`, and the pending to ready transition.
- **Deployed checks, in a real browser.** On the Vercel deployment: every page and API refused when signed out
  (checked by me); sign-in with an emailed link, **done by you** (the link goes to your mailbox); upload the
  sample run and play it; the same with a deliberately bad file of each kind; a second account cannot open
  the first one's run URL; the template files carry the expected headers.
- **Phone.** Open the deployed Preview on a phone. This is also the open phone check from slice 1, without
  the administrator shell or a LAN server.

## Setup the studio does (the plan lists the exact steps)

1. Create a Firebase project; create Firestore and the default Storage bucket in `us-east1`; upgrade to the
   Blaze plan with a low budget alert (Cloud Storage requires it, and the free allowance still applies).
2. Enable the email-link sign-in method; add the production domain to Firebase's authorized domains.
3. Create a service-account key and set the Vercel environment variables (nothing is sent to anyone else).
4. Create the Vercel project from the GitHub repository with root directory `web`. Vercel's Hobby plan is
   limited to personal, non-commercial use, so a company tool probably needs Pro; check the current terms.
5. Optional: a custom domain such as `studio.punx.ai` through Cloudflare DNS.
6. Allow installing Node.js LTS on this machine (it is not installed; nothing is installed without asking).

## Risks, tested first in the plan

1. **Unity files on Vercel:** whether the `Content-Encoding: br` headers reach `*.unityweb`, and whether a
   build loads from a sub-path inside an iframe.
2. **Firebase Admin on Vercel functions:** credentials from an environment variable, cold-start time, session
   cookies.
3. **Sign-in email delivery:** Firebase's default sender may be filtered as spam. The fallback is a custom
   sender domain, which Cloudflare DNS makes easy; not part of this slice unless it bites.
4. **Repository size** from committing Unity builds.
5. **Blaze billing:** cost surprises. Mitigation: the budget alert, the 4 MB and 20-run limits, and nothing in
   this slice that loops or fans out.

## Repository layout

```
web/                     the Next.js app (src/, public/templates/, vercel.json or next.config headers)
fixtures/settings/       shared with the Unity template (already there)
firebase.json, firestore.rules, storage.rules      deny-all rules, deployed with the Firebase CLI
tools/publish-template.ps1                       copies Builds/runner-* to web/public/templates/
```

## Changes to the v1 spec

`2026-10-02-studio-platform-v1-design.md` is updated alongside this one: accounts (punx.ai only) and cloud
hosting are in scope, storage is Firestore and Cloud Storage instead of local disk and SQLite, the security
section no longer assumes a local network, the proposed stack names Next.js, Vercel and Firebase, and the
build order is renumbered: slice 2 is this one; slice 3 is the editor and runner with the non-AI nodes
(Reference Image, Asset Upload, Palette from Image, Game Template, Preview); slice 4 is Prompt and Describe
Game; slice 5 is Blender Prepare Asset.
