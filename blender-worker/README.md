# blender-worker

The private Cloud Run service that runs Blender for Prepare Model and Make Shape (slice 5). One request is one job, and every job
runs a fresh headless `blender -b` in a throwaway folder. The web app's other end is `web/src/lib/blender/client.ts`; the rules around
it (cache, limits, the clock) are in `web/src/lib/blender/service.ts`. The design is
`docs/superpowers/specs/2026-10-05-blender-assets-design.md`.

```
server.mjs            the HTTP wrapper (Node built-ins only): validates, runs Blender, answers with a GLB or a code
scripts/prepare.py    Blender: import a GLB, FBX or OBJ, join, triangulate, decimate, flatten colors, export a GLB
scripts/shape.py      Blender: build one of seven low-poly shapes, export a GLB
tests/test_blender.py the Blender scripts' tests (run inside Blender)
server.test.mjs       the wrapper's tests (run with a fake Blender)
fixtures/             the fake Blender, a cube and an empty OBJ, and serve-fake.mjs
smoke.mjs             a quick end-to-end check of a running worker
Dockerfile            Node 24 + Blender 5.2 LTS (pinned, checksum-verified)
```

## The API

| Call | Body | Answer |
|---|---|---|
| `GET /healthz` | none | 200, `ok` (no Blender run) |
| `POST /prepare?format=glb\|fbx\|obj&triangles=100..5000&color=original\|#rrggbb` | the model file, up to 32 MiB | 200 and the GLB, with `X-Triangles-Before` and `X-Triangles-After` |
| `POST /shape` | `{"shape": "cube\|sphere\|cone\|cylinder\|pyramid\|coin\|ring", "color": "#rrggbb"}` | 200 and the GLB, with `X-Triangles-After` |

Every failure is a status and `{"error": "<code>"}` and nothing else: `bad-request` 400 (also 404 and 405), `too-big` 413, `bad-format` 415,
`empty` 422, `failed` 500, `timeout` 504. A job is killed at 60 seconds. Blender runs with an environment that holds no secret, as an
unprivileged user, and its output is never logged or returned.

## Run the tests

The wrapper (needs only Node 24, no Blender):

```bash
npm --prefix blender-worker test
```

The Blender scripts (needs Blender 5.2 on this machine; `blender` below is wherever it is installed):

```bash
blender -b --factory-startup --python-exit-code 1 -P blender-worker/tests/test_blender.py
```

Try the wrapper with the fake Blender, and the smoke script against it:

```bash
node blender-worker/fixtures/serve-fake.mjs 8080
node blender-worker/smoke.mjs http://127.0.0.1:8080
```

## Build and try the image

With Docker (the `scripts/` folder must exist: it is copied in):

```bash
docker build -t blender-worker blender-worker
docker run --rm -p 8080:8080 blender-worker
node blender-worker/smoke.mjs http://localhost:8080
```

Without Docker, Google Cloud Build can build it from source as part of the deploy below.

## Deploy to Cloud Run (once, by the studio)

Use the project that holds Firebase and the same region as its Cloud Storage bucket. Enable Cloud Run, Cloud Build and Artifact
Registry first. `REGION` and `PROJECT` are yours:

```bash
gcloud run deploy blender-worker --source blender-worker --region REGION --no-allow-unauthenticated \
  --max-instances 2 --concurrency 1 --memory 2Gi --cpu 1 --timeout 120
```

Private (`--no-allow-unauthenticated`): only an account with the invoker role can call it. Make that account, give it only that role, and
make a key for the web app:

```bash
gcloud iam service-accounts create blender-invoker --display-name "Blender worker invoker"
gcloud run services add-iam-policy-binding blender-worker --region REGION \
  --member "serviceAccount:blender-invoker@PROJECT.iam.gserviceaccount.com" --role roles/run.invoker
gcloud iam service-accounts keys create blender-invoker-key.json --iam-account blender-invoker@PROJECT.iam.gserviceaccount.com
```

In Vercel (Production, then redeploy) add `BLENDER_WORKER_URL` (the service's URL) and `BLENDER_WORKER_KEY` (the key file's content on one
line, marked Sensitive: `node -e "console.log(JSON.stringify(require('./blender-invoker-key.json')))"`). Delete the key file afterwards.
Set a budget alert on the project. Then check it end to end:

```bash
node blender-worker/smoke.mjs https://blender-worker-xxxx.a.run.app "$(gcloud auth print-identity-token)"
```

## Changing Blender

Edit the three `ARG`s in the Dockerfile (the checksum is on `download.blender.org/release/Blender<series>/`), run
`tests/test_blender.py` with that Blender, and bump `JOB_VERSION` in `web/src/lib/blender/key.ts` so earlier results are not reused.

## The web app's fixtures

`web/src/lib/blender/fixtures/*.glb` are real output of these scripts (a prepared cube and a ring); `blenderOutput.test.ts` checks that
the app accepts them. After changing a script, regenerate them (Blender 5.2, from the repository root):

```bash
blender -b --factory-startup --python-exit-code 1 -P blender-worker/scripts/prepare.py -- --in blender-worker/fixtures/cube.obj \
  --format obj --triangles 2000 --color "#ff6f59" --out web/src/lib/blender/fixtures/prepared-cube.glb --stats stats.json
blender -b --factory-startup --python-exit-code 1 -P blender-worker/scripts/shape.py -- --shape ring --color "#06d6a0" \
  --out web/src/lib/blender/fixtures/ring.glb --stats stats.json
```
