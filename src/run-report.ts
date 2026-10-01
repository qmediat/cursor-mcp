/** What one cursor-agent run reports back: the answer, its identity, the files it touched — as text for the reader and
 * as `structuredContent` for a program — and the progress notifications sent while it ran. */
import type { CallToolResult, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { StreamEvent } from "./stream.js";
import { AssistantEvent, NOISE_SAMPLE, type NoiseEvent, SystemInitEvent, ToolCallEvent, type ToolCallSummary, summarizeToolCall } from "./stream.js";

const isNoise = (event: StreamEvent): event is NoiseEvent => event.type === "noise";
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
  noise_lines: z.number().int().describe("stdout lines that were not stream-json events (counted, never dropped)"),
  noise_sample: z.array(z.string()).describe("The first few of those lines, verbatim (500 characters each at most)"),
  stderr: z.string().nullable(),
});

export type RunReport = z.infer<typeof runReportSchema>;

/** Collects what the stream says about a run while it happens, and sends progress to the client that asked for it. */
export class RunObserver {
  model: string | null = null;
  initSessionId: string | null = null;
  toolCalls = 0;
  noiseLines = 0;
  readonly noiseSample: string[] = [];
  lastAssistantText: string | null = null;
  readonly filesChanged: string[] = [];
  readonly filesProposed: string[] = [];
  private progress = 0;
  private readonly pending: Promise<void>[] = [];

  constructor(private readonly notify?: (progress: number, message: string) => Promise<void>) {}

  async on(event: StreamEvent): Promise<void> {
    if (isNoise(event)) {
      this.noiseLines += 1;
      if (this.noiseSample.length < NOISE_SAMPLE) {
        this.noiseSample.push(event.line.length > 500 ? `${event.line.slice(0, 500)}…` : event.line);
      }
      return;
    }
    const init = SystemInitEvent.safeParse(event);
    if (init.success) {
      this.initSessionId = init.data.session_id ?? this.initSessionId;
      if (typeof init.data.model === "string") this.model = init.data.model;
      await this.tick(init.data.model === undefined ? "started" : `model ${init.data.model}`);
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
    if (call.writes && call.target !== null) this.noteWrite(call.target, call.succeeded);
    const outcome = call.writes && !call.succeeded ? " (not applied)" : "";
    await this.tick(`${call.target === null ? call.name : `${call.name} ${call.target}`}${outcome}`);
  }

  /** A path is in one list only: once a write succeeded it is changed, whatever came before or after. */
  private noteWrite(target: string, succeeded: boolean): void {
    if (succeeded) {
      const at = this.filesProposed.indexOf(target);
      if (at >= 0) this.filesProposed.splice(at, 1);
      if (!this.filesChanged.includes(target)) this.filesChanged.push(target);
    } else if (!this.filesChanged.includes(target) && !this.filesProposed.includes(target)) {
      this.filesProposed.push(target);
    }
  }

  /** The notification is sent in order and tracked, so a report can wait for the last one before it is returned. */
  private async tick(message: string): Promise<void> {
    this.progress += 1;
    if (this.notify === undefined) return;
    const sent = this.notify(this.progress, message).catch(() => undefined); // a client that stopped listening is not a failure
    this.pending.push(sent);
    await sent;
  }

  /** Resolves once every notification sent so far has settled: the result must not overtake them. */
  async drain(): Promise<void> {
    await Promise.allSettled(this.pending);
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
  // without a result event: the last assistant message; failing that, what stdout held (the noise sample) — never nothing
  const fallback = observer.lastAssistantText ?? (observer.noiseSample.length > 0 ? observer.noiseSample.join("\n") : "");
  return {
    result: parsed?.result ?? fallback,
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
    noise_sample: [...observer.noiseSample],
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
  if (report.noise_lines > 0 && report.status === "no-result-event") {
    lines.push("", "Non-event stdout (sample):", ...report.noise_sample.map((l) => `  ${l}`));
  }
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
  sendNotification?: (notification: ServerNotification) => Promise<void>;
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
