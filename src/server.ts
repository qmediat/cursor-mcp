import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { cursorAgentInputSchema, handleCursorAgent } from "./tools/cursor-agent.js";
import { cursorReplyInputSchema, handleCursorReply } from "./tools/cursor-reply.js";
import { cursorModelsInputSchema, handleCursorModels } from "./tools/cursor-models.js";
import { cursorSessionsInputSchema, handleCursorSessions } from "./tools/cursor-sessions.js";
import { cursorHealthInputSchema, handleCursorHealth } from "./tools/cursor-health.js";
import { CursorCliError, CursorTimeoutError, CursorNotFoundError, CursorAbortError } from "./errors.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "cursor-mcp",
    version: "1.0.0",
  });

  server.registerTool("cursor_agent", {
    description:
      "Execute a prompt using Cursor's AI agent. Supports multiple models including Composer 2, Claude, GPT, Gemini, and Grok. " +
      "Modes: 'agent' (full capabilities — file edit, terminal, search), 'plan' (design-focused), 'ask' (read-only). " +
      "Optionally run as a cloud agent for background execution.",
    inputSchema: cursorAgentInputSchema,
  }, async (args) => {
    try { return await handleCursorAgent(args); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("cursor_reply", {
    description:
      "Continue an existing Cursor agent session. Send a follow-up message in the same conversation context. " +
      "Requires a session_id from a previous cursor_agent call.",
    inputSchema: cursorReplyInputSchema,
  }, async (args) => {
    try { return await handleCursorReply(args); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("cursor_models", {
    description:
      "List all available AI models in Cursor. Shows model names, descriptions, and pricing. " +
      "Use model names with cursor_agent's 'model' parameter.",
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
