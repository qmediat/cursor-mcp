# Contributing to @qmediat.io/cursor-mcp

Thank you for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/qmediat/cursor-mcp.git
cd cursor-mcp
npm install
npm run build
```

### Prerequisites

- Node.js >= 22.0.0
- cursor-agent CLI installed and authenticated (`cursor-agent login`)

### Local Testing

```bash
# Run the server directly
node dist/index.js

# Or configure in Claude Code (~/.claude.json):
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

## Architecture

```
src/
  index.ts          Entry point — stdio transport
  server.ts         MCP server — tool registration
  executor.ts       Process spawner — child_process.spawn wrapper
  errors.ts         Error types — CLI, timeout, not-found, abort
  types.ts          Zod schemas — models, modes, result format
  utils.ts          Helpers — which, formatDuration
  tools/
    cursor-agent.ts     Main agent tool
    cursor-reply.ts     Session continuation
    cursor-models.ts    Model listing
    cursor-sessions.ts  Session listing
    cursor-health.ts    Health check
```

### Key Design Decisions

1. **spawn, not exec** — no shell injection, stream-safe, AbortSignal support
2. **Semaphore concurrency** — prevents rate limit errors (default: 3 processes)
3. **AbortSignal.any()** — combines MCP client disconnect + hard timeout (Node 20+)
4. **--force gated by env var** — never LLM-controllable, operator-only opt-in
5. **Minimal deps** — only MCP SDK + Zod, no HTTP clients

## Pull Request Guidelines

1. **One concern per PR** — don't mix features with refactoring
2. **Build must pass** — `npm run build` with zero errors
3. **Update CHANGELOG.md** if adding features or fixing bugs
4. **Follow existing patterns** — look at ideogram-mcp for reference
5. **No unnecessary dependencies** — justify any new runtime dep

## Code Style

- TypeScript strict mode
- ES2022 target
- Explicit return types on exported functions
- Zod v4 for all input validation
- `z.describe()` on all tool parameters (for LLM discoverability)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
