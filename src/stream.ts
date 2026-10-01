/** cursor-agent's `--output-format stream-json`: one JSON object per line. The shapes are from Cursor's reference
 * (cursor.com/docs/cli/reference/output-format): `system` init, `user`, `assistant`, `tool_call` started/completed
 * and the terminal `result`, which has the same shape as the non-streaming JSON output. */
import { StringDecoder } from "node:string_decoder";
import { z } from "zod/v4";
import { CursorResultSchema } from "./types.js";

export const SystemInitEvent = z
  .object({
    type: z.literal("system"),
    subtype: z.string().optional(),
    model: z.string().optional(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    permissionMode: z.string().optional(),
  })
  .passthrough();

export const AssistantEvent = z
  .object({
    type: z.literal("assistant"),
    message: z
      .object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() })
      .passthrough()
      .optional(),
    session_id: z.string().optional(),
  })
  .passthrough();

/** `tool_call` carries one key per tool kind (`readToolCall`, `editToolCall`, …) with `args` and, when completed,
 * `result`. The kinds are not enumerated by Cursor; the key name is kept as the tool's name. */
export const ToolCallEvent = z
  .object({
    type: z.literal("tool_call"),
    subtype: z.enum(["started", "completed"]),
    call_id: z.string().optional(),
    tool_call: z.record(z.string(), z.object({ args: z.record(z.string(), z.unknown()).optional() }).passthrough()),
    session_id: z.string().optional(),
  })
  .passthrough();

/** The terminal event; cursor-agent may send `null` where the non-streaming output omits a field. */
export const ResultEvent = CursorResultSchema.extend({
  type: z.literal("result"),
  result: z.string().nullable().optional(),
  request_id: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
});
export type ResultEvent = z.infer<typeof ResultEvent>;

/** Any other line that parses as JSON with a `type` (a `user` echo, a future kind) is kept but not interpreted. */
export const OtherEvent = z.object({ type: z.string() }).passthrough();

/** A stdout line that is not a stream-json event (a stray log line), reported, never dropped. */
export interface NoiseEvent {
  readonly type: "noise";
  readonly line: string;
}

export const StreamEvent = z.union([SystemInitEvent, AssistantEvent, ToolCallEvent, ResultEvent, OtherEvent]);
export type StreamEvent = z.infer<typeof StreamEvent> | NoiseEvent;
export type ToolCall = z.infer<typeof ToolCallEvent>;

/** A tool call reduced to what a supervisor wants to see: its kind and the path or command it touched. */
export interface ToolCallSummary {
  readonly name: string;
  readonly target: string | null;
  readonly writes: boolean;
  /** `true` when the completed call reports a `result.success` that is not false/null; `false` for any other result
   * (rejected without `--force`, an error, a shape this package does not know) or a started event. */
  readonly succeeded: boolean;
}

const PATH_KEYS = ["path", "file", "filePath", "file_path", "target_file", "command"] as const;
const WRITE_KINDS = /write|edit|delete|create|move|rename|apply|replace|patch/i;

export function summarizeToolCall(event: ToolCall): ToolCallSummary {
  const [name, call] = Object.entries(event.tool_call)[0] ?? ["unknown", { args: undefined }];
  const args = call?.args ?? {};
  let target: string | null = null;
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value !== "") {
      target = value;
      break;
    }
  }
  const result = (call as { result?: unknown })?.result;
  const success = typeof result === "object" && result !== null ? (result as { success?: unknown }).success : undefined;
  const succeeded = success !== undefined && success !== null && success !== false; // a value, not a key
  return { name, target, writes: WRITE_KINDS.test(name), succeeded };
}

/** Splits a byte stream into lines and parses each as a stream-json event. A line that is not JSON (a stray log
 * line) is counted and passed to `onNoise`, never dropped silently; a JSON line that fits no shape is `OtherEvent`. */
/** The longest line kept while waiting for its newline; past it the line is noise (a transcript, not an event). */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;
/** How many noise lines are kept verbatim (the rest are counted). */
export const NOISE_SAMPLE = 5;

export class NdjsonParser {
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8"); // a multi-byte character may be split across chunks
  /** The first few non-event lines, verbatim; `noiseCount` has them all. */
  readonly noise: string[] = [];
  noiseCount = 0;

  constructor(
    private readonly onEvent: (event: StreamEvent) => void,
    private readonly onNoise?: (line: string) => void,
  ) {}

  feed(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    let at = this.buffer.indexOf("\n");
    while (at >= 0) {
      this.line(this.buffer.slice(0, at));
      this.buffer = this.buffer.slice(at + 1);
      at = this.buffer.indexOf("\n");
    }
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.line(this.buffer); // too long to be an event: judged now, not kept
      this.buffer = "";
    }
  }

  /** The last line without a newline, if any (the terminal result may end without one). */
  end(): void {
    this.buffer += this.decoder.end();
    if (this.buffer.trim() !== "") this.line(this.buffer);
    this.buffer = "";
  }

  private line(raw: string): void {
    const text = raw.trim();
    if (text === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.noisy(text);
      return;
    }
    const event = StreamEvent.safeParse(parsed);
    if (event.success) this.onEvent(event.data);
    else this.noisy(text);
  }

  private noisy(text: string): void {
    this.noiseCount += 1;
    if (this.noise.length < NOISE_SAMPLE) this.noise.push(text.length > 500 ? `${text.slice(0, 500)}…` : text);
    this.onNoise?.(text);
  }
}
