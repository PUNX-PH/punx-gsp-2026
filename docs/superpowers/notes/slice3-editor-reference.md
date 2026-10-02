# Slice 3 editor: reference and design intent (input, not decisions)

Date: 2026-10-02. Source: a screenshot of an n8n-style workflow canvas that the user supplied as the model for the
node editor, with the request "similar to that, but easier to understand for users". "Node" here means a box on a
visual canvas (as in n8n), not Node.js. The editor is built with React Flow (see the v1 spec). This note is read
when slice 3 is brainstormed; nothing here is built in slice 2.

## What the reference does well (keep the feel)

- A dark canvas with a dotted grid; rounded-square nodes with a clear icon and a name under each.
- Wires with a dot at each connection point; a wire shows how many items passed through it after a run.
- Run state on the node itself: a green tick on nodes that ran, a red outline and warning triangle on the one that
  failed, a greyed "Deactivated" node.
- Nodes with several outputs label them on the node (Success / Error, done / loop).
- A "+" at an open output to add the next step; a prominent **Test workflow** button at the bottom; zoom and fit
  controls at the bottom left.

## What to make easier for this product's users (proposed)

1. **Plain names and one-line help.** "Reference Image: the picture the colors come from", not technical subtitles
   such as `getAll: label`.
2. **Typed wires in plain words.** Wires coloured by what they carry (picture, 3D model, colors, text, game
   settings); a mismatched connection is refused with a sentence saying why.
3. **Show results, not counts.** Instead of "55 items", a thumbnail, a row of colour chips, or a model preview on the
   node after a run.
4. **Errors in plain words on the node,** with what to do next ("hero.glb: larger than 4 MB. Choose a smaller
   file."), never a code line like `[line 8]`.
5. **Fewer concepts.** No loops, branches or code nodes; a node's settings sit in a side panel with sensible
   defaults.
6. **A guided start.** A ready-made starter graph, empty-state hints, and one obvious **Play** button that runs the
   graph and opens the preview.
7. **Always say what is happening.** Waiting, running, done, skipped (because an earlier step failed) and failed
   look different, and the order of running is visible.

## Open questions for the slice 3 brainstorm

- How much of the n8n look to keep versus a lighter, friendlier style (the `frontend-design` skill applies).
- Whether the preview opens beside the canvas or in a separate view.
- Which nodes appear in a starter graph.
