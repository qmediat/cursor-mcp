import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../executor.js";
import { CursorModel, DEFAULT_TIMEOUT_MS } from "../types.js";
import { formatDuration } from "../utils.js";
import { sessionStore } from "../session-store.js";

export const cursorReplyInputSchema = z.object({
  prompt: z.string().min(1).max(100_000).describe(
    "Follow-up message to send in an existing Cursor agent session.",
  ),
  session_id: z.string().min(1).describe(
    "Session ID from a previous cursor-agent call. Use cursor-sessions to list available sessions.",
  ),
  model: CursorModel.optional().describe(
    "Override the model for this reply (any id cursor_models lists). If omitted, uses the session's original model.",
  ),
  timeout_seconds: z.number().int().min(10).max(3600).optional().describe(
    "Maximum execution time in seconds (10-3600). Default: 600 (10 minutes).",
  ),
});

export type CursorReplyArgs = z.infer<typeof cursorReplyInputSchema>;

/** The cursor-agent argv for a cursor_reply call: the same `--force` gate as cursor_agent, so a session that was
 * auto-approved keeps applying its edits on follow-ups (before 1.1.0 a reply only proposed them). */
export function buildCursorReplyArgs(args: CursorReplyArgs, env: NodeJS.ProcessEnv = process.env): string[] {
  const cliArgs = [
    "-p",
    "--output-format", "json",
    "--trust",
    "--resume", args.session_id,
  ];

  if (env.CURSOR_ALLOW_YOLO === "true") {
    cliArgs.push("--force");
  }

  if (args.model && args.model !== "auto") {
    cliArgs.push("--model", args.model);
  }

  cliArgs.push(args.prompt);
  return cliArgs;
}

export async function handleCursorReply(
  args: CursorReplyArgs,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  const cliArgs = buildCursorReplyArgs(args);

  const timeoutMs = args.timeout_seconds
    ? args.timeout_seconds * 1000
    : DEFAULT_TIMEOUT_MS;

  const result = await execute({ args: cliArgs, timeoutMs, ...(signal ? { signal } : {}) });

  const lines: string[] = [];

  if (result.parsed) {
    const p = result.parsed;
    lines.push(p.result ?? "(no output)");

    const sessionId = p.session_id ?? args.session_id;
    if (sessionId) {
      sessionStore.record(sessionId, args.prompt, {
        model: args.model,
      });
    }

    const meta: string[] = [];
    if (sessionId) meta.push(`Session: ${sessionId}`);
    if (p.duration_ms) meta.push(`Duration: ${formatDuration(p.duration_ms)}`);

    if (meta.length > 0) {
      lines.push("");
      lines.push(`---`);
      lines.push(meta.join(" | "));
    }
  } else {
    lines.push(result.stdout || "(no output)");
  }

  if (result.stderr) {
    lines.push("");
    lines.push(`[stderr] ${result.stderr}`);
  }

  const isError = result.parsed?.is_error === true || result.parsed?.subtype === "error";

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    ...(isError ? { isError: true } : {}),
  };
}
