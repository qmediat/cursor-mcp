# Changelog

## [Unreleased]

## [1.2.0] - 2026-10-01

From the 2026-10-01 comparison with Cursor's own CLI, SDK and Cloud Agents API (`docs/COMPETITION-2026-10-01.md`).

### Changed

- **The truth about headless edits.** Cursor's headless docs: without `--force`, changes are only proposed, not
  applied. The README, the tool description and SECURITY.md say so; the `agent` mode row no longer promises "file edit"
  by default. `CURSOR_SANDBOX=enabled|disabled` (operator environment) passes `--sandbox <mode>` so an auto-approved
  agent can be confined; any other value is refused by name at the first call.
- **Streaming.** Both agent tools run `--output-format stream-json`. Every event is parsed as it arrives
  (`src/stream.ts`): the terminal `result` is the run's result as before; a client that sent a progress token gets one
  `notifications/progress` per event (the model at start, each completed tool call with its target, each assistant
  message). A non-JSON line is kept as noise, never dropped silently.
- **A structured result.** `cursor_agent` and `cursor_reply` publish an `outputSchema` and return
  `structuredContent`: `result`, `status`, `is_error`, `session_id`, `request_id`, `model` (what cursor-agent reported at
  start), `duration_ms`, `tool_calls`, `files_changed` (write/edit/delete targets, each once) and `stderr`; the text keeps
  the answer first, then a metadata line and the files changed (`src/run-report.ts`, shared by both tools).
- The `cloud` parameter is gone: it passed `-c`, which Cursor's parameter reference does not list and whose interactive
  meaning (the composer picker) cannot run headless. A caller still sending it is not an error; the flag is simply not
  passed. Cloud agents are a separate API (see the comparison).

### Tests

- `test/stream.test.mjs`: a fake cursor-agent emits the documented stream-json events; the report, the files changed,
  the progress notifications and the parser's handling of a non-JSON line and of a result without a trailing newline.

## [1.1.0] - 2026-10-01

