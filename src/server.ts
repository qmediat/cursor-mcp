import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { cursorAgentInputSchema, handleCursorAgent } from "./tools/cursor-agent.js";
import { cursorReplyInputSchema, handleCursorReply } from "./tools/cursor-reply.js";
import { cursorModelsInputSchema, handleCursorModels } from "./tools/cursor-models.js";
import { cursorSessionsInputSchema, handleCursorSessions } from "./tools/cursor-sessions.js";
import { cursorHealthInputSchema, handleCursorHealth } from "./tools/cursor-health.js";
import { runReportSchema, type ToolExtra } from "./run-report.js";

import { CursorCliError, CursorTimeoutError, CursorNotFoundError, CursorAbortError } from "./errors.js";
import { createRequire } from "node:module";

/** The request's signal and, when the client asked for progress, its token and the notifier. */
function toolExtra(extra: RequestHandlerExtra<ServerRequest, ServerNotification>): ToolExtra {
  const progressToken = extra._meta?.progressToken;
  return {
    signal: extra.signal,
    ...(progressToken !== undefined ? { progressToken } : {}),
    sendNotification: extra.sendNotification,
  };
}

// dist/server.js → ../package.json is the package root both in the repository and when installed from npm.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function createServer(): McpServer {
  const server = new McpServer({
    name: "cursor-mcp",
    version,
  });

  server.registerTool(
    "cursor_agent",
    {
      description:
        "Execute a prompt using Cursor's AI agent with any model id the installed cursor-agent accepts (Composer, Claude, GPT, Gemini, Grok families on your plan; run cursor_models for ids). " +
        "Modes: 'agent' (tools, terminal, search), 'plan' (design-focused), 'ask' (read-only). " +
        "In headless mode cursor-agent only PROPOSES file changes unless the server operator set CURSOR_ALLOW_YOLO=true (then --force applies them; CURSOR_SANDBOX=enabled confines them). " +
        "The result lists the files changed and the model used; a client that sends a progress token gets a progress notification per tool call.",
      inputSchema: cursorAgentInputSchema,
      outputSchema: runReportSchema,
    },
    guarded((args, extra) => handleCursorAgent(args, toolExtra(extra))),
  );

  server.registerTool(
    "cursor_reply",
    {
      description:
        "Continue an existing Cursor agent session. Send a follow-up message in the same conversation context. " +
        "Requires a session_id from a previous cursor_agent call.",
      inputSchema: cursorReplyInputSchema,
      outputSchema: runReportSchema,
    },
    guarded((args, extra) => handleCursorReply(args, toolExtra(extra))),
  );

  server.registerTool(
    "cursor_models",
    {
      description:
        "List the model ids the installed cursor-agent offers (its `models` command), or a known list when it offers none. " +
        "Pricing is on cursor.com/docs/models-and-pricing. Use an id with cursor_agent's 'model' parameter.",
      inputSchema: cursorModelsInputSchema,
    },
    guarded((_args, extra) => handleCursorModels(extra.signal)),
  );

  server.registerTool(
    "cursor_sessions",
    {
      description:
        "List Cursor agent sessions created during this MCP server instance. " +
        "Shows session IDs, models, and prompts. Use session IDs with cursor_reply to continue a conversation.",
      inputSchema: cursorSessionsInputSchema,
    },
    guarded(() => handleCursorSessions()),
  );

  server.registerTool(
    "cursor_health",
    {
      description:
        "Check Cursor CLI installation, authentication, and server configuration. " +
        "Run this first to verify everything is set up correctly.",
      inputSchema: cursorHealthInputSchema,
    },
    guarded((_args, extra) => handleCursorHealth(extra.signal)),
  );

  return server;
}

/** A tool handler whose thrown failure is the tool's error result, never a protocol error — one rule for every tool (a
 * handler may still answer a failure it expects, a failed probe, with a result of its own). */
function guarded<A extends unknown[]>(
  handler: (...args: A) => Promise<CallToolResult>,
): (...args: A) => Promise<CallToolResult> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function errorResponse(error: unknown): CallToolResult {
  let message: string;

  if (error instanceof CursorNotFoundError) {
    message = error.message;
  } else if (error instanceof CursorTimeoutError) {
    message = error.message;
  } else if (error instanceof CursorAbortError) {
    message = error.message;
  } else if (error instanceof CursorCliError) {
    message = error.toMcpError();
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
