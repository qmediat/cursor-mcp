# Configuration

## Prerequisites

1. **Node.js >= 22.0.0** (developing it — `npm run lint`'s Babel 8 — needs 22.18 or 24.11)
2. **Cursor CLI** installed and authenticated:

```bash
# Install the Cursor CLI (installs `agent`; `cursor-agent` stays as a legacy alias — the one this server resolves)
curl https://cursor.com/install -fsS | bash

# Authenticate (a Cursor account whose plan includes agent usage — see cursor.com/docs/models-and-pricing)
agent login
```

Requires Node.js 22 or newer.

## Install

```bash
claude mcp add --scope user cursor-cli -- npx -y @qmediat.io/cursor-mcp
```

or by hand (below). `npm install -g @qmediat.io/cursor-mcp` installs the `cursor-mcp` command, which can replace the `npx` line in any config.

## Claude Code (`~/.claude.json`)

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

## Claude Desktop (`claude_desktop_config.json`)

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

## Local development

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
| `CURSOR_MAX_CONCURRENCY` | No | `3` | Maximum concurrent cursor-agent processes — an integer from 1 to 64; anything else is the default |
| `CURSOR_ALLOW_YOLO` | No | `false` | `true` runs `cursor_agent` and `cursor_reply` with `--force` (auto-approve every tool call). Without it cursor-agent in headless mode only **proposes** file changes and applies none ([Cursor's headless docs](https://cursor.com/docs/cli/headless)). **DANGEROUS** — only for trusted environments, best with `CURSOR_SANDBOX=enabled` |
| `CURSOR_SANDBOX` | No | the CLI's default | `enabled` or `disabled`, passed as `--sandbox <mode>`: the sandbox confines what an auto-approved agent may run; any other value ends the server at startup |
| `CURSOR_KILL_GRACE_MS` | No | `5000` | After SIGTERM (timeout or cancellation), a child still alive this long is sent SIGKILL — an integer of milliseconds from 1 to 2147483647 (what a timer can wait); anything else is the default |
