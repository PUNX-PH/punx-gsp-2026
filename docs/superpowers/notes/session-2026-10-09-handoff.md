# Session handoff (written 2026-10-09, end of a long session)

Read `CLAUDE.md` first, then this, then `slice7-handoff.md`. This note says what was in flight when the session ended and what to do next.

## The product (the owner's words)

Users prompt a game idea; the platform generates that game (no limits on the game, 2D or 3D) and its models (not low-poly: budgeted detail), and it builds for PC or Android. Unity runs the game as a pre-built player; Blender builds the models; Claude generates (memory note `project-product-goal`).

## State of the repo and the live site

- `main` holds slices 2 to 7 and is deployed at https://punx-gsp.vercel.app (open it by that address; Vercel's per-deployment links fail Google sign-in).
- **Local commits not pushed** (`main` is ahead of `origin/main`): the CLAUDE.md update (`2cd00ca`) and the Unity `.meta` files (`db1816e`). Both plans are written and committed: `docs/superpowers/plans/2026-10-09-slice8-lua-games.md` and `2026-10-09-slice9-art-pipeline.md`. Ask before any push (a push to `main` starts a production build).
- Live facts (2026-10-08): the Anthropic key works; Describe Game with Make a game now works (after the grammar fix: the game is JSON text in one string field); Preview still shows the OLD player ("hero.glb is not a valid GLB file") because the new player is not published; the packager is deployed and private (`https://packager-202701573550.us-east1.run.app`, `PACKAGER_URL` and `PACKAGER_KEY` set in Vercel) but holds **no players** yet, so Build for says "not set up".
- Unity: Hub 3.22.2 signed in as rey@punx.ai, **Unity Personal licence active**, Editor 6000.3.25f1 with WebGL, Android (SDK, NDK, OpenJDK) and Windows modules. Batch runs work. **EditMode 167 passed, PlayMode 19 passed** (first ever run of the slice 6 and 7 Unity code).

## Done at the very end

- **The WebGL build finished successfully (2026-10-09):** `Buildsunner-desktop` and `Buildsunner-mobile`, **8,607,010 and 8,607,380 bytes** (budget 15,000,000 each), log `Buildsuild.log` says "Build Finished, Result: Success". It is **not yet published** (no `web/public/templates` change, nothing pushed for it). One Unity process was still alive afterwards (probably the compiler server); check `Get-Process Unity` before starting another Unity run. The build rewrote `Assets/Scenes/Main.unity` and `ProjectSettings/GraphicsSettings.asset` (uncommitted; look at the diff, commit them only if the changes are the intended shader inclusions).

- **The WebGL template is published** (`db6a41e`, live on punx-gsp.vercel.app, the wasm size matches). Not yet seen playing by the owner.
- **The Windows and Android players built** (2026-10-09, `tools/build-players.ps1`, exit 0): `Builds/player-windows` (92 MB, 201 files; it holds a `*_BurstDebugInformation_DoNotShip` folder that must not be shipped) and `Builds/player-android/Runner.apk` (27.1 MB). **Ready to upload from `Builds/upload/`** (git-ignored): `windows.zip` (33.8 MB, made with `tar -a -c`, burst folder excluded), `android.apk`, `players.json`. They are NOT yet in the bucket `gs://punx-gsp-players` (upload through the Cloud Console: Storage, the bucket, Upload files; there is no gcloud on this machine).
- **The packager was run for real against those files** (locally, with Unity's own apksigner and a throwaway key, since deleted): the zip editor rebuilt the real 441-entry APK, added `assets/game/settings.json`, kept the rest of META-INF, apksigner signed it and `apksigner verify` says Verifies (v2 and v3); the Windows zip gets `Runner_Data/StreamingAssets/game/settings.json`. Not yet run: a player starting with a packed game (the Windows exe reading its own StreamingAssets/game) and the deployed packager.

- **Slice 8 has started** (branch `slice-8-lua-games`, local, not pushed; ledger `.superpowers/sdd/2026-10-09-slice8-lua-games/progress.md`, git-ignored). **Task 1 is done** (`9ca20dd`): MoonSharp 2.0.0.0 is vendored under `unity/runner-template/Assets/Runner/ThirdParty/MoonSharp` (the user allowed the download), referenced by `Runner.Runtime.asmdef`, compiles (`bash unity/tools/compile-runtime.sh`) and Unity imports it (EditMode 167 pass). **Next is Task 2** (`Runtime/Script/Pure/ScriptHost.cs` with `ScriptSandboxTests`: hard sandbox, removed names, instruction budget through a yielding coroutine), then Task 3 (the WebGL and Android proof, a gate). To resume: `git checkout slice-8-lua-games`, read the plan at `docs/superpowers/plans/2026-10-09-slice8-lua-games.md` and the ledger, and continue with Task 2.

## Next steps, in order

1. Finish or re-run the WebGL build; then `tools\build-players.ps1` (Windows and Android; `BuildPlayers.cs` has never run, expect fixes); measure sizes, `RUNNER ready in N ms` (budget 15 s) and the frame rate.
2. Ask, then publish the WebGL template (`tools\publish-template.ps1`, about 16 MB into the repo), push `main`, wait for the Vercel build; after that the Preview should play a described game (Describe Game card text still unseen by the owner).
3. Ask, then upload `windows.zip`, `android.apk` and `players.json` to the packager's bucket `gs://punx-gsp-players` (steps in `packager/README.md`); test Build for.
4. Slice 8 (Lua scripts): spec approved, plan written at `docs/superpowers/plans/2026-10-09-slice8-lua-games.md`; commit it, then execute inline (the plan lists the studio asks: vendoring MoonSharp, a Lua parser npm package).
5. Slice 9 (art pipeline): spec approved, plan at `docs/superpowers/plans/2026-10-09-slice9-art-pipeline.md` (its Task 1 is a gate: five reference models are shown to the owner before the rest is built). Execute after slice 8 or in parallel if two sessions are used (they touch different files: slice 8 is the Unity script host and the web script mode, slice 9 is the Blender worker, the builder and the run files).
6. UI refresh: the owner shared a Google Sheet that is only a skills list (Design group: Impeccable, Frontend Design, UI/UX Pro Max); the project already has `frontend-design`. **Still needed from the owner: what the new UI should be** (a mockup, a few sentences, or "redesign your way").

## Owner's own to-dos (told to them; unconfirmed)

Back up `studio.keystore` and its password (the file was deleted in Cloud Shell; the secret `studio-keystore` in Secret Manager has it, recover with `gcloud secrets versions access latest --secret studio-keystore --out-file studio.keystore`); destroy the old secret versions (the weak password `123456` was shared in chat; latest versions are good); `rm ~/packager-invoker-key.json` and `unset CLOUDSDK_CONFIG` in Cloud Shell; a Google Cloud budget alert and an Anthropic Console monthly spend limit; a phone for the frame-rate check; decide on Email/Password sign-in (still enabled next to Google).

## Facts that cost time this session (do not relearn)

- The Bash tool eats backslashes in heredocs and `node -e` strings: write files with the Write or Edit tools, or put regexes in a file; one command per `gcloud` step and never paste several at once in Cloud Shell.
- `gcloud secrets versions access` mangles binary secrets to stdout; use `--out-file`. The Cloud Shell repo clone must be of `main` (`git clone --depth 1`), not the old branch.
- Anthropic structured outputs refuse a big schema ("compiled grammar is too large", a 400): keep schemas tiny. A 400's explanation is now logged (`detail`).
- `unity/tools/engine-check.sh` and `compile-runtime.sh` run with no Unity license; Unity now works, so `tools\run-tests.ps1` is the real gate.
