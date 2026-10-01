# Security Policy

## Architecture

`@qmediat.io/cursor-mcp` wraps the Cursor CLI (`cursor-agent`) binary via `child_process.spawn`. It does **not** make direct HTTP requests, store credentials, or access external APIs.

## Security Design

### Process Isolation

- Each tool call spawns a separate `cursor-agent` process with `stdio: ["ignore", "pipe", "pipe"]`
- No shell interpolation — arguments are passed as an array to `spawn`; the prompt follows a `--` separator and `session_id` is validated to one word, so a value such as `-f` is never read as `cursor-agent`'s `--force`
- Processes are killed on timeout or when the MCP client cancels the request: SIGTERM to cursor-agent's process group (so a helper it spawned stops too; POSIX — on Windows only cursor-agent itself is signalled), then SIGKILL after `CURSOR_KILL_GRACE_MS` (5 s) if the child is still alive; the request settles and its concurrency slot is freed only once the child itself has exited; the SIGKILL deadline holds for the whole group whatever the leader did; the server's own SIGINT/SIGTERM/SIGHUP ends every running group the same way (SIGTERM, SIGKILL after the grace) and an exit it cannot delay sends SIGKILL
- Every call runs `cursor-agent --trust` on the given `workspace` (the server's cwd by default): the directory is trusted without a prompt, so the operator decides which workspaces the server may be pointed at

### Concurrency Control

- A semaphore limits concurrent `cursor-agent` processes (default: 3, configurable via `CURSOR_MAX_CONCURRENCY`)
- Prevents resource exhaustion and API rate limit errors

### Auto-Approve Mode (`--force`)

The `--force` flag makes cursor-agent auto-approve **all** tool calls (file writes, terminal commands, etc.) without human confirmation.

- **Never exposed as a tool parameter** — LLMs cannot request this
- **Gated behind `CURSOR_ALLOW_YOLO=true` env var** — only the server operator can enable it; it applies to `cursor_agent` and `cursor_reply` alike
- **Default: disabled** — cursor-agent runs in safe mode: in headless mode it then only PROPOSES file changes in its answer and applies none ([cursor.com/docs/cli/headless](https://cursor.com/docs/cli/headless))
- **`CURSOR_SANDBOX=enabled`** passes `--sandbox enabled`, Cursor's confinement of what an auto-approved agent may run; `disabled` turns it off; unset leaves the CLI's default

### Authentication

- This server does **not** handle authentication
- cursor-agent manages its own OAuth credentials (stored by the Cursor application)
- Run `agent login` (or the legacy `cursor-agent login`) to authenticate before using this server

### Minimal Dependencies

- Runtime: `@modelcontextprotocol/sdk` + `zod` only
- No HTTP client libraries, no filesystem access beyond spawning the CLI
- No secrets stored or transmitted by this server

## Reporting Vulnerabilities

Report security issues privately:

- **Preferred:** GitHub's [Report a vulnerability](https://github.com/qmediat/cursor-mcp/security/advisories/new) form (Security tab → Advisories) — it reaches the maintainers privately and tracks the fix and the disclosure.
- **Email:** security@qmediat.io

Do not open public GitHub issues for security reports. Please include a description of the vulnerability, steps to reproduce, and expected versus actual behaviour. We aim to acknowledge receipt within 48 hours and to publish a fix within 7 days for high-severity issues.

## Supply Chain

- Two runtime dependencies (`@modelcontextprotocol/sdk`, `zod`), pinned exactly.
- Dependabot security updates are enabled; CI and the release workflow refuse a build with a known high-severity advisory in the shipped dependency tree (`npm audit --omit=dev --audit-level=high`).
- Releases are staged on npm from GitHub Actions with provenance attestations (`npm stage publish --provenance`) and become public only after a maintainer approves them with two-factor authentication; the npm page of every version links the workflow run that built it.

