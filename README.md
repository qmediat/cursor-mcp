# @qmediat.io/cursor-mcp

[![npm version](https://img.shields.io/npm/v/@qmediat.io/cursor-mcp)](https://www.npmjs.com/package/@qmediat.io/cursor-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

MCP server for [Cursor CLI](https://cursor.com/docs/cli) — access Composer 2, Claude, GPT, Gemini, and Grok models through the [Model Context Protocol](https://modelcontextprotocol.io).

## Why this server?

- **Multi-model access** — Composer 2, Claude 4.6 Opus, GPT-5.4, Gemini 3 Pro, Grok, Kimi K2.5 through a single interface
- **5 tools** — agent execution, session continuation, model listing, session listing, health check
- **Parallel execution** — run multiple models simultaneously with built-in concurrency control (semaphore)
- **Security-first** — `spawn` (no shell), auto-approve gated by env var (never LLM-controllable), AbortSignal cancellation
- **Minimal dependencies** — only `@modelcontextprotocol/sdk` + `zod`
- **Session management** — resume conversations across calls

## Quick Start

### Prerequisites

1. **Node.js >= 22.0.0**
2. **Cursor CLI** installed and authenticated:

```bash
# Install cursor-agent
curl https://cursor.com/install -fsS | bash

# Authenticate (requires Cursor Pro/Business subscription)
cursor-agent login
```

### Install

```bash
npm install -g @qmediat.io/cursor-mcp
```

Or run directly with npx:

```bash
npx @qmediat.io/cursor-mcp
```

## Configuration

### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "cursor-cli": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@qmediat.io/cursor-mcp"]
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "cursor-cli": {
      "command": "npx",
      "args": ["-y", "@qmediat.io/cursor-mcp"]
    }
  }
}
```

### Local development

```json
{
  "mcpServers": {
    "cursor-cli": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cursor-mcp/dist/index.js"]
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CURSOR_MAX_CONCURRENCY` | No | `3` | Maximum concurrent cursor-agent processes |
| `CURSOR_ALLOW_YOLO` | No | `false` | Enable `--force` mode (auto-approve all tool calls). **DANGEROUS** — only for trusted environments |

## Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cursor_agent` | Execute a prompt using Cursor's AI agent | `prompt`, `model`, `mode`, `workspace`, `cloud`, `timeout_seconds` |
| `cursor_reply` | Continue an existing agent session | `prompt`, `session_id`, `model`, `timeout_seconds` |
| `cursor_models` | List all available AI models | — |
| `cursor_sessions` | List agent sessions (this server instance) | — |
| `cursor_health` | Check installation, auth, and config | — |

### Models

| Model | Description | Pricing (input/output per 1M tokens) |
|-------|-------------|---------------------------------------|
| `auto` | Cursor auto-selects (default) | varies |
| `composer-2` | Cursor Composer 2 — 200K context | $0.50 / $2.50 |
| `composer-2-fast` | Composer 2 fast variant | $1.50 / $7.50 |
| `cursor/claude-4-sonnet` | Claude 4 Sonnet via Cursor | varies |
| `cursor/claude-4.5-sonnet` | Claude 4.5 Sonnet via Cursor | varies |
| `cursor/claude-4.6-opus-high` | Claude 4.6 Opus via Cursor | varies |
| `cursor/gpt-5.1` | GPT-5.1 via Cursor | varies |
| `gpt-5.4` | GPT-5.4 | varies |
| `cursor/gemini-3-flash` | Gemini 3 Flash via Cursor | varies |
| `gemini-3-pro` | Gemini 3 Pro | varies |
| `cursor/grok` | Grok via Cursor | varies |
| `kimi-k2.5` | Moonshot Kimi K2.5 | varies |

### Modes

| Mode | Description |
|------|-------------|
| `agent` | Full capabilities — file edit, terminal, search (default) |
| `plan` | Design-focused — asks clarifying questions before acting |
| `ask` | Read-only exploration — no file modifications |

## Parallel Execution

Run multiple models simultaneously by making parallel tool calls:

```
# In Claude Code, spawn 3 Agent subprocesses:
Agent 1: cursor_agent with model=composer-2 → "Review this code"
Agent 2: cursor_agent with model=cursor/claude-4-sonnet → "Review this code"
Agent 3: cursor_agent with model=gpt-5.4 → "Review this code"
```

The built-in semaphore (default: 3) queues excess requests to prevent rate limit errors.

## Security

- **No shell execution** — `child_process.spawn` with argument arrays, preventing injection
- **No credentials stored** — cursor-agent handles its own OAuth
- **No HTTP requests** — pure CLI wrapper, no network access beyond cursor-agent
- **Process cleanup** — AbortSignal kills child processes on client disconnect or timeout
- **Auto-approve gated** — `--force` requires explicit `CURSOR_ALLOW_YOLO=true` env var, never controllable by LLMs
- **Concurrency limited** — semaphore prevents resource exhaustion

See [SECURITY.md](SECURITY.md) for full details.

## Development

```bash
git clone https://github.com/qmediat/cursor-mcp.git
cd cursor-mcp
npm install
npm run build
node dist/index.js
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - [Quantum Media Technologies sp. z o.o.](https://www.qmediat.io)
