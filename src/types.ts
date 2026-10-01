import { z } from "zod/v4";

/**
 * A model id is passed through to `cursor-agent --model` as given: Cursor adds and retires models faster than this
 * package releases, and a closed list rejected every current model before the CLI could see it (1.0.x). `auto` lets
 * Cursor choose. `cursor_models` lists what the installed CLI offers.
 */
export const CursorModel = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, "a model id");

export const CursorMode = z.enum(["agent", "plan", "ask"]);

/** A session id as cursor-agent prints it: one word, never something that could read as an option. */
export const CursorSessionId = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "a session id");

/** A workspace path: a value of `--workspace`, never something that could read as an option. */
export const CursorWorkspace = z.string().min(1).max(4096).refine((p) => !p.startsWith("-"), "a path");

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
export type CursorModeType = z.infer<typeof CursorMode>;

export const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes — agent mode can be slow
/** After SIGTERM to cursor-agent's process group, SIGKILL follows this many milliseconds later (CURSOR_KILL_GRACE_MS overrides). */
export const DEFAULT_KILL_GRACE_MS = 5_000;
/** The longest delay setTimeout honours (2^31 - 1 ms); above it Node fires the timer after 1 ms. */
export const MAX_TIMER_MS = 2_147_483_647;
/** More concurrent cursor-agent processes than this is a configuration error, not a setting. */
export const MAX_CONCURRENCY_LIMIT = 64;
export const DEFAULT_MAX_CONCURRENCY = 3;
export const CURSOR_BINARY = "cursor-agent";
