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

The Unity runner template (Slice 1, `unity/runner-template`) is built and runs as a WebGL player. The web side
is being designed: slice 2 (web foundation: Next.js on Vercel, `@punx.ai`-only Firebase sign-in, Firestore and
Cloud Storage) is being built (inline, from the plan): `docs/superpowers/specs/2026-10-02-web-foundation-design.md`,
`docs/superpowers/plans/2026-10-02-slice2-web-foundation.md`. Tasks 1, 3, 4, 5, 7 and 8 are done and the code for 2, 6 and 9 is written; what is left needs the user (Vercel project, Firebase project, the deployed checks). Nothing
else is built. Slice 3 (the node editor) is split into 3a, the graph engine (spec written, awaiting review:
`docs/superpowers/specs/2026-10-03-graph-engine-design.md`), and 3b, the canvas (not yet designed). Decisions live in the
design specs (`docs/superpowers/specs/`).

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

Slice 1 (the Unity runner template) is finished except the phone check; slice 2 (the web app) is built and reviewed but blocked on the user's Vercel and Firebase setup. Read `docs/superpowers/notes/slice2-handoff.md` first, then
`docs/superpowers/notes/2026-10-02-slice1-handoff.md` before doing anything else.
