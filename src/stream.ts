/** cursor-agent's `--output-format stream-json`: one JSON object per line. The shapes are from Cursor's reference
 * (cursor.com/docs/cli/reference/output-format): `system` init, `user`, `assistant`, `tool_call` started/completed
 * and the terminal `result`, which has the same shape as the non-streaming JSON output. */
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

export const ResultEvent = CursorResultSchema.extend({ type: z.literal("result") });

/** Any other line that parses as JSON with a `type` (a `user` echo, a future kind) is kept but not interpreted. */
export const OtherEvent = z.object({ type: z.string() }).passthrough();

export const StreamEvent = z.union([SystemInitEvent, AssistantEvent, ToolCallEvent, ResultEvent, OtherEvent]);
export type StreamEvent = z.infer<typeof StreamEvent>;
export type ToolCall = z.infer<typeof ToolCallEvent>;

/** A tool call reduced to what a supervisor wants to see: its kind and the path or command it touched. */
export interface ToolCallSummary {
  readonly name: string;
  readonly target: string | null;
  readonly writes: boolean;
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
  return { name, target, writes: WRITE_KINDS.test(name) };
}

/** Splits a byte stream into lines and parses each as a stream-json event. A line that is not JSON (a stray log
 * line) is counted and passed to `onNoise`, never dropped silently; a JSON line that fits no shape is `OtherEvent`. */
export class NdjsonParser {
  private buffer = "";
  readonly noise: string[] = [];

  constructor(
    private readonly onEvent: (event: StreamEvent) => void,
    private readonly onNoise?: (line: string) => void,
  ) {}

  feed(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    let at = this.buffer.indexOf("\n");
    while (at >= 0) {
      this.line(this.buffer.slice(0, at));
      this.buffer = this.buffer.slice(at + 1);
      at = this.buffer.indexOf("\n");
    }
  }

  /** The last line without a newline, if any (the terminal result may end without one). */
  end(): void {
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
      this.noise.push(text);
      this.onNoise?.(text);
      return;
    }
    const event = StreamEvent.safeParse(parsed);
    if (event.success) this.onEvent(event.data);
    else {
      this.noise.push(text);
      this.onNoise?.(text);
    }
  }
}
