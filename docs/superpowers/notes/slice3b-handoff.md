# Slice 3b handoff: node canvas (written 2026-10-04)

Read this after `slice3a-handoff.md`. It says where slice 3b stands, what only the user can do, and how to continue. The
authorities are the spec `docs/superpowers/specs/2026-10-04-node-canvas-design.md` and the plan
`docs/superpowers/plans/2026-10-04-slice3b-node-canvas.md` (16 tasks, executed inline, as the user chose).

## What this slice is

The node canvas that replaces the plain `/graphs/{id}` page. A signed-in `@punx.ai` person sees their graph as steps on a
dark dotted canvas (compact cards with the help line, a result and a status on each, the running order as numbers), wires
typed by color and refused in plain words, a settings panel, autosave, a Play button, and a game view they choose: docked
beside the canvas, in a floating window, or full screen. A light theme is an option. It uses the 3a API unchanged: no
server changes.

## Where it stands

- Branch `slice-3b-node-canvas`, cut from `slice-3a-graph-engine` at `8283fbb`. **Local only: nothing is pushed** (ask
  before pushing; the repo is public, so scan for secrets and personal paths first). Merge order would be slice 1,
  slice 2, 3a, then this.
- **Plan tasks 1 to 15 are complete** in the ledger (`.superpowers/sdd/2026-10-04-slice3b-node-canvas/progress.md`,
  git-ignored). Task 16 (deployed acceptance and wrap-up) has not started and needs the user's setup.
- **Tests:** web 638 passing (`cd web && npm test`), lint, typecheck and `npm run build` clean. The gate is test, lint,
  build.
- **The final whole-branch review is done** (a fresh opus reviewer, aimed at `Editor.tsx` and its React Flow use): no
  Critical findings; eight Important, all fixed (selection switching, results of a removed step coming back on a reused
  id, edits made during Play, unsaved-edit warnings, the connection highlight, step spacing, "Open game", keyboard
  focus), plus four findings re-graded from Minor to Important and fixed (the docked game cut off, a wrong kind of file,
  two contrast failures). The rest are deferred minors, below. After Task 16 a short second look at anything that changes
  is enough; do not repeat the whole review.

## What was built (where to look)

```
web/src/lib/graph/      wiring.ts (the one wire rule, shared with the server parser), edits.ts (canvas edits), walk.ts (+ descendants)
web/src/lib/canvas/     stepNumbers, runView, editorState (the reducer), autosave, prefs, tuning, addMenu, cardView,
                        flow (graph <-> React Flow), files, client (save/upload/play calls)
web/src/app/graphs/[id]/  Editor.tsx (the integration), StepCard(View), WireEdge, SettingsPanel, AddMenu, Toolbar, GamePanel,
                        icons, prefsStore, editor.module.css (all the styling, with the theme tokens); page.tsx renders Editor
web/src/app/graphs/     page.tsx (the list), NewGraphButton, ThemedShell
```

The design rule: our `Graph` JSON is the single source of truth, held in the reducer; React Flow only draws it; every canvas
action is a small pure edit, so the rules are tested without a browser.

## Decisions and rulings worth keeping

- **Free-form with a guided starter; dark with a light option; the person chooses where the game plays** (docked by
  default, remembered per browser). A wire into an occupied input is refused, not replaced; there is no undo.
- **One wire rule** (`wiringProblem`) is used by the server's graph parser and by the canvas, so a wire is refused in the
  same words everywhere. The parser's wrong-type and occupied-input sentences were reworded to match.
- **An edit marks stale only what it touches and what is downstream** (`staleAfter`); a removed step's results, problems
  and upload error are forgotten at once, so a new step that reuses its id starts clean; edits made while Play is running
  are marked stale when its results arrive.
- **React Flow in a controlled flow hides a node until its measured size is passed back.** `Editor` keeps a map of the
  sizes React Flow reports and merges it into the nodes it passes in. New steps get the lowest unused id and a spot at
  least 260 x 280 px from any other step (a card is 232 px wide and up to about 260 px tall).
- **Autosave** waits 800 ms, saves the newest graph, never loops on a failure, and is flushed before Play and when the
  editor unmounts. The editor's three server calls and what each status means are in `lib/canvas/client.ts`.
- **Preferences** (`gsp.prefs`) live in localStorage and in memory (`prefsStore.ts`), so the theme and game view still
  change when storage is blocked.
