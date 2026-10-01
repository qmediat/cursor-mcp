import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../executor.js";
import { headlessArgs } from "../cursor-argv.js";
import { CursorModel, CursorSessionId, DEFAULT_TIMEOUT_MS } from "../types.js";
import { buildReport, observerFor, toCallToolResult, type ToolExtra } from "../run-report.js";
import { sessionStore } from "../session-store.js";

export const cursorReplyInputSchema = z.object({
  prompt: z.string().min(1).max(100_000).describe(
    "Follow-up message to send in an existing Cursor agent session.",
  ),
  session_id: CursorSessionId.describe(
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
  const cliArgs = [...headlessArgs(env), "--resume", args.session_id];

  if (args.model && args.model !== "auto") {
    cliArgs.push("--model", args.model);
  }

  cliArgs.push("--", args.prompt); // the prompt is an operand, never an option, whatever it starts with
  return cliArgs;
}

export async function handleCursorReply(args: CursorReplyArgs, extra?: ToolExtra): Promise<CallToolResult> {
  const cliArgs = buildCursorReplyArgs(args);
  const timeoutMs = args.timeout_seconds ? args.timeout_seconds * 1000 : DEFAULT_TIMEOUT_MS;
  const observer = observerFor(extra);
  const result = await execute({
    args: cliArgs,
    timeoutMs,
    ...(extra?.signal ? { signal: extra.signal } : {}),
    onEvent: (event) => observer.on(event),
  });
  await observer.drain(); // every progress notification lands before the result
  const report = buildReport(result.parsed, result.stderr, result.exitCode, observer, args.session_id);
  if (report.session_id) sessionStore.record(report.session_id, args.prompt, { model: args.model });
  return toCallToolResult(report);
}
