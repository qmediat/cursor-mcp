import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { cursorAgentInputSchema, handleCursorAgent } from "./tools/cursor-agent.js";
import { cursorReplyInputSchema, handleCursorReply } from "./tools/cursor-reply.js";
import { cursorModelsInputSchema, handleCursorModels } from "./tools/cursor-models.js";
import { cursorSessionsInputSchema, handleCursorSessions } from "./tools/cursor-sessions.js";
import { cursorHealthInputSchema, handleCursorHealth } from "./tools/cursor-health.js";
import { CursorCliError, CursorTimeoutError, CursorNotFoundError, CursorAbortError } from "./errors.js";
import { createRequire } from "node:module";

// dist/server.js → ../package.json is the package root both in the repository and when installed from npm.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function createServer(): McpServer {
  const server = new McpServer({
    name: "cursor-mcp",
    version,
  });

  server.registerTool("cursor_agent", {
    description:
      "Execute a prompt using Cursor's AI agent with any model id the installed cursor-agent accepts (Composer, Claude, GPT, Gemini, Grok families on your plan; run cursor_models for ids)." +
      "Modes: 'agent' (full capabilities — file edit, terminal, search), 'plan' (design-focused), 'ask' (read-only). " +
      "The 'cloud' flag is experimental (see its description).",
    inputSchema: cursorAgentInputSchema,
  }, async (args, extra) => {
    try { return await handleCursorAgent(args, extra.signal); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("cursor_reply", {
    description:
      "Continue an existing Cursor agent session. Send a follow-up message in the same conversation context. " +
      "Requires a session_id from a previous cursor_agent call.",
    inputSchema: cursorReplyInputSchema,
  }, async (args, extra) => {
    try { return await handleCursorReply(args, extra.signal); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("cursor_models", {
    description:
      "List the model ids the installed cursor-agent offers (its `models` command), or a known list when it offers none. " +
      "Pricing is on cursor.com/docs/models-and-pricing. Use an id with cursor_agent's 'model' parameter.",
    inputSchema: cursorModelsInputSchema,
  }, async () => {
    try { return await handleCursorModels(); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("cursor_sessions", {
    description:
      "List Cursor agent sessions created during this MCP server instance. " +
      "Shows session IDs, models, and prompts. Use session IDs with cursor_reply to continue a conversation.",
    inputSchema: cursorSessionsInputSchema,
  }, async () => {
    try { return await handleCursorSessions(); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("cursor_health", {
    description:
      "Check Cursor CLI installation, authentication, and server configuration. " +
      "Run this first to verify everything is set up correctly.",
    inputSchema: cursorHealthInputSchema,
  }, async () => {
    try { return await handleCursorHealth(); } catch (error) { return errorResponse(error); }
  });

  return server;
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
