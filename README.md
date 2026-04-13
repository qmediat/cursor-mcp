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

## Supervised Coding Skill

Optional [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code) that lets Claude Code act as a **supervisor** while any Cursor model does the coding.

**How it works:** Claude Code analyzes the task, sends precise instructions to Cursor via `cursor_agent`, reviews the output by reading actual files from disk, and iterates with `cursor_reply` until satisfied (max 3 rounds).

> **Prerequisite:** The `cursor-cli` MCP server (this package) must be installed and configured in Claude Code first.

### Usage

```
/cursor-code <task>                          # default: composer-2
/cursor-code --model gpt-5.4 <task>          # explicit model
/cursor-code --model cursor/grok <task>      # any model from cursor_models
```

Run `cursor_models` to list all available model IDs.

### Install the skill

```bash
mkdir -p ~/.claude/skills/cursor-code
```

Create `~/.claude/skills/cursor-code/SKILL.md` with the following content:

<details>
<summary>SKILL.md (click to expand)</summary>

```markdown
---
name: cursor-code
description: Delegate coding to any Cursor model while Claude Code supervises.
  Use when user says "cursor-code", "delegate to cursor", "cursor code this",
  or "/cursor-code". Supports all models from cursor_models (Composer 2, GPT 5.4,
  Gemini 3.1 Pro, Grok 4.20, Claude 4.6 Sonnet, Kimi K2.5, etc.).
metadata:
  version: 1.0.0
---

# Supervised Coding: Claude Code (Supervisor) -> Cursor (Coder)

You are the **supervisor** (Claude Code). A Cursor model is the **coder**.
You give precise instructions, the coder writes code, you review and iterate.

## Parsing

Extract from user input:
- `--model <id>` -> model to use (default: `composer-2`)
- Everything else -> the task description

If user says a model name naturally (e.g. "use gpt-5.4", "with gemini", "z grok"),
extract it and map to the cursor_models ID.

## Workflow

### Step 1: Analyze
- Read the relevant files to understand current state
- Break the user's task into a single, focused coding instruction
- Identify: target files, constraints, acceptance criteria

### Step 2: Instruct
Call `cursor_agent` with:
- `model`: extracted model or `composer-2`
- `workspace`: current working directory
- `prompt`: precise instruction with file paths, function names, constraints
- Keep prompt focused -- one task per call, not an entire feature
- Extract and store the `session_id` from the response for use in Step 4

Output before calling: `[cursor-cli -> <model>]`

### Step 3: Verify
After the coder returns:
- Run `git diff --name-only` to discover ALL files the coder modified
- Read EVERY modified file from disk (use Read tool) -- not just the ones from your prompt
- Diff against expectations
- Check: correctness, edge cases, security, type safety

### Step 4: Iterate (max 3 rounds)
If issues found:
- Call `cursor_reply` with the same session_id
- Give specific fix instructions (file:line, what's wrong, what to do)
- Re-verify after each round
- If the coder is fundamentally off-track (wrong approach, not just small bugs),
  abandon the session early and start fresh with a more explicit prompt

### Step 5: Report
Summarize to the user:
- Model used (confirm from response, not just request)
- What was done
- Files changed
- Rounds needed (1 = clean, 2-3 = corrections applied)
- Any manual fixes Claude Code applied directly

## Rules
- ONE task per cursor_agent call -- don't batch entire features
- ALWAYS read files from disk after coder finishes
- NEVER trust cached file contents -- Cursor writes directly to disk
- Set timeout_seconds appropriately (30-120s for typical tasks)
- If the task is trivial (< 5 lines) -- just do it yourself, don't delegate
- Follow model transparency rules -- always state [cursor-cli -> model] before call
- If cursor_agent/cursor_reply fails (timeout, auth, CLI not found) -- report the error to the user and run cursor_health to diagnose. Do not retry silently
- If unsure about valid model IDs -- call cursor_models first
```

<!-- Skill v1.0.0 — keep in sync with ~/.claude/skills/cursor-code/SKILL.md -->
</details>

Restart Claude Code after creating the skill file.

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
