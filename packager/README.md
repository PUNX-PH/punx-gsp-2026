# The packager

A private Cloud Run service. It gives a person an installable copy of their game: a Windows zip, or a signed Android APK. It runs no Unity and compiles
nothing: the owner builds a **Windows player** and an **Android player** once (the same player the website runs, built for those platforms), and this
adds one game's files (`settings.json` and the entity models) to a copy of the right one. The player reads them from its `StreamingAssets/game/` folder.

```
POST /package?platform=windows|android    body {"files": [{"name": "settings.json", "data": "<base64>"}, ...]}
GET  /health
```

Windows: the zip of the player with the files under the player's `gamePath` (for example `Runner_Data/StreamingAssets/game/`). Android: the same under
`assets/game/` inside the APK, the old signature (`META-INF/`) removed, and a new one made by `apksigner` with the studio's key. A good answer is 200 with
the file; a failure is a status and `{"code": ...}`: 400 bad request, 413 too big, 422 bad files, 503 not set up (no player, or no key), 500 failed.
Nothing a tool said is sent or logged. The body is checked again here (names, sizes, GLB headers, settings.json as JSON).

## What the studio provides

1. **Build the players** with Unity (Windows and Android build support installed): `unity/runner-template/Assets/Runner/Editor/BuildPlayers.cs` (Task 28).
   For Windows, zip the build folder (`Runner.exe`, `Runner_Data/`, ...). For Android, build an APK (not an app bundle). Never put a keystore in the repo.
2. **A bucket with the players** and a `players.json` beside them:
   ```json
   { "windows": { "file": "windows.zip", "gamePath": "Runner_Data/StreamingAssets/game/" },
     "android": { "file": "android.apk", "gamePath": "assets/game/" } }
   ```
   `gamePath` must end in `/`. Mount the bucket at `/players`.
3. **An Android keystore** (made with `keytool`, kept by the studio): store the file and its password in Secret Manager; mount the file at
   `/secrets/studio.keystore` and expose the password as `KEYSTORE_PASS`. Set `KEYSTORE_PATH=/secrets/studio.keystore`. Without them Android says "not set up".
4. **Deploy** from Cloud Shell, private like the Blender worker (the website's invoker account calls it):
   ```
   gcloud run deploy packager --source packager --region us-east1 --no-allow-unauthenticated --service-account <invoker-runner account> \
     --memory 1Gi --max-instances 2 --concurrency 4 --timeout 120 \
     --add-volume name=players,type=cloud-storage,bucket=<players bucket> --add-volume-mount volume=players,mount-path=/players \
     --set-secrets /secrets/studio.keystore=<keystore secret>:latest,KEYSTORE_PASS=<password secret>:latest --set-env-vars KEYSTORE_PATH=/secrets/studio.keystore
   ```
   Then give the website `PACKAGER_URL` and `PACKAGER_KEY` (the same way as `BLENDER_WORKER_URL` and `BLENDER_WORKER_KEY`, see `blender-worker/README.md`).

Uploading to a store, and Google Play's signing, are the studio's. Distributing Unity's player with other people's games is covered by Unity's terms for the
Runtime; read them before sharing builds outside the studio.

## Tests

`npm --prefix packager test` (Node's own runner, no install): the zip editor on zips written the way other tools write them, and the service with a fake
`apksigner`. The real `apksigner`, a real player and a phone are only checked live.
