# Competitive landscape — 2026-10-01

What other tools offer that `@qmediat.io/cursor-mcp` 1.1.0 does not, with the provider's own surfaces first. Read
from the linked pages on 2026-10-01; "unverified" marks what could not be opened. The local `cursor-agent` could not be
probed live (2026.04.17, not logged in), so CLI behaviour is taken from Cursor's docs.

## The provider: Cursor (Anysphere)

Cursor ships no MCP server that exposes its agent (unverified negative; the only first-party MCP found is "Cursor
Cloud MCP", a diagnostics server inside cloud runs). It ships three programmatic surfaces:

- **Cursor CLI** (`agent` / `cursor-agent`, <https://cursor.com/docs/cli/reference/parameters>): `-p/--print` with
  `--output-format text|json|stream-json`, `--stream-partial-output`, `--resume [chatId]`, `--continue`, `--model`,
  `--mode plan|ask`, `--list-models`, `-f/--force` (`--yolo`), `--sandbox enabled|disabled`, `--approve-mcps`,
  `--trust`, `--workspace`, `--plugin-dir`, `-w/--worktree [name]`, `--worktree-base`, `--api-key`. Headless docs
  (<https://cursor.com/docs/cli/headless>): **"Without `--force`, changes are only proposed, not applied"**; files are
  given by path in the prompt; stream-json events `system`, `assistant`, `tool_call` (started/completed), `result`.
  Cloud handoff: a prompt prefixed with `&` (interactive). `-c` is not in the parameter reference.
- **ACP server** (`agent acp`, <https://cursor.com/docs/cli/acp>): JSON-RPC over stdio with streaming
  `session/update`, `session/request_permission`, `session/cancel`, `session/load`. In the JetBrains ACP registry since
  2026-03.
- **`@cursor/sdk`** (<https://cursor.com/docs/sdk/typescript>, 1.0.35 on 2026-10-01, 2,478,900 npm downloads / 30
  days): one interface for local and cloud runtimes — `run.stream()`, `cancel()`, `steer()`, `getUsage()` (tokens +
  cost), artifacts, inline MCP servers, subagents, custom tools.
- **Cloud Agents API v1** (<https://cursor.com/docs/cloud-agent/api/endpoints>): create / follow-up / cancel / SSE
  stream / usage / artifacts, `autoCreatePR`, images (15 MB each), up to 20 repositories, `mcpServers`,
  `customSubagents`, Basic or Bearer auth with user or service-account keys. Webhooks "coming soon" (v0 only).

## Community

| Package | Version / activity | npm 30-day | Positioning |
|---|---|---|---|
| @qmediat.io/cursor-mcp (this) | 1.1.0, 2026-10-01 | 262 | 5 tools, local CLI, hardened |
| cursor-agent-sync-mcp (yuriisamohvalov-creator) | 0.2.0, 2026-09-23 | 313 | one tool, `--force` always on, returns `git diff --stat` |
| cli-agent-mcp (Bytars, Go) | pushed 2026-09-28, not on npm | — | multi-CLI, streaming progress, background tasks, diffs, cost cap, Windows Job Objects |
| cursor-agent-mcp (sailay1996) | pushed 2025-08-16, private | — | 7 verb tools, `force` as a tool parameter |
| cursor-cloud-agents-mcp (TygartMedia), cursor-cloud-agent-mcp (alex-zykov, jxnl), @willpowell8/…, cursor-agent-mcp (griffinwork40) | 2025-11 … 2026-09 | 47–90 | Cloud Agents API wrappers (v0 or v1), 0–8 stars |
| Analogues: tuannvm/codex-mcp-server (4,036 / 30 d), jamubc/gemini-mcp-tool (10,747), steipete/claude-code-mcp (archived) | — | — | `structuredContent` + `outputSchema`, reasoning-effort and sandbox parameters |

## Feature matrix

| Feature | This package | Raw CLI / SDK / Cloud API | Best community |
|---|---|---|---|
| Any model id + model listing | yes | yes | partial |
| Modes agent / plan / ask | yes | yes | plan tool |
| File edits in the default call | **no** — without `CURSOR_ALLOW_YOLO` the agent only proposes; the README said "full capabilities" | `--force`, `--sandbox enabled` | Sync (always `--force`) |
| Streaming / MCP progress notifications | **no** | `stream-json`, SSE, ACP | cli-agent-mcp |
| Files changed / diff in the result | **no** | `tool_call` events | Sync, cli-agent-mcp |
| Structured result (model used, request_id, status, `outputSchema`) | **no** (text) | yes | codex-mcp-server |
| Git worktree isolation per run | **no** | `-w`, `--worktree-base` | cli-agent-mcp |
| Sandbox control | no | `--sandbox` | unverified |
| Cloud agents (launch, follow-up, PR, usage, artifacts) | **no** — the `cloud` flag passed `-c`, which opens an interactive picker | Cloud API v1, SDK | small v0/v1 wrappers |
| Usage / cost | **no** | SDK `getUsage()`, API `/usage` | TygartMedia |
| Sessions after a server restart | **no** (in memory) | `agent ls`, `--resume` | partial |
| `--force` only from the operator's environment, never a model parameter | **yes** (only this package) | — | sailay exposes it; Sync forces it |
| argv injection hardening (`--`, session-id and workspace validation) | **yes** | — | unverified |
| Concurrency semaphore held until the child exited | **yes** | — | unverified |
| Cancellation reaches the process group, SIGKILL escalation, no orphans at shutdown | **yes** (POSIX) | ACP / API cancel | cli-agent-mcp (Job Objects on Windows) |
| Health / auth check | yes | `status --format json` | whoami |

## Gaps, ranked

1. The default call cannot write files — say so, and offer an operator-only sandboxed path (`--sandbox enabled` with
   `--force`).
2. Streaming: `stream-json` → MCP `notifications/progress`; no client timeouts on ten-minute runs.
3. Files changed / diff in the result (from `tool_call` events or `git diff --stat` before and after).
4. `structuredContent` + `outputSchema`: session id, duration, request id, the model actually used, files changed.
5. Worktree isolation (`--worktree`, `--worktree-base`) for parallel runs.
6. Replace the `cloud` flag with a real path (Cloud Agents API v1 or `@cursor/sdk`), or remove it.
7. Usage / cost (SDK, API) and `status --format json` in health.
8. Sessions that survive a restart (`agent ls`, or the store on disk).
9. Background jobs (start / watch / cancel) for tasks longer than a client's tool timeout.
10. Smaller: `--approve-mcps`, `--add-dir`, mid-run steering (SDK), Windows process-tree kill.

Strategic note: ACP and `@cursor/sdk` are the official programmatic surfaces, with streaming, permission requests and
cancellation built in; a future major version could run on ACP instead of `-p` scraping.
