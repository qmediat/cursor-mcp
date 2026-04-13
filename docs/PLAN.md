# cursor-mcp Implementation Plan

## Context

Open-source MCP server wrapping Cursor CLI (`cursor-agent`) to expose Cursor's AI models through Model Context Protocol. Second public package from `@qmediat.io` after `ideogram-mcp`.

## Architecture Decisions

Informed by triple-agent consultation (GPT-5.3-Codex, Gemini-3.1-Pro, Grok-4):

| Decision | Choice | Source | Rationale |
|----------|--------|--------|-----------|
| Process spawning | `child_process.spawn` | All 3 agents | No shell injection, stream-safe, AbortSignal support |
| Concurrency | Semaphore (max 3) | GPT-5.3 | cursor-agent has known issues with >3 concurrent local processes |
| Timeout + cancellation | `AbortSignal.any()` | Gemini-3.1 | Combines MCP client disconnect + hard timeout (Node 20+) |
| `--force` flag | Env var gate only | Gemini-3.1 | Never LLM-controllable — operator-only opt-in |
| Health check tool | Added | Grok-4 | Verifies installation, auth, config before use |
| Output format | Batch JSON (`--output-format json`) | My decision | MCP tools return single responses; streaming adds complexity without MCP support |
| Error handling | Classified types | GPT-5.3 | CLI, timeout, not-found, abort — each mapped to MCP error response |

## Files NOT to Publish (npm)

Controlled via `package.json` `files` whitelist — only these go to npm:
- `dist/` — compiled JavaScript
- `README.md` — documentation
- `LICENSE` — MIT
- `CHANGELOG.md` — version history
- `SECURITY.md` — security policy

Everything else is excluded: `src/`, `docs/`, `node_modules/`, `.git/`, `.env`, `.claude/`, `.mcpregistry_*`, `tsconfig.json`, `server.json`, `CONTRIBUTING.md`.

## Files NOT to Commit (git)

Controlled via `.gitignore`:
- `node_modules/`
- `dist/`
- `*.env`, `.env.*`
- `.DS_Store`
- `.claude/`
- `.mcpregistry_*`

## Tool Summary

| # | Tool | CLI Command | Purpose |
|---|------|-------------|---------|
| 1 | `cursor_agent` | `cursor-agent -p --output-format json --trust [--model M] [--mode M] [--workspace W] [-c] PROMPT` | Main agent |
| 2 | `cursor_reply` | `cursor-agent -p --output-format json --trust --resume SESSION_ID PROMPT` | Continue session |
| 3 | `cursor_models` | `cursor-agent models` (fallback: static list) | List models |
| 4 | `cursor_sessions` | In-memory session store (replaced broken `cursor-agent ls` Ink TUI) | List sessions |
| 5 | `cursor_health` | `cursor-agent --version` + `cursor-agent status` | Health check |

## Cursor Plan Comparison

| Plan | Price | API Credits | Rate Limits | Best For |
|------|-------|-------------|-------------|----------|
| Pro | $20/mo | $20/mo | 1 req/min, 30 req/h | Individual, light use |
| Pro Plus | $60/mo | $70/mo | 3x Pro | Heavy CLI usage |
| Ultra | $200/mo | $400/mo | 20x Pro | Power users |
| Business | $40/user/mo | $20+/user | Same as Pro | Teams (SSO, admin) |

All plans include the same models. Upgrade does not break anything.

## Setup Steps

1. Install cursor-agent: `curl https://cursor.com/install -fsS | bash`
2. Authenticate: `cursor-agent login` (opens browser, Cursor Pro required)
3. Install MCP server: `npm install -g @qmediat.io/cursor-mcp`
4. Configure in `~/.claude.json`
5. Restart Claude Code
