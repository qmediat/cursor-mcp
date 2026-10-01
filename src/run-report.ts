/** What one cursor-agent run reports back: the answer, its identity, the files it touched — as text for the reader and
 * as `structuredContent` for a program — and the progress notifications sent while it ran. */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { StreamEvent } from "./stream.js";
import { AssistantEvent, SystemInitEvent, ToolCallEvent, type ToolCallSummary, summarizeToolCall } from "./stream.js";
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
  tool_calls: z.number().int().describe("Completed tool calls the agent made"),
  files_changed: z
    .array(z.string())
    .describe(
      "Paths of file-tool write/edit/delete calls that reported success, in order, each once. Shell commands are not inspected: a file written by a shell tool is not listed.",
    ),
  files_proposed: z
    .array(z.string())
    .describe("Paths of file-tool write/edit/delete calls that did not report success (proposed without --force, refused, failed), each once"),
  noise_lines: z.number().int().describe("stdout lines that were not stream-json events (kept, never dropped)"),
  stderr: z.string().nullable(),
});

export type RunReport = z.infer<typeof runReportSchema>;

/** Collects what the stream says about a run while it happens, and sends progress to the client that asked for it. */
export class RunObserver {
  model: string | null = null;
  initSessionId: string | null = null;
  toolCalls = 0;
  noiseLines = 0;
  lastAssistantText: string | null = null;
  readonly filesChanged: string[] = [];
  readonly filesProposed: string[] = [];
  private progress = 0;

  constructor(private readonly notify?: (progress: number, message: string) => Promise<void>) {}

  async on(event: StreamEvent): Promise<void> {
    if (event.type === "noise") {
      this.noiseLines += 1;
      return;
    }
    const init = SystemInitEvent.safeParse(event);
    if (init.success && typeof init.data.model === "string") {
      this.model = init.data.model;
      this.initSessionId = init.data.session_id ?? null;
      await this.tick(`model ${init.data.model}`);
      return;
    }
    const tool = ToolCallEvent.safeParse(event);
    if (tool.success && tool.data.subtype === "completed") {
      await this.completed(summarizeToolCall(tool.data));
      return;
    }
    const assistant = AssistantEvent.safeParse(event);
    if (assistant.success) {
      const text = assistant.data.message?.content?.map((c) => c.text ?? "").join("") ?? "";
      if (text !== "") this.lastAssistantText = text;
      await this.tick("assistant message");
    }
  }

  private async completed(call: ToolCallSummary): Promise<void> {
    this.toolCalls += 1;
    if (call.writes && call.target !== null) {
      const list = call.succeeded ? this.filesChanged : this.filesProposed;
      if (!list.includes(call.target)) list.push(call.target);
    }
    const outcome = call.writes && !call.succeeded ? " (not applied)" : "";
    await this.tick(`${call.target === null ? call.name : `${call.name} ${call.target}`}${outcome}`);
  }

  private async tick(message: string): Promise<void> {
    this.progress += 1;
    if (this.notify === undefined) return;
    try {
      await this.notify(this.progress, message);
    } catch {
      // a client that stopped listening is not a failure of the run
    }
  }
}

/** The report of a run. Without a `result` event the run did not end as cursor-agent ends one: the last assistant
 * message (if any) is the answer, the status says so and `is_error` is true — the raw transcript is never the answer. */
export function buildReport(
  parsed: CursorResult | undefined,
  stderr: string,
  observer: RunObserver,
  fallbackSessionId?: string,
): RunReport {
  const ended = parsed !== undefined;
  return {
    result: parsed?.result ?? observer.lastAssistantText ?? "",
    status: ended ? (parsed.subtype ?? "unknown") : "no-result-event",
    is_error: !ended || parsed.is_error === true || parsed.subtype === "error",
    session_id: parsed?.session_id ?? observer.initSessionId ?? fallbackSessionId ?? null,
    request_id: parsed?.request_id ?? null,
    model: observer.model,
    duration_ms: parsed?.duration_ms ?? null,
    tool_calls: observer.toolCalls,
    files_changed: [...observer.filesChanged],
    files_proposed: [...observer.filesProposed],
    noise_lines: observer.noiseLines,
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
  if (report.noise_lines > 0) meta.push(`Non-event stdout lines: ${report.noise_lines}`);
  if (meta.length > 0) lines.push("", "---", meta.join(" | "));
  if (report.files_changed.length > 0) lines.push("", "Files changed:", ...report.files_changed.map((f) => `  ${f}`));
  if (report.files_proposed.length > 0) {
    lines.push("", "Files proposed, not applied (no --force, refused or failed):", ...report.files_proposed.map((f) => `  ${f}`));
  }
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
  return new RunObserver((progress, message) =>
    send({ method: "notifications/progress", params: { progressToken: token, progress, message } }),
  );
}
