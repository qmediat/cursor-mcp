/** What one cursor-agent run reports back: the answer, its identity, the files it touched — as text for the reader and
 * as `structuredContent` for a program — and the progress notifications sent while it ran. */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { StreamEvent } from "./stream.js";
import { SystemInitEvent, ToolCallEvent, summarizeToolCall } from "./stream.js";
import type { CursorResult } from "./types.js";
import { formatDuration } from "./utils.js";

/** The structured result of cursor_agent and cursor_reply (`outputSchema`). */
export const runReportSchema = z.object({
  result: z.string().describe("The agent's final answer"),
  status: z.string().describe("cursor-agent's result subtype: success, error, …"),
  is_error: z.boolean(),
  session_id: z.string().nullable().describe("The session to resume with cursor_reply"),
  request_id: z.string().nullable(),
  model: z.string().nullable().describe("The model cursor-agent reported at start (its display name), if it did"),
  duration_ms: z.number().nullable(),
  tool_calls: z.number().int().describe("Tool calls the agent made"),
  files_changed: z.array(z.string()).describe("Paths of write/edit/delete tool calls, in order, each once"),
  stderr: z.string().nullable(),
});

export type RunReport = z.infer<typeof runReportSchema>;

/** Collects what the stream says about a run while it happens, and sends progress to the client that asked for it. */
export class RunObserver {
  model: string | null = null;
  toolCalls = 0;
  readonly filesChanged: string[] = [];
  private progress = 0;

  constructor(private readonly notify?: (message: string) => Promise<void>) {}

  async on(event: StreamEvent): Promise<void> {
    const init = SystemInitEvent.safeParse(event);
    if (init.success && typeof init.data.model === "string") {
      this.model = init.data.model;
      await this.tick(`model ${init.data.model}`);
      return;
    }
    const tool = ToolCallEvent.safeParse(event);
    if (tool.success && tool.data.subtype === "completed") {
      const call = summarizeToolCall(tool.data);
      this.toolCalls += 1;
      if (call.writes && call.target !== null && !this.filesChanged.includes(call.target)) {
        this.filesChanged.push(call.target);
      }
      await this.tick(call.target === null ? call.name : `${call.name} ${call.target}`);
      return;
    }
    if (event.type === "assistant") await this.tick("assistant message");
  }

  private async tick(message: string): Promise<void> {
    this.progress += 1;
    if (this.notify === undefined) return;
    try {
      await this.notify(`${this.progress}: ${message}`);
    } catch {
      // a client that stopped listening is not a failure of the run
    }
  }
}

export function buildReport(
  parsed: CursorResult | undefined,
  stdout: string,
  stderr: string,
  observer: RunObserver,
  fallbackSessionId?: string,
): RunReport {
  return {
    result: parsed?.result ?? stdout ?? "",
    status: parsed?.subtype ?? (parsed ? "unknown" : "no-json"),
    is_error: parsed?.is_error === true || parsed?.subtype === "error",
    session_id: parsed?.session_id ?? fallbackSessionId ?? null,
    request_id: parsed?.request_id ?? null,
    model: observer.model,
    duration_ms: parsed?.duration_ms ?? null,
    tool_calls: observer.toolCalls,
    files_changed: [...observer.filesChanged],
    stderr: stderr === "" ? null : stderr,
  };
}

/** The report as a tool result: the answer first, a metadata line, the changed files, stderr; the same facts in
 * `structuredContent`. */
export function toCallToolResult(report: RunReport): CallToolResult {
  const lines: string[] = [report.result === "" ? "(no output)" : report.result];
  const meta: string[] = [];
  if (report.session_id) meta.push(`Session: ${report.session_id}`);
  if (report.model) meta.push(`Model: ${report.model}`);
  if (report.duration_ms !== null) meta.push(`Duration: ${formatDuration(report.duration_ms)}`);
  if (report.status !== "success") meta.push(`Status: ${report.status}`);
  if (report.tool_calls > 0) meta.push(`Tool calls: ${report.tool_calls}`);
  if (meta.length > 0) lines.push("", "---", meta.join(" | "));
  if (report.files_changed.length > 0) lines.push("", "Files changed:", ...report.files_changed.map((f) => `  ${f}`));
  if (report.stderr !== null) lines.push("", `[stderr] ${report.stderr}`);
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: report,
    ...(report.is_error ? { isError: true } : {}),
  };
}

/** What a tool handler needs from the MCP request: the cancellation signal and, when the client asked for progress,
 * a way to send it. */
export interface ToolExtra {
  signal?: AbortSignal;
  progressToken?: string | number;
  sendNotification?: (notification: {
    method: "notifications/progress";
    params: { progressToken: string | number; progress: number; message?: string };
  }) => Promise<void>;
}

/** An observer that notifies the client only when it asked for progress (a progress token on the request). */
export function observerFor(extra: ToolExtra | undefined): RunObserver {
  const token = extra?.progressToken;
  const send = extra?.sendNotification;
  if (token === undefined || send === undefined) return new RunObserver();
  let n = 0;
  return new RunObserver((message) => {
    n += 1;
    return send({ method: "notifications/progress", params: { progressToken: token, progress: n, message } });
  });
}
