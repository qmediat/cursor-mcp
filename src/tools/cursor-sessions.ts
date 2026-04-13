import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../executor.js";

export const cursorSessionsInputSchema = z.object({});

export async function handleCursorSessions(): Promise<CallToolResult> {
  const result = await execute({
    args: ["ls"],
    timeoutMs: 15_000,
    parseJson: false,
  });

  const output = result.stdout || "(no sessions found)";

  return {
    content: [{
      type: "text" as const,
      text: `Cursor agent sessions:\n\n${output}\n\nUse cursor-reply with a session_id to continue a conversation.`,
    }],
  };
}
