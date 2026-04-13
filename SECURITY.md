# Security Policy

## Architecture

`@qmediat.io/cursor-mcp` wraps the Cursor CLI (`cursor-agent`) binary via `child_process.spawn`. It does **not** make direct HTTP requests, store credentials, or access external APIs.

## Security Design

### Process Isolation

- Each tool call spawns a separate `cursor-agent` process with `stdio: ["ignore", "pipe", "pipe"]`
- No shell interpolation — arguments are passed as an array to `spawn`, preventing injection attacks
- Processes are killed on timeout (SIGTERM, then SIGKILL after grace period) or client disconnect

### Concurrency Control

- A semaphore limits concurrent `cursor-agent` processes (default: 3, configurable via `CURSOR_MAX_CONCURRENCY`)
- Prevents resource exhaustion and API rate limit errors

### Auto-Approve Mode (`--force`)

The `--force` flag makes cursor-agent auto-approve **all** tool calls (file writes, terminal commands, etc.) without human confirmation.

- **Never exposed as a tool parameter** — LLMs cannot request this
- **Gated behind `CURSOR_ALLOW_YOLO=true` env var** — only the server operator can enable it
- **Default: disabled** — cursor-agent runs in safe mode

### Authentication

- This server does **not** handle authentication
- cursor-agent manages its own OAuth credentials (stored by the Cursor application)
- Run `cursor-agent login` to authenticate before using this server

### Minimal Dependencies

- Runtime: `@modelcontextprotocol/sdk` + `zod` only
- No HTTP client libraries, no filesystem access beyond spawning the CLI
- No secrets stored or transmitted by this server

## Reporting Vulnerabilities

Report security issues to: **security@qmediat.io**

Please include:
- Description of the vulnerability
- Steps to reproduce
- Expected vs actual behavior

We will respond within 48 hours and aim to release a fix within 7 days for critical issues.
