import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sessionStore } from "../session-store.js";

export const cursorSessionsInputSchema = z.object({});

function formatAge(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export async function handleCursorSessions(): Promise<CallToolResult> {
  const sessions = sessionStore.list();

  if (sessions.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: "No sessions yet. Use cursor_agent to start a new session.",
      }],
    };
  }

  const lines = sessions.map((s) => {
    const model = s.model ?? "auto";
    const msgs = s.messageCount === 1 ? "1 msg" : `${s.messageCount} msgs`;
    return `- **${s.id}**\n  ${model} | ${msgs} | ${formatAge(s.lastUsedAt)}\n  "${s.firstPrompt}"`;
  });

  return {
    content: [{
      type: "text" as const,
      text: `Sessions (this server instance):\n\n${lines.join("\n\n")}\n\nUse cursor_reply with a session_id to continue a conversation.`,
    }],
  };
}
