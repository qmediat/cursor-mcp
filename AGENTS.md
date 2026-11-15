# AGENTS.md

## Work on the code

| Task | Command |
|---|---|
| Install | `npm install` |
| Build | `npm run build` |
| Check before a commit | `npm run lint && npm run typecheck && npm test` |
| Format | `npm run format` |
| README "Supports", `server.json` and `package-lock.json` against the package version | `npm run check:supports` |
| Every email address in a tracked file in `qmediat.io` | `npm run check:addresses` |
| Run the local build | `node dist/index.js` |

Developing needs Node.js 22.18+ or 24.11+ (the lint toolchain); running needs 22+.

## Where things are

| Path | What |
|---|---|
| `src/` | The server and its five tools (`src/tools/`) |
| `test/` | `node:test` suites; `test/support/fake-agent.mjs` is the fake `cursor-agent` |
| `scripts/check-supports.mjs` | The version check: README "Supports", `server.json`, `package-lock.json` |
| `scripts/check-addresses.mjs` | The address check: every email address in `qmediat.io` or on its allowed list |
| `docs/SYSTEMIC.md` | Conventions every change keeps, the exemplars |
| `CONTRIBUTING.md` | Setup, architecture, code style, pull requests |

## Rules

| When | Rule |
|---|---|
| The child process | Started without a shell (`spawn` with an argument array; the prompt after `--`) |
| Auto-approve | Only from the operator's environment (`CURSOR_ALLOW_YOLO=true`), never a tool parameter |
| Cancel or timeout | Ends the child and its process group (SIGTERM, then SIGKILL after `CURSOR_KILL_GRACE_MS`) |
| A user-visible change | One `CHANGELOG.md` entry under `[Unreleased]` |
| Addresses | The addresses this repository publishes for the project are in `qmediat.io` (`contact@`, `security@`, `dev@`); the qmediat team's commits are authored as `dev@qmediat.io`, a contributor's with their own address; no personal or account address in any file (`npm run check:addresses` enforces it) |
| A release | README "Supports", `server.json` and `package-lock.json` name the new version; the release check fails when one differs |
