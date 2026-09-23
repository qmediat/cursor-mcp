# Changelog

## [Unreleased]

### Changed

- The README opens with the Quantum Media Technologies wordmark and closes with a "Made by" line, both linking to www.qmediat.io/open-source; `package.json` `homepage` points there (`author` already carried the company line).

## [1.0.2] - 2026-09-23

### Security

- Lockfile refresh closes all 39 open Dependabot advisories (9 high; all transitive dependencies of the MCP SDK):
  `hono` 4.13.8, `fast-uri` 3.1.8, `qs` 6.16.0, `body-parser` 2.3.0, `ip-address` 10.7.2 → `npm audit` reports
  0 vulnerabilities. `@modelcontextprotocol/sdk` is pinned to 1.30.0, the version this release was tested with;
  `zod` stays at 4.3.6. The advisories sit under the SDK's caret ranges, so a project that already has this package
  in its lockfile keeps its old tree until it runs `npm update` (or `npm audit fix`); a fresh install gets the
  refreshed tree.
- First CI (`.github/workflows/ci.yml`): typecheck, build, smoke test and `npm audit --omit=dev --audit-level=high`
  on Node 22 and 24 with a read-only token.
- First release workflow (`.github/workflows/release.yml`): a `v<version>` tag equal to `package.json` and
  `server.json` → the same gates → `npm publish --provenance` → GitHub Release from this file's section.
- Dependabot configuration (weekly grouped npm updates, GitHub Actions updates); Dependabot security updates and
  GitHub private vulnerability reporting are enabled on the repository; `SECURITY.md` points to the private
  reporting form first and documents the supply chain.

### Fixed

- The server advertised `version: 1.0.0` in `serverInfo` regardless of the package version; it now reads the
  version from `package.json`, and the smoke test asserts the two agree.
- `server.json` (MCP registry manifest) still said 1.0.0; both fields follow the package version.

### Added

- `npm test` (builds first): a stdio smoke test on Node's built-in runner — the built server completes the MCP
  handshake, advertises the package version, lists its five tools, and never exposes the auto-approve flag as a tool
  parameter. Every request has a 10 s deadline and is rejected if the server exits. No new dependency.

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
