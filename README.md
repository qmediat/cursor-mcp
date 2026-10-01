<p align="left">
  <a href="https://www.qmediat.io/open-source?utm_source=oss-readme&utm_medium=cursor-mcp&utm_campaign=open-source">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qmediat/.github/b35746f6b3c933d9eeb539033ef40ea9876349ae/assets/qmediat-wordmark-light.svg">
      <img src="https://raw.githubusercontent.com/qmediat/.github/b35746f6b3c933d9eeb539033ef40ea9876349ae/assets/qmediat-wordmark-badge.svg" alt="Quantum Media Technologies" height="40">
    </picture>
  </a>
</p>

# @qmediat.io/cursor-mcp

[![npm version](https://img.shields.io/npm/v/@qmediat.io/cursor-mcp)](https://www.npmjs.com/package/@qmediat.io/cursor-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

MCP server for the [Cursor CLI](https://cursor.com/docs/cli) (`cursor-agent`): run Cursor's agent with any model id your plan offers — the Composer, Claude, GPT, Gemini and Grok families — through the [Model Context Protocol](https://modelcontextprotocol.io).

## Why this server?

- **Any Cursor model** — the `model` id is passed to `cursor-agent --model` as given; `cursor_models` lists what your CLI offers (Composer, Claude, GPT, Gemini, Grok families on your plan)
- **5 tools** — agent execution, session continuation, model listing, session listing, health check
- **Parallel execution** — run multiple models simultaneously with built-in concurrency control (semaphore)
- **Guarded execution** — `spawn` without a shell, auto-approve only through the operator's environment (never a tool parameter), the client's cancellation and the timeout kill the child (SIGTERM, SIGKILL 5 s later)
- **Minimal dependencies** — only `@modelcontextprotocol/sdk` + `zod`
- **Session management** — resume conversations across calls

## Quick Start

### Prerequisites

1. **Node.js >= 22.0.0**
2. **Cursor CLI** installed and authenticated:

```bash
# Install the Cursor CLI (installs `agent`; `cursor-agent` stays as a legacy alias — the one this server resolves)
curl https://cursor.com/install -fsS | bash

# Authenticate (a Cursor account whose plan includes agent usage — see cursor.com/docs/models-and-pricing)
agent login
```

Requires Node.js 22 or newer.

### Install

```bash
claude mcp add --scope user cursor-cli -- npx -y @qmediat.io/cursor-mcp
```

or by hand (below). `npm install -g @qmediat.io/cursor-mcp` installs the `cursor-mcp` command, which can replace the `npx` line in any config.

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
| `CURSOR_MAX_CONCURRENCY` | No | `3` | Maximum concurrent cursor-agent processes — a positive integer; anything else is the default |
| `CURSOR_ALLOW_YOLO` | No | `false` | `true` runs `cursor_agent` and `cursor_reply` with `--force` (auto-approve every tool call). **DANGEROUS** — only for trusted environments |
| `CURSOR_KILL_GRACE_MS` | No | `5000` | After SIGTERM (timeout or cancellation), a child still alive this long is sent SIGKILL — a positive integer of milliseconds |

## Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `cursor_agent` | Execute a prompt using Cursor's AI agent | `prompt` (≤ 100 000 chars), `model`, `mode`, `workspace`, `cloud` (experimental), `timeout_seconds` (10–3600, default 600) |
| `cursor_reply` | Continue an existing agent session | `prompt`, `session_id`, `model`, `timeout_seconds` |
| `cursor_models` | List the model ids the installed CLI offers | — |
| `cursor_sessions` | List agent sessions (this server instance) | — |
| `cursor_health` | Check installation, auth, and config | — |

### Models

`model` is passed to `cursor-agent --model` as given, so every id the installed CLI accepts works — the current list and prices are on [cursor.com/docs/models-and-pricing](https://cursor.com/docs/models-and-pricing), and `cursor_models` returns what your CLI reports (`cursor-agent models`). `auto` (the default) lets Cursor choose. This README names no ids on purpose: Cursor adds and retires models faster than this package releases, and a list here was what made 1.0.x reject every current model.

### Modes

| Mode | Description |
|------|-------------|
| `agent` | Full capabilities — file edit, terminal, search (default) |
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

## Security

- **No shell execution** — `child_process.spawn` with argument arrays; the prompt follows a `--` separator and the session id must be one word, so neither can read as a `cursor-agent` option (a prompt or session id of `-f` cannot turn into `--force`)
- **No credentials stored** — cursor-agent handles its own OAuth
- **No HTTP requests** — pure CLI wrapper, no network access beyond cursor-agent
- **Process cleanup** — the client's cancellation (the MCP request signal) and the timeout kill the child: SIGTERM, then SIGKILL after `CURSOR_KILL_GRACE_MS` (5 s); the call and its concurrency slot are released only once the child is gone
- **Auto-approve gated** — `--force` requires explicit `CURSOR_ALLOW_YOLO=true` env var, never controllable by LLMs; it applies to `cursor_agent` and `cursor_reply` alike
- **Trusted workspace** — every call runs `cursor-agent --trust` on the given `workspace` (the server's cwd by default), so the agent is not prompted about the directory: point `workspace` only at directories you intend it to operate in
- **Concurrency limited** — semaphore prevents resource exhaustion

See [SECURITY.md](SECURITY.md) for full details.

## Supervised Coding Skill

Optional [Claude Code skill](https://code.claude.com/docs) that lets Claude Code act as a **supervisor** while any Cursor model does the coding.

**How it works:** Claude Code analyzes the task, sends precise instructions to Cursor via `cursor_agent`, reviews the output by reading actual files from disk, and iterates with `cursor_reply` until satisfied (max 3 rounds).

> **Prerequisite:** The `cursor-cli` MCP server (this package) must be installed and configured in Claude Code first.

### Usage

```
/cursor-code <task>                              # default: auto (Cursor chooses)
/cursor-code --model <id> <task>                 # any id cursor_models lists
```

Run `cursor_models` to list the ids your CLI offers.

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
  or "/cursor-code". Works with any model id cursor_models lists (the Composer,
  Claude, GPT, Gemini and Grok families on your Cursor plan).
metadata:
  version: 1.1.0
---

# Supervised Coding: Claude Code (Supervisor) -> Cursor (Coder)

You are the **supervisor** (Claude Code). A Cursor model is the **coder**.
You give precise instructions, the coder writes code, you review and iterate.

## Parsing

Extract from user input:
- `--model <id>` -> model to use (default: `auto`, Cursor chooses)
- Everything else -> the task description

If user says a model name naturally (e.g. "use composer", "with gemini", "z grok"),
extract it and map to an id from cursor_models.

## Workflow

### Step 1: Analyze
- Read the relevant files to understand current state
- Break the user's task into a single, focused coding instruction
- Identify: target files, constraints, acceptance criteria

### Step 2: Instruct
Call `cursor_agent` with:
- `model`: extracted model or `auto`
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

<!-- Skill v1.1.0 — keep in sync with ~/.claude/skills/cursor-code/SKILL.md -->
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

See [CONTRIBUTING.md](https://github.com/qmediat/cursor-mcp/blob/main/CONTRIBUTING.md) for guidelines; `npm test` builds and runs the smoke and argv tests.


## Trademarks and affiliation

Cursor is a trademark of Anysphere. This is an independent, community-maintained integration published by Quantum Media Technologies sp. z o.o.; it is not affiliated with, sponsored by or endorsed by Anysphere. Use of the Cursor API or CLI through this server is subject to Anysphere's own terms and to your own API key or account.

## License

MIT - [Quantum Media Technologies sp. z o.o.](https://www.qmediat.io)

---

Made by [Quantum Media Technologies](https://www.qmediat.io/open-source?utm_source=oss-readme&utm_medium=cursor-mcp&utm_campaign=open-source) · [more open source from qmediat](https://github.com/qmediat)
