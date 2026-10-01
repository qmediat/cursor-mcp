import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../executor.js";
import { CursorAbortError } from "../errors.js";

export const cursorModelsInputSchema = z.object({});

const ANSI = /\x1B\[[0-9;?]*[ -\/]*[@-~]/g;

/** The CLI's `models` output as text: ANSI stripped; empty when it lists nothing ("No models available …"). */
export function cleanModelsOutput(stdout: string): string {
  const text = stdout
    .replace(ANSI, "")
    .split("\n")
    .filter((line) => !/^\s*Loading models/i.test(line)) // the CLI's progress line, redrawn with cursor codes
    .join("\n")
    .trim();
  if (text === "" || /^no models available/i.test(text)) return ""; // the CLI's whole answer, not a phrase in a list
  return text;
}

/** Ids seen in Cursor's documentation when this release was made; the CLI's own list is the source of truth. */
const KNOWN_MODEL_IDS = ["auto", "composer-2.5", "composer-2.5-fast"] as const;

export const FALLBACK_TEXT =
  "The installed cursor-agent listed no models (no `models` output, or 'No models available for this account').\n" +
  "Any id cursor-agent accepts can be passed as `model`; `auto` lets Cursor choose. Ids seen in Cursor's documentation when " +
  `this release was made: ${KNOWN_MODEL_IDS.join(", ")}. The current list and prices: ` +
  "https://cursor.com/docs/models-and-pricing (or run `cursor-agent models` / `agent models` in a terminal).";

export async function handleCursorModels(signal?: AbortSignal): Promise<CallToolResult> {
  let dynamicOutput = "";
  let failure = "";

  try {
    const result = await execute({
      args: ["models"],
      timeoutMs: 15_000,
      parseJson: false,
      ...(signal ? { signal } : {}),
    });
    dynamicOutput = cleanModelsOutput(result.stdout);
  } catch (error) {
    // an older CLI without `models`, not logged in, no binary, a timeout: the fallback text says what to do, and the
    // cause is named so the caller can tell a missing CLI from an empty list
    if (error instanceof CursorAbortError) throw error;
    failure = error instanceof Error ? error.message : String(error);
  }

  const text = dynamicOutput || (failure ? `${FALLBACK_TEXT}\n\nThe CLI's models command failed: ${failure} — run cursor_health.` : FALLBACK_TEXT);
  return {
    content: [{ type: "text" as const, text }],
  };
}
