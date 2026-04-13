# cursor-mcp — Session Resume Instructions

> Read this file when resuming work on cursor-mcp in a new Claude Code session.

## Current State (2026-04-13)

### DONE
- [x] Code complete: 5 tools, TypeScript strict, 0 build errors
- [x] Repo: https://github.com/qmediat/cursor-mcp (public, MIT)
- [x] Pushed to GitHub (initial commit on main)
- [x] cursor-agent authenticated: `service@qmt-mail.com` (Cursor Pro)
- [x] Configured in `~/.claude.json` as `cursor-cli`
- [x] Backup: `~/.claude.json.backup-cursor-20260413`
- [x] docs/SERVERS.md updated (server #21)
- [x] docs/CHANGELOG.md updated
- [x] CLAUDE.md updated (21 servers)
- [x] Memory saved: `project_cursor_mcp.md`

### DONE — Session 2 (2026-04-13)
1. [x] Restart Claude Code (Cmd+Q) — new MCP server loaded
2. [x] Test all 5 tools:
   - `cursor_health` — PASS (v2026.04.08, auth OK)
   - `cursor_models` — PASS (80+ models)
   - `cursor_agent` auto — PASS (4, correct)
   - `cursor_agent` composer-2 — PASS (21, correct)
   - `cursor_reply` — PASS (31, remembers context)
   - `cursor_sessions` — FAIL (Ink TUI crash, `Raw mode not supported`)
3. [x] Fix: replaced `cursor-agent ls` with in-memory SessionStore
4. [x] 5-way code review (GPT-5.3-Codex + Gemini-3.1-Pro + Grok-4.20 + Copilot + self)
5. [x] 6-step deep analysis on all 11 findings (5 TP fixed, 5 FP, 1 FP zod)
6. [x] Fixes: LRU eviction (cap 200), emoji protection, whitespace normalization, reply fallback, formatAge

### TODO — Next Session
1. **Restart Claude Code** (Cmd+Q) — required to load rebuilt MCP server
2. **Retest cursor_sessions** — verify fix (empty list → create session → list → reply → list)
3. **Test parallel execution** — 3 Agent subprocesses, each with different model
4. **Publish to npm**: `cd ~/MCP-Servers/cursor-mcp && npm publish`
5. **Test npx install**: verify `npx @qmediat.io/cursor-mcp` works
6. **Update qmediat.io/open-source page** — add cursor-mcp card

### Architecture Reference
- Pattern: ideogram-mcp (TypeScript, MCP SDK + Zod, stdio)
- Executor: `child_process.spawn` + Semaphore (max 3) + `AbortSignal.any()`
- Security: `--force` gated by `CURSOR_ALLOW_YOLO` env var
- Key files:
  - `src/executor.ts` — spawn wrapper with concurrency + abort
  - `src/server.ts` — MCP server with 5 tools
  - `src/tools/cursor-agent.ts` — main agent tool
  - `docs/PLAN.md` — full implementation plan + agent consultation results

### Quick Commands
```bash
# Build
cd ~/MCP-Servers/cursor-mcp && npm run build

# Test locally
node dist/index.js

# Check cursor-agent auth
cursor-agent status

# Publish to npm (after testing)
npm publish

# Config location
jq '.mcpServers["cursor-cli"]' ~/.claude.json
```

### Key Decisions
- Composer 2 available via `--model composer-2` (confirmed by research, needs live test)
- Batch JSON output (not NDJSON streaming) — MCP tools return single responses
- Concurrency default: 3 (cursor-agent has issues with >3 concurrent local processes)
- Node.js 22+ required (AbortSignal.any())
