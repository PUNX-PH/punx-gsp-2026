# Node canvas (slice 3b): design

Date: 2026-10-04. Status: awaiting review. Path: architectural (new subsystem). Parent:
`2026-10-02-studio-platform-v1-design.md`, which this slice amends (see "Changes to earlier specs"). Builds on
`2026-10-03-graph-engine-design.md` (the graph format, the engine, the API) and replaces its plain `/graphs/{id}` page.
Input: `docs/superpowers/notes/slice3-editor-reference.md` (the n8n-style reference and the seven ways to make it
easier to understand).

## Purpose

A signed-in `@punx.ai` person opens a graph and sees it as a canvas: steps as cards, wires between them, a settings
panel for the selected step, and a Play button. They choose files, set the tuning, add or remove steps, wire them
together (a wrong wire is refused in plain words), press Play, see each step's result on its card, and play the game
without leaving the page. Everything the 3a engine and API already do, with an interface that explains itself.

This slice is the canvas only. It adds no server features: it uses the 3a API, the node catalog (`NODE_SPECS`) for names
and help, and the slice 2 game template for the game.

**Done for this slice** (each is a check in "Testing and acceptance"):

1. From the graphs list, a new person makes the starter graph, picks a picture, presses Play, sees the five colors on
   the Palette card, and plays the game, without help.
2. They add a 3D Model step with the "+", wire it to the hero, and play with their own model.
3. A wrong wire, and a wire into an input that already has one, are refused with plain sentences.
4. A failure shows on its own step in plain words (an unplayable tuning on the Game Template card, an oversized
   picture at upload).
5. The game view mode and the theme both survive a reload.
6. Reloading restores the graph, the step positions and the link to the game.
7. The plain page is gone.

## Decisions made with the studio

| Decision | Choice | Why |
|---|---|---|
| Freedom | Free-form with a guided starter: add any step, delete, rewire; typed wires and plain refusals keep it safe | The engine enforces the rules already, and the AI and Blender steps (slices 4 and 5) need free-form editing anyway. |
| Look | Dark dotted canvas with compact cards that show their result, **with the help line visible on each card**, numbers for the running order, and a **light theme as an option** | The studio's pick from three mockups: closest to n8n's feel, but results and plain help are on the cards, not hidden in a panel. |
| Where the game plays | The person chooses: **docked** in the side panel (default), **floating** window, or **full** view; remembered | The studio asked for a flexible layout, not a fixed one. |
| Approach | The graph is the source of truth; React Flow only draws it; every canvas action is a small pure edit of the graph | The rules are plain TypeScript tested without a browser, which matters because the first browser check is on the deployment. |
| Browser checks | On the real deployment, not before | The studio chose not to add a dev-only fake backend or Firebase emulators. Until then the canvas is covered by unit and render tests. |

Choices made in the design, to change if wrong: a wire into an occupied input is refused, not replaced; there is no
undo; the autosave delay is 800 ms; results appear one card at a time 150 ms apart; switching the game view restarts the
game; a graph can have only one Preview, so the add menu greys it once there is one.

## Out of scope for this slice

Undo and redo, copy and paste, multi-select, 3D model previews on cards, editing on touch screens (the game itself still
plays on phones), a minimap, collaboration, new node types, and any server change.

## Architecture

```
Graph list page ──> /graphs/{id}: Editor (client)
                       │ holds: graph (3a Graph JSON), assets, run view, save state, preferences
                       │
   React Flow ◄── toFlow(graph, run view) ──┐          pure functions in web/src/lib/canvas/ and lib/graph/
   (draws, reports drags, clicks, wires)    └── edits ─► graph ──► autosave ──PUT──► /api/graphs/{id}
                                                          Play ─────POST──► /api/graphs/{id}/play ──► run view
   Game frame ◄── previewUrl(runId, template) (the slice 2 templates)
```

### Units

