import { z } from "zod/v4";

/**
 * A model id is passed through to `cursor-agent --model` as given: Cursor adds and retires models faster than this
 * package releases, and a closed list rejected every current model before the CLI could see it (1.0.x). `auto` lets
 * Cursor choose. `cursor_models` lists what the installed CLI offers.
 */
export const CursorModel = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, "a model id");

export const CursorMode = z.enum(["agent", "plan", "ask"]);

export const CursorResultSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  duration_ms: z.number().optional(),
  duration_api_ms: z.number().optional(),
  result: z.string().optional(),
  session_id: z.string().optional(),
  request_id: z.string().optional(),
}).passthrough();

export type CursorResult = z.infer<typeof CursorResultSchema>;
export type CursorModelType = z.infer<typeof CursorModel>;
export type CursorModeType = z.infer<typeof CursorMode>;

export const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes — agent mode can be slow
/** After SIGTERM (the spawn `signal` option), a child still alive this long is sent SIGKILL. */
export const KILL_GRACE_MS = 5_000;
export const DEFAULT_MAX_CONCURRENCY = 3;
export const CURSOR_BINARY = "cursor-agent";
