# Skill sources

Where every skill in `.claude/skills/` came from. All were chosen from the user's
`claude-skills.xlsx` sheet and copied unmodified (byte-for-byte, LF line endings) on 2026-10-01.
To update one, re-copy it from the repo at a newer commit and bump the SHA here.

| Skill folder(s) in `.claude/skills/` | Sheet entry | Source repo | Path in repo | Commit | License |
|---|---|---|---|---|---|
| `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `using-git-worktrees`, `finishing-a-development-branch`, `using-superpowers` | Superpowers | https://github.com/obra/superpowers (v6.4.2) | `skills/<name>` | `8ca22dba9a94` | MIT (`licenses/superpowers-LICENSE`) |
| `karpathy-guidelines` | Karpathy coding rules | https://github.com/multica-ai/andrej-karpathy-skills | `skills/karpathy-guidelines` | `2c606141936f` | MIT (declared in the skill's frontmatter; the repo has no LICENSE file) |
| `frontend-design` | Frontend Design | https://github.com/anthropics/skills | `skills/frontend-design` | `8a1541c4a3ff` | See `frontend-design/LICENSE.txt` |
| `vercel-react-best-practices`, `vercel-composition-patterns` | Vercel Agent Skills | https://github.com/vercel-labs/agent-skills | `skills/react-best-practices`, `skills/composition-patterns` | `063bee94c3f4` | MIT (declared in each skill's frontmatter; the repo has no root LICENSE file) |
| `game-developer` | Jeffallan Claude Skills | https://github.com/Jeffallan/claude-skills | `skills/game-developer` | `882ef55e377d` | MIT (`licenses/jeffallan-claude-skills-LICENSE`) |
| `context7-mcp` | Context7 | https://github.com/upstash/context7 | `skills/context7-mcp` | `83e972e8b0fa` | MIT (`licenses/context7-LICENSE`) |
| `owasp-security` | owasp-security | https://github.com/agamm/claude-code-owasp | `.claude/skills/owasp-security` | `8ac7965caa21` | See `licenses/claude-code-owasp-LICENSE` |

Two folders are renamed so the folder name matches the `name:` in the skill's frontmatter:
`react-best-practices` -> `vercel-react-best-practices`, `composition-patterns` -> `vercel-composition-patterns`.

Superpowers is copied as plain project skills, so its plugin-only SessionStart hook and its `writing-skills`
and `diagnosing-superpowers` skills were left out. Its optional visual companion (`brainstorming/scripts/`)
needs Node.js, which this machine does not have yet.

## Not a skill: the Context7 MCP server

`/.mcp.json` points Claude Code at Context7's hosted server (`https://mcp.context7.com/mcp`). It needs no
local Node.js. On first use, run `/mcp`, pick `context7` and sign in through the browser. Queries (library
name plus the question) go to Context7's servers.

## Considered from the sheet and deliberately not installed

| Skipped | Why |
|---|---|
| Taste Skill | Its own header scopes it to landing pages and portfolios, "not dashboards ... not multi-step product UI", and the main file is 88 KB. Revisit for the public marketing site. |
| Vercel `web-design-guidelines` | Fetches its rules from GitHub at runtime and follows them as instructions; rules can change without review. |
| wshobson `unity-developer` agent | Centred on ECS/DOTS, multiplayer, HDRP and VR, and pins `model: opus`. Over-built for hypercasual. |
| Jeffallan `csharp-developer` / .NET Skills | ASP.NET Core and Blazor, not Unity C#. |
| Spec Kit, OpenSpec, BMAD, GSD, Task Master, Planning with Files, Matt Pocock, Addy Osmani | Overlap with Superpowers; one planning workflow is enough. |
| Playwright / Chrome DevTools / Agent Browser, webapp-testing | Need Node or Python, which this machine lacks; Claude's built-in browser pane covers UI testing. |
| Supabase, Cloudflare, Hugging Face, n8n, Remotion, Expo | Wait until the backend / hosting / AI-provider decisions are made. |