| Unit | Does | Interface | Depends on |
|---|---|---|---|
| Wiring rule | The one rule for "may this wire exist", with plain sentences; used by the server parser and the canvas | `wiringProblem(nodes, existing, edge, specs?) -> string \| null` (`lib/graph/wiring.ts`, factored out of `schema.ts`) | registry |
| Graph edits | Pure edits of a graph | `addNode`, `removeNode`, `addEdge` (refuses via the wiring rule), `removeEdge`, `moveNode`, plus the existing `setAsset`, `setTuning` (`lib/graph/edits.ts`) | wiring rule |
| Step numbers and staleness | The running order of the steps that lead to the Preview, and which results an edit makes out of date | `stepNumbers(graph) -> Map`, `staleAfter(graph, editedIds) -> Set` (uses `ancestors`, `orderNodes` and a new `descendants` in `walk.ts`) | walk |
| Flow mapping | Our graph and run view to React Flow nodes and edges, and React Flow's change events back to edits | `toFlow`, `editsFromChanges` (`lib/canvas/flow.ts`) | edits |
| Run view | What Play said, laid over the graph, and what an edit makes stale | `RunView`, `applyPlay`, `markStale` (`lib/canvas/runView.ts`) | step numbers |
| Autosave | Debounced saving with visible states | `createAutosave({ save, delayMs })`: `idle`, `dirty`, `saving`, `saved`, `error`; `edit()`, `flush()`, `retry()` (`lib/canvas/autosave.ts`) | none |
| Add menu choices | Which steps may be added, and how to wire one in from an open output | `addChoices(graph, from?) -> {type, label, help, disabledReason?}[]` (`lib/canvas/addMenu.ts`) | registry, wiring rule |
| Tuning check | The live "will this be playable" message for the Game Template settings | `tuningProblem(tuning) -> string \| null` (`lib/canvas/tuning.ts`) | `settings.ts` winnability |
| Preferences | Theme and game-view mode (and the floating window's place and size), per browser | `loadPrefs(storage)`, `savePrefs(storage, prefs)`; storage access never throws into the page (`lib/canvas/prefs.ts`) | none |
| Components | The page | `Editor`, `StepCard`, `WireEdge`, `SettingsPanel`, `GamePanel` (docked, floating, full), `AddMenu`, `Toolbar`, icons (`app/graphs/[id]/`) | all of the above, React Flow |

The pure units are tested without a browser. The components stay thin: they hold state, call the units, and render.

## The wire rule

One function decides whether a wire may exist, and both the server parser and the canvas use it, so they refuse in the
same words. Its sentences, written for people:

- Wrong type: "A palette can't go into a picture input." (the plain words are `picture`, `3D model`, `palette`, `game`).
- Occupied input: "Preview's game input already has a wire. Remove it first."
- A wire to a node or port that does not exist, or from an input or into an output: the existing parser sentences. The
  canvas cannot draw these; they are reachable only by hand-editing a saved graph.

Today's `parseGraph` messages for the first two are reworded to these, and its tests are updated with them.

## The cards and wires

- **Look.** A dark canvas with a dotted grid, `colorMode` dark by default and light as an option. Cards are compact.
- **A card** shows, top to bottom: an order number badge (only on steps that lead to the Preview, from `stepNumbers`),
  an icon and the plain name, the one-line help from `NODE_SPECS`, a result area, and a status line. Input handles are on
  the left and output handles on the right. Game Template has four inputs, so each handle carries its plain label
  ("palette", "hero model", "obstacle model", "collectible model") and the optional ones say "optional".
- **Wires** are colored by type (picture amber, 3D model blue, palette violet, game green) and carry a small pill with the
  plain word. A selected or hovered wire shows an × to remove it.
- **Results on a card after Play:** Reference Image its thumbnail (from the asset route) and file name; 3D Model its
  name and size; Palette from Image five swatches (the hex value as a tooltip); Game Template "speed 6 · jump 2.2 ·
  spacing 12"; Preview an "Open game" link that shows the game.
- **States**, each told apart by words and an icon as well as color: *waiting* (nothing yet), *running* (a spinner),
  *done* (a tick), *skipped* (grey, "Skipped because Palette from Image failed."), *failed* (red outline and a warning
  icon, with the plain error sentence on the card), *not used* (greyed, "Not connected to a Preview"), and *needs
  attention* (a problem from an unfinished graph, such as "Choose a picture.", shown on the card).
- **Connecting.** While a wire is dragged, the handles that accept it light up and the rest dim. Dropping on one that
  does not accept it refuses with the wire rule's sentence, shown near the pointer. A wire into an occupied input is
  refused with its sentence; the person removes the old wire first.
- **Order numbers** update as the graph changes, so the order of running is visible before the first Play.

## Editing

- **Adding steps.** A toolbar "+ Add step" opens a list of the node types (plain name and help, from `NODE_SPECS`). A "+"
  on any open output opens the same list filtered by `addChoices` to the steps that accept that wire type, and wires the
  new step into the first free matching input. The Preview is greyed with "A graph has one Preview." once there is one,
  and everything is greyed with "A graph can have at most 50 steps." at the limit. A new step starts with its type's
  default settings (`defaultParams()`) and appears at the pointer, or beside the last step, in a free spot.
- **Deleting and moving.** Select a step or wire and press Delete or Backspace (not while typing in a field), or click
  the ×. Deleting a step removes its wires. There is no confirmation and no undo. Dragging a step moves it; positions are
  saved with the graph.
- **The settings panel** (right, for the selected step):
  - *Reference Image* and *3D Model*: a file picker with the current thumbnail or name and size, a 4 MB check before
    uploading, and the upload's plain-word errors ("photo.png: not a PNG, JPEG or GLB file").
  - *Game Template*: three sliders, "How fast it runs" (1 to 20), "How high it jumps" (1.5 to 5) and "How far apart the
    obstacles are" (4 to 40), each with its value, and a live line under them from `tuningProblem` (the same words
    Play would give, such as "too low to jump an obstacle at ..."). It also says what an unconnected input does
    ("Without a hero model, a built-in shape is used.").
  - *Palette from Image* and *Preview*: a plain explanation, and the five colors once there are some.
