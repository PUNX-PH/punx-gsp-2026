# Slice 5: Google Cloud setup, progress and what is left (2026-10-05)

Written when the studio was part-way through the setup and switching computers. Read it with `slice5-handoff.md` (what slice 5 is and its
live checks) and `blender-worker/README.md` (the commands). **Nothing secret is in this note**: the project id, project number and the
service URL are not secrets, and the invoker key (step 7 below) has never been written anywhere except the clipboard and then Vercel.

## Where it stands

| Step | State |
|---|---|
| Cloud Run, Cloud Build and Artifact Registry switched on in project `punx-gsp` (project number `202701573550`) | **done** |
| Region chosen: the Cloud Storage bucket `punx-gsp.firebasestorage.app` is in `US-EAST1`, so the worker is in `us-east1` | **done** |
| No-roles runtime account `blender-runner@punx-gsp.iam.gserviceaccount.com` | **done** |
| Worker built from the branch and deployed: service `blender-worker`, region `us-east1`, **private** (no public access), runs as `blender-runner`, max 2 instances, concurrency 1, 2 GiB, 1 CPU, 120 s request timeout; first revision `blender-worker-00001-xqf`; Artifact Registry repository `cloud-run-source-deploy` created by the deploy | **done** |
| Smoke test against the real worker, with a Google identity | **done, all five checks passed** |
| 7. Invoker account `blender-invoker` (may only call the worker) and its key | **to do** |
| 8. `BLENDER_WORKER_URL` and `BLENDER_WORKER_KEY` in Vercel (Production) | **to do** |
| 9. Budget alert on the Google Cloud project | **to do** |
| 10. Live checks on the website (needs the slice 5 code on production: see "The live checks need `main`") | **to do** |

**The worker's address:** `https://blender-worker-202701573550.us-east1.run.app`

**What the smoke test showed** (from Cloud Shell, 2026-10-05): `GET /health` 200; the cube OBJ prepared (200); an OBJ with no geometry refused
with 422 `empty`; a sphere made (200); and a call with no identity refused (401 or 403), so the service is private. Warm jobs took 4 to 5
seconds; the first job after idle took about 13 seconds (the container starting plus Blender's first launch). Blender runs fine in the
container, so the Dockerfile's library list was enough.

## Do these next (in Google Cloud Shell: console.cloud.google.com, project `punx-gsp`, the `>_` icon)

Cloud Shell needs no installs. If the clone from before is gone, redo it first:
`git clone --branch slice-5-blender-assets --depth 1 https://github.com/PUNX-PH/punx-gsp-2026.git && cd punx-gsp-2026`.

**7. The key the website uses.** An account that can only call the worker, and a key for it. Do not paste the key into chat or a file in the repo.

```bash
gcloud iam service-accounts create blender-invoker --display-name "Blender worker invoker"
gcloud run services add-iam-policy-binding blender-worker --region us-east1 --member "serviceAccount:blender-invoker@punx-gsp.iam.gserviceaccount.com" --role roles/run.invoker
gcloud iam service-accounts keys create ~/blender-invoker-key.json --iam-account blender-invoker@punx-gsp.iam.gserviceaccount.com
node -e "console.log(JSON.stringify(require(process.env.HOME + '/blender-invoker-key.json')))"
```

The last command prints the key as one long line starting `{"type":"service_account"`: triple-click it to select the whole line and copy it.
If key creation is refused by an organization policy, that is a different problem (ask what the policy message says).

**8. Vercel** (project `punx-gsp-2026`, Settings, Environment Variables). Add, for **Production** only:

1. `BLENDER_WORKER_URL` = `https://blender-worker-202701573550.us-east1.run.app`
2. `BLENDER_WORKER_KEY` = the line you copied, with **Sensitive** turned on.

Then delete the key file so the only copy is in Vercel: `rm ~/blender-invoker-key.json`. The variables only reach deployments made after they
are saved, so redeploy after the slice 5 code is on `main` (next section).

**9. Budget alert.** Google Cloud console, Billing, Budgets and alerts, create a budget for the project (a small amount, with email alerts
at 50% and 100%). The project is on the Blaze free trial ($300 of credit, 90 days from when it was started; see `slice2-results.md`); Cloud Run
should stay within its free tier at studio volumes, but nobody has read the current free-tier figures yet: check Billing, Reports, after the first
live checks, and write the cost of a job into `slice5-results.md`.

## The live checks need `main`

The website's Production Branch is `main`, and sign-in only works on the production address (Preview deployments get addresses Firebase
does not know). So the seven live checks in `slice5-handoff.md` need the slice 5 code merged into `main` and pushed, which starts a production
build. That is the user's call and nothing is merged yet. When they say so: merge `slice-5-blender-assets` into `main` (a fast-forward from
`165ec0a`), run the gate, push `main`, wait for Vercel, and run the checks. With the Blender variables unset, Prepare Model and Make Shape just say
"The Blender service did not answer", and nothing else is affected.

## If the worker's code changes later

Edit the code, then in Cloud Shell: `cd ~/punx-gsp-2026 && git pull && gcloud run deploy blender-worker --source blender-worker --region us-east1 --no-allow-unauthenticated --service-account blender-runner@punx-gsp.iam.gserviceaccount.com --max-instances 2 --concurrency 1 --memory 2Gi --cpu 1 --timeout 120`
(the flags are kept from the earlier deploy, but repeating them is harmless). If a Blender script or the worker's output changes, also bump
`JOB_VERSION` in `web/src/lib/blender/key.ts`. Logs: `gcloud run services logs read blender-worker --region us-east1 --limit 40`. Check it again with:
`node blender-worker/smoke.mjs https://blender-worker-202701573550.us-east1.run.app "$(gcloud auth print-identity-token)"`.

## Picking this up on another computer

What travels in git (branch `slice-5-blender-assets`, plus `main`): all the code, `CLAUDE.md`, the specs, plans and notes (this one included).
What does **not** travel, and what to do about it:

- **`web/.env.local`** (git-ignored): copy `web/.env.example` to `web/.env.local` and fill it from the Firebase console and Vercel (never commit it).
- **Node 24** (and Git): install them; in Git Bash run `export PATH="/c/Program Files/nodejs:$PATH"`, then `cd web && npm install`, then `npm test` (1125 tests).
- **Blender** is only needed to run the Blender script tests locally (`blender -b --factory-startup --python-exit-code 1 -P blender-worker/tests/test_blender.py`);
  the 5.2 LTS release matches the container. Everything else, including the deploy, can be done from Cloud Shell.
- **The execution ledger** (`.superpowers/`, git-ignored) and **Claude's own memory** stay on the old computer. The substance is in
  `slice5-handoff.md` (decisions, rulings, deferred minors); a new session should read `CLAUDE.md`, `slice5-handoff.md` and this note first.
- Git needs your identity and GitHub sign-in on the new computer, as before.