- The wire colors differ per theme from the plan's single hex values (same hues and roles), for contrast; the light
  accent is `#cf3a22` so white text on it passes, and the empty-game message has its own light color because the game area
  is always black. `tokens.test.ts` holds the theme tokens to 4.5:1 contrast.

## Checked in a real browser, and not

The user chose to wait for the deployment for browser checks, so the canvas was built on pure and render tests. As an
extra, three throwaway local looks (a temporary unauthenticated page with the starter graph, removed before every
commit; no bypass code is in the repo) showed working: the cards, labelled ports, wire pills and numbers; selecting a
card; the "+" on an open output (filtered menu, adds a wired step); deleting a step; the tuning sliders and live
playability line; the theme toggle; all three game views and their persistence; hide and show the side panel; Play and
autosave failing cleanly with no session; and, with the page's `fetch` stubbed, a successful Play (the docked game fits
its panel; "Open game" shows the Game tab), the Add menu's focus and Escape, and a wrong kind of file being refused.
**Not seen working** (the in-app browser pane was hidden, so React Flow could not measure nodes and wires were not
drawn): clicking a wire then a step (selection switching), the highlight of accepting handles while dragging a wire,
the refusal message when a wire is dropped on a wrong handle, the card focus outline, dragging and resizing the floating
window, zoom and fit, keyboard Delete, a real upload, a real Play with the game running, and the staggered reveal.

## Blocked on the user

Everything in Task 16 waits for the Vercel and Firebase setup (see `slice2-handoff.md`: the Vercel project, the Firebase
confirmations, the environment variables, and the password pre-registration decision), and for slice 2's and 3a's own
deployed checks to pass first.

## Next steps once unblocked, in order

1. Slice 2's and 3a's deployed checks (their plans' last tasks).
2. Plan Task 16, Step 2: the seven done-criteria of the spec in a real browser.
3. Plan Task 16, Step 3, the browser-only checks, **plus** the ones the review added: switch the selection between a step
   and a wire; "Open game" on a Preview that is not selected; the Back button within 800 ms of an edit (it must save);
   the handles lighting up while a wire is dragged; tabbing onto a card (the focus outline); a picture chosen on a 3D
   Model step; a file name with `<script>`, 300 characters and right-to-left marks; a laptop-sized window with the
   side panel open.
4. Write `docs/superpowers/notes/slice3b-results.md`, update `CLAUDE.md` and this note, then finish the branches with the
   user per `finishing-a-development-branch`. Then decide the next slice: the AI step (Prompt and Describe Game) is
   slice 4; the Blender step is slice 5.

## How to work here

Same as slices 2 and 3a (`slice2-handoff.md`, `slice3a-handoff.md`): Node in Git Bash needs
`export PATH="/c/Program Files/nodejs:$PATH"`, run web commands from `web/`, work test-first, ask before any push or
install. A long heredoc containing quotes can break the Git Bash tool; use the editor tools for files with apostrophes.
A temporary page under `web/src/app/` is a quick way to see the editor in the browser pane; delete it, and `.next`,
before committing (a stale `.next/types` makes `tsc` complain). The browser pane often runs hidden, which stops rendering
frames: React Flow nodes then stay `visibility: hidden`, so judge the canvas only when `document.hidden` is false.

## Deferred minors from the final review

None blocks anything; the ledger has the details.

1. A selected wire turns grey (React Flow's own `.selected` rule outranks ours).
2. The upload error line repeats the raw file name: a very long one does not wrap and right-to-left marks are not
   isolated; no RTL test.
3. Reveal timers are not cleared when a new Play starts; the same toast twice does not restart its timer.
4. `connectOnClick` is on, so a stray click on a handle starts a click-to-connect that skips the refusal message.
5. "Back to canvas" always docks the game; the floating window writes localStorage on every pointer move; the in-memory
   preference value hides changes made in another tab.
6. The "not used" card's text (62% opacity) is about 3.3:1.
7. After a reload the Preview card has no "Open game" (the Game tab still shows the game).
8. The Add menu and the toast are not kept inside the window; the measured-size map is never pruned.
9. Every edit replaces the whole graph, so an upload finishing during a drag can drop the drag's last move.
10. Look deviations from the spec: the wire × shows on a selected wire only (not on hover); "Add step" places the step
    near the middle of the canvas; no `color-scheme` for the chosen theme.
11. Play after a retryable save error refuses instead of retrying the save.
12. Accessibility details: the order-number `aria-label`; the tablist contains the Hide button; Delete and Backspace
    delete the selected step while the Add menu is open.
