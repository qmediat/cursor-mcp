# AGENTS.md

## Work on the code

| Task | Command |
|---|---|
| Install | `npm install` |
| Build | `npm run build` |
| Check before a commit | `npm run lint && npm run typecheck && npm test` |
| Format | `npm run format` |
| README "Supports" against the package version | `npm run check:supports` |
| Run the local build | `node dist/index.js` |

Developing needs Node.js 22.18+ or 24.11+ (the lint toolchain); running needs 22+.

## Where things are

| Path | What |
|---|---|
| `src/` | The server and its five tools (`src/tools/`) |
| `test/` | `node:test` suites; `test/support/fake-agent.mjs` is the fake `cursor-agent` |
| `scripts/check-supports.mjs` | The README "Supports" version check |
| `docs/SYSTEMIC.md` | Conventions every change keeps, the exemplars |
| `CONTRIBUTING.md` | Setup, architecture, code style, pull requests |

## Rules

| When | Rule |
|---|---|
| The child process | Started without a shell (`spawn` with an argument array; the prompt after `--`) |
| Auto-approve | Only from the operator's environment (`CURSOR_ALLOW_YOLO=true`), never a tool parameter |
| Cancel or timeout | Ends the child and its process group (SIGTERM, then SIGKILL after `CURSOR_KILL_GRACE_MS`) |
| A user-visible change | One `CHANGELOG.md` entry under `[Unreleased]` |
| A release | README "Supports" updated to the new version; the release check fails when its version differs |
