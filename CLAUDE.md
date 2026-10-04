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
at https://punx-gsp.vercel.app (Vercel, root directory `web`, Production Branch `main`): slice 2 (web foundation:
Next.js, `@punx.ai`-only sign-in by Google or an emailed link, Firestore, Cloud Storage), slice 3a (the graph engine) and slice 3b (the
node canvas). All of it is merged into `main` (a fast-forward on 2026-10-04; the older slice branches on GitHub are redundant). Results are in
`docs/superpowers/notes/slice2-results.md`, `slice3a-results.md` and `slice3b-results.md`; decisions live in the design specs
(`docs/superpowers/specs/`). **Slice 4 (the Describe Game AI step: a prompt and a picture become a palette and the three tuning
numbers, through Claude Sonnet 5.5 inside Play) is built and tested on branch `slice-4-describe-game`, not pushed or merged, and not
yet run against the real API:** it needs the studio's Anthropic key first (`slice4-handoff.md`). The Blender step is slice 5 and is not built.

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

Slice 4's code is done; what is left is the studio's setup (an Anthropic account and key with a monthly spend limit, the data-terms
decision, `ANTHROPIC_API_KEY` as a Sensitive Production variable in Vercel), then the live checks and `slice4-results.md`, then a
merge to `main` when the user asks. Ask before any push: pushing `main` starts a production build. Also open (none of it blocks
slice 5): the password pre-registration decision (the Email/Password provider is still enabled next to Google), the checks listed
as not run in the results notes, and slice 1's player-hardening gate before any use beyond punx.ai. Start slice 5 only when the user
asks. Read `docs/superpowers/notes/slice4-handoff.md` first, then `slice2-results.md` (it also has what went wrong deploying to
Vercel and how it was fixed), `slice3a-results.md`, `slice3b-results.md` and the handoffs (`slice2-handoff.md`, `slice3a-handoff.md`,
`slice3b-handoff.md`, `2026-10-02-slice1-handoff.md`) before doing anything else.
