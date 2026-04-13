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

### TODO — Next Session
1. **Restart Claude Code** (Cmd+Q) — required to load new MCP server
2. **Test all 5 tools** (after restart):
   - `cursor_health` — verify installation + auth status
   - `cursor_models` — list available models (check if Composer 2 appears)
   - `cursor_agent` with `model: "auto"` — basic test: "What is 2+2?"
   - `cursor_agent` with `model: "composer-2"` — Composer 2 specific test
   - `cursor_reply` with session_id from step above — session continuation
   - `cursor_sessions` — list sessions
3. **Test parallel execution** — 3 Agent subprocesses, each with different model
4. **Code review** — run triple review (GPT + Gemini + Grok) on cursor-mcp/src/
5. **Fix any issues** found in testing or review
6. **Publish to npm**: `cd ~/MCP-Servers/cursor-mcp && npm publish`
7. **Test npx install**: verify `npx @qmediat.io/cursor-mcp` works
8. **Update qmediat.io/open-source page** — add cursor-mcp card

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
