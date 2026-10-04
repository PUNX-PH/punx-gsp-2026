# Slice 3a results: graph engine, on the deployment (2026-10-04)

The engine (graph format, checks, runner, uploads, API) runs on **https://punx-gsp.vercel.app**, deployed from
`slice-3b-node-canvas` (commit `d324083`; the 3a commits are in its history, and there is no separate 3a branch on the remote).
Slice 2's deployment story, and what went wrong getting it up, are in `slice2-results.md`. "Me" and "the user" mean the same as there.

## The seven done-criteria

| # | Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | Signed out, every graph page and API call is refused | Me, `curl`: `/graphs` and `/graphs/{id}` answer 307 to sign-in; GET, POST, PUT, DELETE on `/api/graphs`, the upload, the file read and Play all answer 401 | Passed |
| 2 | Starter graph, a picture, Play, a game with that picture's colors, on a desktop and on a phone | The user made the starter graph, chose a picture, pressed Play, and the game showed in the panel. This is the first time `sharp` ran on Vercel | Desktop passed. The phone check the user reported was on a run's Preview; whether it was reached from a graph's Play was not recorded |
| 3 | The same with their own GLB wired to the hero | The user added a 3D Model step, chose `hero.glb`, wired it, played (reported passed) | Passed |
| 4 | Bad input refused in plain words that name the node | The user tried a wrong wire, a second wire into an input that has one, a non-image file, and an unplayable tuning (reported passed) | Partly. **A missing input and an oversized picture were not tried live** (unit-tested) |
| 5 | One person cannot read, run or delete another's graph or files | The service tests (someone else's graph, file, run) all pass. The user reported the second-account check passed; **whether a second account was actually used was not recorded** | Tests passed; live check reported |
| 6 | Pressing Play twice leaves one run for the graph | The user pressed Play twice and the runs list showed one run (reported passed) | Passed |
| 7 | No secret in the repository | Me: scan of every commit, none (see `slice2-results.md`) | Passed |

## What the deployment proved

- **`sharp` loads in a Vercel function** and decodes a real picture (the fallback to pure-JavaScript decoders in the spec was not needed).
- **The Firebase adapters work for real** (Firestore records, Cloud Storage files): no adapter bug was found, and no change was needed.
  They are now exercised by every upload and Play.
- **Palette quality** was judged by the user only as far as "the game showed in the panel"; no verdict on the colors was recorded.

## Not run on the deployment

- A missing input and an oversized picture refused live.
- The two extras suggested in the 3a handoff: a portrait phone photo (EXIF rotation: the reported width and height may be swapped) and a
  file name with an emoji (Firestore may refuse a name cut in half). Both are still deferred minors in `slice3a-handoff.md`.
- The other deferred minors of the 3a final review (`slice3a-handoff.md`, "Known risks and deferred items"). None blocks anything.

## Still true

- Two simultaneous Plays of one graph can leave an extra run behind; a graph open in two tabs is last write wins. Both are accepted in
  the spec.
- Caching is deferred until the first slow node (slice 4 or 5).
