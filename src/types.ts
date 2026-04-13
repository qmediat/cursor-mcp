import { z } from "zod/v4";

export const CursorModel = z.enum([
  "auto",
  "composer-2",
  "composer-2-fast",
  "composer-1.5",
  "composer-1",
  "cursor/claude-4-sonnet",
  "cursor/claude-4.5-sonnet",
  "cursor/claude-4.6-opus-high",
  "cursor/gpt-5.1",
  "cursor/gpt-5.2",
  "gpt-5.4",
  "gpt-5.4-mini",
  "cursor/gemini-3-flash",
  "gemini-3.1-pro",
  "gemini-3-pro",
  "cursor/grok",
  "kimi-k2.5",
]);

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
export const CURSOR_BINARY = "cursor-agent";
