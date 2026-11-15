<p align="left">
  <a href="https://www.qmediat.io/open-source?utm_source=oss-readme&utm_medium=cursor-mcp&utm_campaign=open-source">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qmediat/.github/b35746f6b3c933d9eeb539033ef40ea9876349ae/assets/qmediat-wordmark-light.svg">
      <img src="https://raw.githubusercontent.com/qmediat/.github/b35746f6b3c933d9eeb539033ef40ea9876349ae/assets/qmediat-wordmark-badge.svg" alt="Quantum Media Technologies" height="40">
    </picture>
  </a>
</p>

# cursor-mcp

Run Cursor's coding agent from Claude Code, with any model your Cursor plan offers.

## Install

```bash
curl https://cursor.com/install -fsS | bash && agent login     # the Cursor CLI
claude mcp add --scope user cursor-cli -- npx -y @qmediat.io/cursor-mcp
```

## Try it

```
Use cursor_agent to add input validation to src/form.ts
```

## Tools

| Tool | Does |
|---|---|
| `cursor_agent` | Run a prompt with Cursor's agent |
| `cursor_reply` | Continue a session |
| `cursor_models` | Models your plan offers |
| `cursor_sessions` | Sessions of this server |
| `cursor_health` | Installation and login check |

## Supports · version 1.2.2

| | |
|---|---|
| Works in | Claude Code · Claude Desktop |
| Model families | Composer · Claude · GPT · Gemini · Grok |
| Runs on | macOS · Linux · Windows |

## Docs

| Read | File |
|---|---|
| [Claude Desktop, local build, environment variables](https://github.com/qmediat/cursor-mcp/blob/main/docs/CONFIGURATION.md) | docs/CONFIGURATION.md |
| [Modes, models and parallel runs](https://github.com/qmediat/cursor-mcp/blob/main/docs/TOOLS.md) | docs/TOOLS.md |
| [Claude supervises, Cursor codes](https://github.com/qmediat/cursor-mcp/blob/main/docs/SUPERVISED-CODING.md) | docs/SUPERVISED-CODING.md |
| [Security](https://github.com/qmediat/cursor-mcp/blob/main/SECURITY.md) | SECURITY.md |
| [Contributing](https://github.com/qmediat/cursor-mcp/blob/main/CONTRIBUTING.md) | CONTRIBUTING.md |
| [For AI agents](https://github.com/qmediat/cursor-mcp/blob/main/AGENTS.md) | AGENTS.md |

Node.js 22 or newer · [MIT](https://github.com/qmediat/cursor-mcp/blob/main/LICENSE) · [Quantum Media Technologies](https://www.qmediat.io/open-source?utm_source=oss-readme&utm_medium=cursor-mcp&utm_campaign=open-source) · [Trademarks](https://github.com/qmediat/cursor-mcp/blob/main/docs/TRADEMARKS.md)
