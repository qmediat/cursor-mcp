# Changelog

## [1.0.1] - 2026-04-13

### Fixed

- **cursor_sessions**: replaced broken `cursor-agent ls` CLI call (Ink TUI crash in non-interactive mode) with in-memory session store
- Session store tracks sessions created via `cursor_agent` and `cursor_reply`, scoped to MCP server instance lifetime

### Added

- LRU eviction: session store capped at 200 entries to prevent unbounded memory growth
- Unicode-safe prompt truncation: surrogate pair / emoji protection in session previews
- Whitespace normalization: multiline prompts collapsed to single line in session list
- Reply session fallback: `cursor_reply` falls back to `args.session_id` when CLI omits it from response
- Improved `formatAge`: uses `Math.floor` (not `Math.round`), supports day display (>24h), guards against future dates

### Review process

- 5-way code review: Claude Opus 4.6 (self) + GPT-5.3-Codex + Gemini 3.1 Pro + Grok 4.20 + GitHub Copilot
- 11 findings analyzed with 6-step deep analysis methodology
- 5 confirmed true positives fixed, 5 false positives documented, 1 false positive (zod/v4 import)

## [1.0.0] - 2026-04-13

### Added

- Initial release
- 5 MCP tools: `cursor_agent`, `cursor_reply`, `cursor_models`, `cursor_sessions`, `cursor_health`
- Multi-model support: Composer 2, Claude, GPT, Gemini, Grok, Kimi K2.5
- Agent modes: agent (full), plan (design), ask (read-only)
- Cloud agent support (`-c` flag)
- Session management (resume conversations)
- Health check (installation, auth, config verification)
- Concurrency limiter (semaphore, default max 3, configurable via `CURSOR_MAX_CONCURRENCY`)
- AbortSignal support (MCP client disconnect + hard timeout)
- Auto-approve mode gated by `CURSOR_ALLOW_YOLO` env var (never LLM-controllable)
- Zero-dependency security (spawn, not exec; no shell interpolation)
