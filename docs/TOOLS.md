# Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cursor_agent` | Execute a prompt using Cursor's AI agent | `prompt` (≤ 100 000 chars), `model`, `mode`, `workspace`, `timeout_seconds` (10–3600, default 600) |
| `cursor_reply` | Continue an existing agent session | `prompt`, `session_id`, `model`, `timeout_seconds` |
| `cursor_models` | List the model ids the installed CLI offers | — |
| `cursor_sessions` | List agent sessions (this server instance) | — |
| `cursor_health` | Check installation, auth, and config | — |

Both agent tools run cursor-agent with `--output-format stream-json`: the answer, its `session_id`, `request_id`, the model cursor-agent reported, the duration, the number of tool calls and the files changed (write/edit targets, each once) come back as text and as `structuredContent` (`outputSchema` published). A client that sends a progress token on the request gets one `notifications/progress` per event (model, tool call, assistant message), so a ten-minute run never looks dead.

## Models

`model` is passed to `cursor-agent --model` as given, so every id the installed CLI accepts works — the current list and prices are on [cursor.com/docs/models-and-pricing](https://cursor.com/docs/models-and-pricing), and `cursor_models` returns what your CLI reports (`cursor-agent models`). `auto` (the default) lets Cursor choose. This page names no ids on purpose: Cursor adds and retires models faster than this package releases, and a list here was what made 1.0.x reject every current model.

## Modes

| Mode | Description |
|------|-------------|
| `agent` | Tools, terminal, search (default). In headless mode file changes are **proposed in the answer, not applied**, unless the operator set `CURSOR_ALLOW_YOLO=true` (`--force`) |
| `plan` | Read-only planning — analyses and proposes a plan, makes no edits (in headless mode a clarifying question cannot be answered) |
| `ask` | Read-only exploration — no file modifications |

## Parallel Execution

Run multiple models simultaneously by making parallel tool calls:

```
# In Claude Code, spawn 3 Agent subprocesses:
Agent 1: cursor_agent with model=<a Composer id from cursor_models> → "Review this code"
Agent 2: cursor_agent with model=<a Claude id from cursor_models> → "Review this code"
Agent 3: cursor_agent with model=<a GPT id from cursor_models> → "Review this code"
```

The built-in semaphore (default: 3) queues excess requests to prevent rate limit errors.
