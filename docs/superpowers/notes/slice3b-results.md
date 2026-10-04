# Slice 3b results: node canvas, on the deployment (2026-10-04)

The canvas runs on **https://punx-gsp.vercel.app** (`slice-3b-node-canvas`, commit `d324083`). See `slice2-results.md` for the
deployment and for what "me" and "the user" mean. The twelve deferred review minors were fixed before the deployment checks
(`slice3b-handoff.md`).

## The seven done-criteria

| # | Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | From the graphs list, a new person makes the starter graph, picks a picture, presses Play, sees the five colors on the Palette card, and plays the game, without help | The user did it and the game showed in the panel | Passed |
| 2 | They add a 3D Model step with the "+", wire it to the hero, and play with their own model | The user did it with `hero.glb` (reported passed) | Passed |
| 3 | A wrong wire, and a wire into an input that already has one, are refused with plain sentences | The user tried both (reported passed) | Passed |
| 4 | A failure shows on its own step in plain words (an unplayable tuning on the Game Template card, an oversized picture at upload) | The user tried an unplayable tuning and a non-image file (reported passed). **An oversized picture was not tried live** (the 4 MB check is unit-tested) | Partly |
| 5 | The game view mode and the theme both survive a reload | The user switched both and reloaded (reported passed) | Passed |
| 6 | Reloading restores the graph, the step positions and the link to the game | The user reloaded (reported passed) | Passed |
| 7 | The plain page is gone | Me: `GraphPlain.tsx` is not in the repository, and `web/src/app/graphs/[id]/page.tsx` renders the editor | Passed |

## Not individually reported

These were in the 3b handoff's list of browser-only checks and were not on the list the user was given, so none is recorded as passed:
switching the selection between a step and a wire; "Open game" on a Preview that is not selected; the Back button within 800 ms of an
edit (it must save); the handles lighting up while a wire is dragged; tabbing onto a card (the focus outline); a picture chosen on a
3D Model step (it must be refused, in plain words); a file name with `<script>`, 300 characters and right-to-left marks; a laptop-sized
window with the side panel open; dragging and resizing the floating game window, zoom and fit, and the staggered reveal of results.
Try them when convenient and add what is found here.

## Seen working on the deployment

The canvas itself (cards, wires, the "+", the settings panel, autosave, Play, the game docked beside it) with a real picture, real
Firebase and a real Play. The 12 minors fixed on 2026-10-04 were seen working in a browser before deployment only in part (the
handoff lists which).

## Still true

- There is no undo, and a wire into an occupied input is refused, not replaced (decided in the spec).
- "Add step" places a new step near the middle of the visible canvas, on purpose.
- The wire × shows when the wire is selected, its label is hovered, or the focus is in it (not when only the curve is hovered).
