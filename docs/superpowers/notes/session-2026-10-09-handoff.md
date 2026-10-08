# Session handoff (written 2026-10-09, end of a long session)

Read `CLAUDE.md` first, then this, then `slice7-handoff.md`. This note says what was in flight when the session ended and what to do next.

## The product (the owner's words)

Users prompt a game idea; the platform generates that game (no limits on the game, 2D or 3D) and its models (not low-poly: budgeted detail), and it builds for PC or Android. Unity runs the game as a pre-built player; Blender builds the models; Claude generates (memory note `project-product-goal`).

## State of the repo and the live site

- `main` holds slices 2 to 7 and is deployed at https://punx-gsp.vercel.app (open it by that address; Vercel's per-deployment links fail Google sign-in).
- **Local commits not pushed** (`main` is ahead of `origin/main`): the CLAUDE.md update (`2cd00ca`) and the Unity `.meta` files (`db1816e`). The slice 8 plan file is written but **not committed**; the slice 9 plan is **not written yet**. Ask before any push (a push to `main` starts a production build).
- Live facts (2026-10-08): the Anthropic key works; Describe Game with Make a game now works (after the grammar fix: the game is JSON text in one string field); Preview still shows the OLD player ("hero.glb is not a valid GLB file") because the new player is not published; the packager is deployed and private (`https://packager-202701573550.us-east1.run.app`, `PACKAGER_URL` and `PACKAGER_KEY` set in Vercel) but holds **no players** yet, so Build for says "not set up".
- Unity: Hub 3.22.2 signed in as rey@punx.ai, **Unity Personal licence active**, Editor 6000.3.25f1 with WebGL, Android (SDK, NDK, OpenJDK) and Windows modules. Batch runs work. **EditMode 167 passed, PlayMode 19 passed** (first ever run of the slice 6 and 7 Unity code).

## In flight when the session ended

- **A WebGL build was running in the background** (`powershell tools\build-webgl.ps1`, it takes many minutes; output to `Builds\runner-desktop` and `Builds\runner-mobile`, log `Builds\build.log`, size report `Builds\size-report.json`). **Do not start another Unity process until it has finished** (two Unity processes on one project clash). Check: is a `Unity.exe` still running? If the build finished, read `Builds\size-report.json` (budget 15,000,000 bytes per target) and the tail of `Builds\build.log`. If it failed or was cut off, run `tools\build-webgl.ps1` again.

## Next steps, in order

1. Finish or re-run the WebGL build; then `tools\build-players.ps1` (Windows and Android; `BuildPlayers.cs` has never run, expect fixes); measure sizes, `RUNNER ready in N ms` (budget 15 s) and the frame rate.
2. Ask, then publish the WebGL template (`tools\publish-template.ps1`, about 16 MB into the repo), push `main`, wait for the Vercel build; after that the Preview should play a described game (Describe Game card text still unseen by the owner).
3. Ask, then upload `windows.zip`, `android.apk` and `players.json` to the packager's bucket `gs://punx-gsp-players` (steps in `packager/README.md`); test Build for.
4. Slice 8 (Lua scripts): spec approved, plan written at `docs/superpowers/plans/2026-10-09-slice8-lua-games.md`; commit it, then execute inline (the plan lists the studio asks: vendoring MoonSharp, a Lua parser npm package).
5. Slice 9 (art pipeline): spec approved at `docs/superpowers/specs/2026-10-08-art-pipeline-design.md`; **write the plan** (milestones are in the spec's Build order: measure and look gate, kit v2, materials and textures, variants and LODs with `target` in the worker body and two worker calls, sprite renderer, web side, Unity side, acceptance).
6. UI refresh: the owner shared a Google Sheet that is only a skills list (Design group: Impeccable, Frontend Design, UI/UX Pro Max); the project already has `frontend-design`. **Still needed from the owner: what the new UI should be** (a mockup, a few sentences, or "redesign your way").

## Owner's own to-dos (told to them; unconfirmed)

Back up `studio.keystore` and its password (the file was deleted in Cloud Shell; the secret `studio-keystore` in Secret Manager has it, recover with `gcloud secrets versions access latest --secret studio-keystore --out-file studio.keystore`); destroy the old secret versions (the weak password `123456` was shared in chat; latest versions are good); `rm ~/packager-invoker-key.json` and `unset CLOUDSDK_CONFIG` in Cloud Shell; a Google Cloud budget alert and an Anthropic Console monthly spend limit; a phone for the frame-rate check; decide on Email/Password sign-in (still enabled next to Google).

## Facts that cost time this session (do not relearn)

- The Bash tool eats backslashes in heredocs and `node -e` strings: write files with the Write or Edit tools, or put regexes in a file; one command per `gcloud` step and never paste several at once in Cloud Shell.
- `gcloud secrets versions access` mangles binary secrets to stdout; use `--out-file`. The Cloud Shell repo clone must be of `main` (`git clone --depth 1`), not the old branch.
- Anthropic structured outputs refuse a big schema ("compiled grammar is too large", a 400): keep schemas tiny. A 400's explanation is now logged (`detail`).
- `unity/tools/engine-check.sh` and `compile-runtime.sh` run with no Unity license; Unity now works, so `tools\run-tests.ps1` is the real gate.
