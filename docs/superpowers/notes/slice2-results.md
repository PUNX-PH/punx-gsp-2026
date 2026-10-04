# Slice 2 results: web foundation, on the deployment (2026-10-04)

The web app runs at **https://punx-gsp.vercel.app** (Vercel project `punx-gsp-2026`; `punx-gsp-2026.vercel.app` redirects to it).
Its Production Branch was `slice-3b-node-canvas` while these checks ran (**since the merge it is `main`**: the branch was
fast-forwarded into `main` on 2026-10-04 and Branch Tracking changed to `main`). That branch contained slices 2, 3a and 3b, so one
deployment carried the deployed checks of all three (their results are in `slice3a-results.md` and `slice3b-results.md`). Checked at commit `d324083`.

Who checked what: **me** means I ran it from outside with `curl` or read the repository; **the user** means they did it in a real
browser and reported "all checks passed" without a per-step transcript, so nothing below names an exact message they saw.

## The six done-criteria

| # | Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | Signed out, every page leads to sign-in and every API call is refused | Me, `curl` on 15 routes: pages answer 307 to `/sign-in`; every API call answers 401; the upload route answers 405 to a GET (it is PUT only, and a PUT answers 401) | Passed |
| 2 | Signing in works only for a verified `@punx.ai` address | A real sign-in with the user's `@punx.ai` account (the screenshot showed the home page; the user did not say whether it was Google or the email link). The domain rule is a unit-tested table of lookalikes and is applied again on every request | A real sign-in passed. **Refusal of an outside address was not tried live** |
| 3 | A signed-in person uploads a valid run and plays it, on a desktop and on a phone | The user uploaded `fixtures/settings/valid.json` and the three sample GLBs and played it (a screenshot showed the palette, the hero and the road); the phone check was reported passed | Passed. This also closes slice 1's phone check |
| 4 | An invalid run is refused in plain words | Unit tests (`checkGlb`, the settings validator against every fixture, the run service with fakes) | **Not run on the deployment** |
| 5 | One person cannot read or delete another person's run | Unit tests with an in-memory store; the user's "second account" check was reported passed under slice 3a (see there for what is known) | Tests passed; live: see 3a |
| 6 | No secret in the repository | Me: no tracked `.env`, key or service-account file; no private-key, token or key pattern in any commit (the only hits are test assertions that logs never contain a private key); no personal path | Passed |

Other checks from the plan, Task 2 and Task 10: the three `.unityweb` files, desktop and mobile, answer with
`Content-Encoding: br` and the right content type (wasm 6,149,820 bytes, framework 71,749, data 1,384,918 desktop and 1,383,565
mobile); the template pages carry `Content-Security-Policy: frame-ancestors 'self'; connect-src 'self' blob: data:`, so the later
rule wins on Vercel; every other page carries `frame-ancestors 'self'`. Signing out in a second tab and pressing a button in the first
redirected to sign-in (the user). `web/public/spike/` is removed and now answers 404.

## Limits and risks seen (plan Task 10, step 3)

- **Brotli headers on Vercel:** work, as above. The risk in the plan is closed.
- **Sign-in email delivery:** the user received the link. Whether it arrived in the inbox or in spam was not recorded.
- **Cold start:** the first request to a server route took about 1.2 s from here; later ones about 0.4 s; static files about 0.13 s.
  These routes only redirect or refuse, so they do not include a Firebase call.
- **Blaze:** the project is on a free trial (90 days and $300 of credit, as the console shows). The user was setting up a budget alert in
  Google Cloud billing; I did not see it listed afterwards. The real cost after the trial has not been seen.
- **Repository size:** `.git` is 21 MB (83 commits), with the two Unity builds committed; each republish of a build adds about 15 MB.

## What went wrong on the way to a working deployment, and the fix

1. **Root Directory.** The Vercel project was made from `main`, which has no `web/`. It was `./`; it must be `web`. Also turn off
   "Skip deployments" (Vercel switches it on when a subfolder is set), or a push that only touches files outside `web/` builds nothing.
2. **Production Branch** is no longer on Settings, Git: it is **Settings, Environments, Production, Branch Tracking**.
3. **Framework Preset** was "Other" (the project was created from the empty `main`): the build "succeeded" in 22 seconds with no
   output, and every URL returned Vercel's own 404 (`X-Vercel-Error: NOT_FOUND`, even `/favicon.ico`). Set it to **Next.js**.
4. **Redeploy rebuilds the old commit.** Redeploying a deployment of `main` failed with "The specified Root Directory "web" does not
   exist". Use Create Deployment with the branch name, or push a commit.
5. **`NEXT_PUBLIC_*` variables cannot be Sensitive** on Vercel; only `FIREBASE_SERVICE_ACCOUNT` is.
6. **Every route that loads `firebase-admin/auth` answered 500** with `ERR_REQUIRE_ESM`: `jwks-rsa` 4 `require()`s `jose` 6, which is
   ES-only, and the Vercel runtime refuses `require()` of ES modules even on Node 24. Reproduced locally with
   `node --no-experimental-require-module`. Fixed with an npm override (`jwks-rsa` gets `jose` ^5.10.0, which has a CommonJS build and
   every function `jwks-rsa` calls; `web/package.json`), and `engines.node` is pinned to `24.x`. If a later `firebase-admin` or
   `jwks-rsa` upgrade brings the error back, test with that Node flag before deploying.
7. **Cloud Storage needs the Blaze plan**, and email-link sign-in is limited to 5 emails a day on the free Spark plan (25,000 on Blaze),
   so the project was upgraded. The bucket's region was not confirmed in this session; Cloud Storage's free allowance applies only
   in `us-east1`, `us-central1` and `us-west1`.
8. **Google sign-in was added** (see `slice2-handoff.md`): a button on `/sign-in`, the server unchanged.

## Still open

- **The password pre-registration decision** (`slice2-handoff.md`, "Known risks"). The Email/Password provider is still enabled next to
  Google. Turning it off would make sign-in Google-only and close the risk.
- **Not run on the deployment:** an outside (non-`punx.ai`) account refused; a bad run file of each kind; the budget alert's existence;
  the Blaze cost after the trial.
- **Slice 1's follow-ups** (hardening the player against untrusted GLBs and URLs) remain a gate before any use beyond punx.ai
  (`slice1-results.md`).
- The deferred review items in `slice2-handoff.md` (an object stored but never recorded blocks its name until the pending run is
  removed after an hour; `window.prompt` for the cross-device email link).