An audit of the npm page (2026-10-01, every claim checked against the code and against Cursor's documentation) found the
server unusable with current Cursor models and several promises the code did not keep. Fixed:

### Fixed

- `model` is any id cursor-agent accepts (passed through to `--model`), no longer a closed list of ids from April 2026 that
  rejected every current model (Composer 2.5, Claude Opus 5.5, Grok 4.7 …) before the CLI saw it. `auto` still lets Cursor
  choose. A client's cancellation now reaches the child process: the SDK's request signal cancels the call, so a
  disconnected or cancelled request kills cursor-agent instead of leaving it running on a semaphore slot. cursor-agent
  runs in its own process group (POSIX) and the cancellation signals the group, so a helper it spawned stops too and
  cannot keep editing after the request was reported aborted; a signal already aborted when the call starts is honoured
  the same way. After SIGTERM a child still alive 5 s later is sent SIGKILL (the behaviour SECURITY.md described). `cursor_reply` applies the same
  `CURSOR_ALLOW_YOLO=true` → `--force` gate as `cursor_agent`, so an auto-approved session keeps applying its edits on
  follow-ups (before, a reply only proposed them). `CURSOR_MAX_CONCURRENCY` must be a positive integer; anything else is the
  default 3 (a negative value made every call queue forever). The prompt follows a `--` separator and `session_id` is
  validated to one word: before, a `session_id` of `-f` was read by cursor-agent as `--force` (`--resume` takes an
  optional value) and bypassed the `CURSOR_ALLOW_YOLO` gate, and a prompt starting with `-` was an unknown option.
  A cancelled request settles only once the child itself has exited (not once its pipes close: a helper still holding
  them cannot keep the request alive), so its concurrency slot is never reused while the old process still runs
  (`CURSOR_KILL_GRACE_MS`, default 5000); the SIGKILL deadline holds whatever the leader did, so a helper that ignores
  SIGTERM dies with it. A leader that exits while a helper holds the pipes no longer hangs the call: after the same grace
  the group is signalled and the call settles with what was read. The server's own SIGINT/SIGTERM/SIGHUP sends SIGTERM to
  every running group, SIGKILL after the grace, then ends; an exit it cannot delay sends SIGKILL — no agent outlives the
  server (cursor-agent runs detached, so the terminal's signals do not reach it on their own). A group counts as live
  while any member answers a probe — checked when its pipes close and before every shutdown signal, never inferred
  from the leader's exit or from the pipes alone (a helper may redirect its stdio) — and the SIGKILL deadline of a
  cancellation is withdrawn only when a probe finds no member left (nothing to kill, and a reused group id is never
  signalled; the group is probed again at the deadline). A group a finished call left behind is forgotten as soon as a
  probe finds it empty (at every spawn and every shutdown signal); the shutdown ends as soon as nothing is live, never a
  full grace for nobody. On Windows there is no process group: only cursor-agent itself is signalled. A second signal
  during the shutdown grace ends the server at once, SIGKILL first. The concurrency slot counts cursor-agent processes:
  it is released when the leader exits, and a helper the leader left behind has until the deadline. The handlers are installed by the `cursor-mcp` entry point,
  not by importing the executor. A child killed by something other than the request (an operator, the OOM
  killer) is an error, not an empty success. `cursor_models` and `cursor_health` are cancellable too, and a request
  cancelled while it waits for a concurrency slot leaves the queue at once instead of running later for nobody.
  `workspace` is validated like `session_id`: a value that reads as an option is refused. `CURSOR_KILL_GRACE_MS` above
  2147483647 (a timer cannot wait longer; Node fired it after 1 ms) and `CURSOR_MAX_CONCURRENCY` above 64 are the
  defaults, both read once at start-up. When the CLI's `models` command fails, the fallback list says why. `cursor_models` strips the CLI's ANSI codes and its
  "Loading models…" progress line and treats
  "No models available for this account" as an empty list; the fallback text names no prices (they are on
  cursor.com/docs/models-and-pricing) and says how to list ids.

### Changed

- README, SECURITY.md, the tool descriptions, `package.json` and `server.json` say what the code does: model families
  instead of retired ids and prices, `agent login` (with `cursor-agent` as the alias the server resolves), the `cursor-mcp`
  command and a `claude mcp add` one-liner, every call runs with `--trust` on the given workspace, the `cloud` flag is
  experimental, "plan" is read-only planning, no "Business" plan, one response-time statement, absolute links.
- Tests: `test/args.test.mjs` pins the argv of both tools (the `--` separator, the session-id contract), the open model
  contract, the concurrency parser and the models cleaner on the CLI's real bytes; `test/cancel.test.mjs` runs a fake
  `cursor-agent` that ignores SIGTERM and proves the cancellation reaches it, SIGKILL follows, and the slot is held
  until then, that a signal aborted before the call still ends the child, and that a helper holding the pipes neither
  survives the cancellation nor keeps the request alive, that a leader exiting under a pipe-holding helper still settles
  and the helper is killed, that a SIGTERM-ignoring helper is SIGKILLed at the deadline, and that the server's SIGTERM ends
  every running group; the smoke test asserts the model schema has no enum. Published JavaScript changes in this release.
- `package.json` names the repository as `git+https://…` — the form npm publishes, so a publish prints no auto-correction.

## [1.0.3] - 2026-09-29

### Changed

- Runtime dependencies: `@modelcontextprotocol/sdk` 1.30.1 (was 1.30.0) and `zod` 4.6.5 (was 4.3.6).
- Releases are staged on npm instead of published directly: the release workflow runs `npm stage publish`
  (Trusted Publishing, provenance), and a version becomes public only when a maintainer approves it on
  npmjs.com with two-factor authentication; the workflow pins npm 11.20.0 for it (staged publishing needs 11.15.0+).
- The README opens with the Quantum Media Technologies wordmark and closes with a "Made by" line, both linking to www.qmediat.io/open-source; `package.json` `homepage` points there (`author` already carried the company line).
- Development: the project builds with TypeScript 7 (the native compiler). The published JavaScript is byte-identical
  to 1.0.2; the type declarations describe the same types (only the order of union members and properties and the
  quote style differ) and the source maps are regenerated. The TypeScript 7 npm package ships only `tsc` — no
  `tsserver` and no JavaScript API — so an editor set to use the workspace TypeScript version cannot load it from
  `node_modules`; use the editor's bundled one.
- The release workflow asks npm once whether the version is already public and stops on any answer other than yes
  or no (a registry error used to read as "not public"); a new GitHub Release is a draft until the version is public,
  and a published one is never withdrawn on npm's answer (the run warns); the npm it runs is pinned by version and by
  the sha512 of its tarball; a failed stage is named in the run summary.

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
