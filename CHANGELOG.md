# Changelog

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
