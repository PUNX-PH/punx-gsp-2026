# Game Studio Platform

A studio website where a creator turns a prompt plus reference images and assets into a hypercasual
game by wiring steps together on a node canvas. Blender prepares the assets; Unity runs the game.

## Scope: hypercasual, kept simple

- Hypercasual only for now: one core mechanic, one-touch controls, sessions of about a minute, small
  builds, simple low-poly or flat art.
- Build the smallest thing that works. No extra genres, systems or abstractions until asked
  (`karpathy-guidelines`).
- Keep process proportional: a new feature goes brainstorm, then plan, then build. A small fix skips that.

## Status

The Unity runner template (Slice 1, `unity/runner-template`) is built and runs as a WebGL player. The web side is **deployed and checked**
at https://punx-gsp.vercel.app (Vercel, root directory `web`, Production Branch `slice-3b-node-canvas`): slice 2 (web foundation:
Next.js, `@punx.ai`-only sign-in by Google or an emailed link, Firestore, Cloud Storage), slice 3a (the graph engine) and slice 3b (the
node canvas). The branch `slice-3b-node-canvas` is pushed and carries all three; `main` is still the setup commit. Results are in
`docs/superpowers/notes/slice2-results.md`, `slice3a-results.md` and `slice3b-results.md`; decisions live in the design specs
(`docs/superpowers/specs/`). Nothing else is built: the AI step (Prompt and Describe Game) is slice 4 and the Blender step is slice 5.

## Skills (in `.claude/skills/`; origins in `.claude/skills-sources/SOURCES.md`)

| Situation | Use |
|---|---|
| New feature or idea, "how should this work" | `brainstorming`, then `writing-plans` |
| Building from a written plan | `executing-plans` (`subagent-driven-development` for large plans) |
| Writing logic: graph engine, job runner, file converters | `test-driven-development` |
| Something fails: a Blender or Unity batch run, graph execution | `systematic-debugging` |
| Before saying a task is done | `verification-before-completion` |
| Node editor and web UI | `frontend-design`, `vercel-react-best-practices`, `vercel-composition-patterns` |
| Unity C# and game-loop code | `game-developer` |
| Library docs: React Flow (`/websites/reactflow_dev`), Blender Python API (`/websites/blender_api_current`), Unity manual (`/websites/unity3d_manual`), and others | `context7-mcp` (the Context7 server in `.mcp.json`) |
| Uploads, auth, prompts, job execution | `owasp-security` |

## Security stance

User uploads (images, FBX, GLB, .blend files) and prompts are untrusted input. Never run scripts that
come from an uploaded file, and keep Blender and Unity workers sandboxed with no access to secrets.

## Work in progress

Nothing is being built. What is open (none of it blocks the next slice): the password pre-registration decision (the Email/Password
provider is still enabled next to Google), the merge, pull request or keep choice for the branches (order: slice 1, 2, 3a, 3b), the
checks listed as not run in the three results notes, and slice 1's player-hardening gate before any use beyond punx.ai. Start slice 4 or 5
only when the user asks. Read `docs/superpowers/notes/slice2-results.md` first (it also has what went wrong deploying to Vercel and
how it was fixed), then `slice3a-results.md`, `slice3b-results.md` and the handoffs (`slice2-handoff.md`, `slice3a-handoff.md`,
`slice3b-handoff.md`, `2026-10-02-slice1-handoff.md`) before doing anything else.