- **Guided start.** "New from starter" opens the starter graph. A one-line hint bar sits above the canvas until the first
  successful Play: "1. Choose a picture on the first step. 2. Press Play." An empty graph shows a "Start from the
  starter" button that adds the starter's steps.

## Saving and Play

- **Autosave.** Any edit marks the graph changed; after 800 ms without another edit the whole graph is saved (`PUT`). The
  toolbar shows "Saving…", then "Saved", or "Couldn't save: <reason>" with a Retry. A server refusal keeps what is on
  screen and does not loop. Leaving the page with unsaved changes gets the browser's warning. A graph open in two tabs is
  last-write-wins, as the 3a spec accepts.
- **Choosing a file** uploads first (`POST` to the assets route); then the edit that refers to the returned hash is
  applied and autosaved.
- **Play** waits for any pending save and then plays the saved graph. The cards that will run show a spinner. The reply
  arrives at once, so its results are shown one card at a time, 150 ms apart, in the order they ran (all at once when the
  person prefers reduced motion). A successful run shows the game. A failure or an unfinished graph shows a banner ("2
  problems", click to go to the first) and the sentences on their cards.
- **After an edit** the results of the step it touches and of everything downstream are cleared (`staleAfter`); the rest
  keep theirs. A settings or file change touches its own step; adding or removing a wire touches the step the wire ends
  at; deleting a step touches the steps it fed. While any cleared step leads to the Preview, the game view says "Out of date: press Play."
- **Session and network.** A 401 says "Your session has expired. Sign in again." with a link, and warns that unsaved
  changes will be lost. A network failure offers Retry.

## Game view and theme

- **Game view**, chosen by the person from three small buttons in the game panel's header and remembered per browser:
  - *Docked* (default): a "Game" tab beside "Settings" in the right panel, which collapses. Play switches to the Game tab;
    selecting a step switches back to Settings.
  - *Floating*: a window dragged by its title bar and resized from a corner, kept inside the window, with its place and
    size remembered. Buttons dock it or make it full.
  - *Full*: an overlay over the whole page with "← Back to canvas".
  - One frame component shows the game: an iframe of the same Unity template the Preview page uses (`pickTemplate`, then
    `previewUrl`; the mobile build for a touch screen, the desktop build otherwise). Switching modes restarts the game.
    With no run yet it says "Press Play to see your game here."
- **Theme.** Dark by default, with a light option in the toolbar. It sets React Flow's `colorMode` and the page's own
  color tokens (CSS variables), and is remembered per browser.
- **Desktop only.** The editor is a desktop tool; touch editing is not a goal.

## Security

No new server surface. Everything goes through the 3a routes, which already check the session, the origin on changes, the
size caps and ownership. On the page: file names are shown as text (React escapes them), thumbnails come from the
authenticated asset route, the game frame is same-origin only (the app's frame rules already allow `'self'`), and
`localStorage` holds only preferences (theme, mode, window size), never graph data or identifiers.

## Error handling

Every failure says what and why in plain words and keeps the page usable: the wire sentences, "Choose a picture.", the
engine's node errors on their cards, "Couldn't save: ...", "Your session has expired. Sign in again." An unexpected
failure says "Something went wrong on our side".

## Testing and acceptance

- **Test-first, pure code** (no browser): the wire rule (every refusal and acceptance, and that `parseGraph` gives the
  same sentences); the edits (`addNode` picks an unused id, `removeNode` removes its wires, `addEdge` refuses through the
  rule); step numbers and `staleAfter`, including a graph with no Preview; the flow mapping both ways; `applyPlay` and
  `markStale`; the autosave states (debounce, flush before Play, retry, a refusal that does not loop); `addChoices`
  (filtering by wire type, the Preview greyed); `tuningProblem` against the slice 2 fixtures; preferences, including when
  storage throws or holds junk.
- **Render tests** with React's server renderer (no new test dependencies): each card state (help text visible, swatches,
  thumbnail, error sentence, not used, needs attention), the settings panel per node type, the add menu.
- **Deployed checks, in a real browser** (after the slice 2 and 3a deployments are up): the seven done-criteria above;
  dragging, zooming, fitting, dropping a wire on a wrong handle, the "+" on an open output, deleting with the keyboard,
  the three game views and both themes, a reload; a laptop-sized window, since three regions share the screen.
- **Local checks until then:** `npm test`, `npm run lint`, `npm run build`. Dragging and zooming are not exercised before
  the deployment.

## Risks

1. **Browser-only behavior** (dragging, handles, resize, the floating window) is first seen on the deployment. The
   interaction code is kept thin, and everything with a rule in it is a pure unit.
2. **React Flow with React 19 and Next 16:** the package's peer range is `react >= 17` (checked 2026-10-04, version 12.12);
   a first task renders a trivial flow in a production build before the rest is built on it.
3. **Bundle size** (React Flow is about 1 MB unpacked): it loads only on the graph page.
4. **Three regions in one window** (canvas, side panel, floating game) on a small laptop screen; the panel collapses and
   the game view can be full. Checked on the deployment.
5. **Restarting the game on a mode switch** loses its state. Accepted for a preview.

## Repository layout

```
web/src/lib/graph/wiring.ts        the wire rule (new); schema.ts uses it; edits.ts gains addNode, removeNode, addEdge,
                                   removeEdge, moveNode; walk.ts gains descendants
web/src/lib/canvas/                flow.ts, runView.ts, autosave.ts, addMenu.ts, tuning.ts, prefs.ts, stepNumbers.ts
web/src/app/graphs/[id]/           page.tsx, Editor.tsx, StepCard.tsx, WireEdge.tsx, SettingsPanel.tsx, GamePanel.tsx,
                                   AddMenu.tsx, Toolbar.tsx, icons.tsx, editor.module.css   (GraphPlain.tsx is removed)
web/src/app/graphs/page.tsx        the list, restyled to match
web/package.json                   adds @xyflow/react
```

## Changes to earlier specs

`2026-10-03-graph-engine-design.md`: its plain page is replaced by this canvas; the wiring sentences for a wrong-type wire
and an occupied input are reworded (one rule, shared); `walk.ts` gains `descendants`; the JSON box and
`applyToWorkingCopy` are removed with the plain page. `2026-10-02-studio-platform-v1-design.md`: slice 3b is this spec.
