# Slice 9: what to deploy, and in what order (prepared 2026-10-09, for the studio to run)

**Done 2026-10-09:** the worker was deployed from `main` (`837aef5`), revision `blender-worker-00006-2np`, and the live `smoke.mjs` ended `all checks passed` (the freeform builds took 6.2 to 6.5 s each on Cloud Run, against 2.6 s locally; the website deployed on Vercel at the merge). What is left is step 3, the first look by eye, and the Make it timing: a game with 6 models makes 12 builds one after another, so check it finishes inside Play's time.

Nothing here has been run. Project `punx-gsp`, region `us-east1`, worker `blender-worker`. The slice 9 code is on `origin/slice-9-art-pipeline` (13 commits ahead of `main`, a fast-forward).

## What needs deploying, and what does not

| Part | Deploy? | Why |
|---|---|---|
| **Blender worker** | **Yes, first** | New `model` kind, rigs, per-target budgets, stock clips (`recipe.mjs`, `server.mjs`, `scripts/*`). The image pins Blender 5.2.2, the version the tests ran with. |
| **Website (Vercel)** | **Yes, second** | Pushing `main` starts the production build. The web sends freeform bodies; an old worker would answer 422 for them, so the worker goes first. (An old web with a new worker is harmless: old recipes are unchanged.) |
| Packager | No | `packager/` is unchanged on this branch. The Android export swaps the phone file in under the normal name, so the packager sees ordinary names. |
| Windows and Android players | No | No Unity runtime code changed. The rebuilt players differ only by the `sample-freeform` test files. Do not upload them; the players already in the bucket are fine. |
| `JOB_VERSION` | No bump | Old recipes build identical output; freeform bodies have their own keys. |

## 1. Worker (Cloud Shell, as the studio's account)

```bash
cd ~/punx-gsp-2026 2>/dev/null || { git clone https://github.com/PUNX-PH/punx-gsp-2026.git && cd punx-gsp-2026; }
git fetch origin && git checkout slice-9-art-pipeline && git pull

gcloud run deploy blender-worker --source blender-worker --region us-east1 --no-allow-unauthenticated \
  --service-account blender-runner@punx-gsp.iam.gserviceaccount.com --max-instances 2 --concurrency 1 --memory 2Gi --cpu 1 --timeout 120

node blender-worker/smoke.mjs https://blender-worker-202701573550.us-east1.run.app "$(gcloud auth print-identity-token)"
```

The smoke test must end with `all checks passed`. New lines to look for: the freeform rigged fox on a PC (Run, Jump) is `ok`, the same fox for a phone stays within 5000 triangles, the freeform crate has no clips, an unknown shape is refused with 422. The same test passes on the development
machine against the real wrapper and real Blender 5.2.2 (each build about 2.6 s, far below the 60 s job limit). The first call after the service has been idle includes a cold start.

Rollback, if the smoke test fails: `gcloud run revisions list --service blender-worker --region us-east1` then
`gcloud run services update-traffic blender-worker --region us-east1 --to-revisions=<PREVIOUS_REVISION>=100`.

## 2. Website

Merge and push `main` only on the studio's word (it starts a production build on Vercel):

```bash
git checkout main && git pull
git merge --ff-only slice-9-art-pipeline
git push origin main
```

Then check https://punx-gsp.vercel.app: the Games page's Make it box makes a game whose models are built "Custom" (the card says "N triangles (M on a phone)"), and a Build Model step offers Kind "Custom". If anything is wrong, Vercel's Deployments page can promote the
previous deployment, and the worker stays compatible.

## 3. First live look (by eye, with the studio's key)

Make a game from a short idea (a fox that runs and jumps, say). What to judge: do the models read as what they are, do the legs move in Run, do the phone and PC variants both look right, are the obstacles and pickups readable. Press Build for Android and run the APK on a phone:
the phone variant should be the one inside (look at the frame rate: the phone budgets are a starting guess, never measured on a phone). Note what Claude does badly (limbs not sunk into the body, mirrored parts, floating parts) and improve `freeformSystemPrompt()` in `web/src/lib/ai/designPrompts.ts`.
