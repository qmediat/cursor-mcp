import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../executor.js";

export const cursorModelsInputSchema = z.object({});

export async function handleCursorModels(): Promise<CallToolResult> {
  // cursor-agent doesn't have a dedicated `models` subcommand yet,
  // so we return the known model list. This is kept in sync with
  // Cursor's documentation and updated with each release.
  //
  // If cursor-agent adds `models` subcommand in the future,
  // we should call it dynamically here.

  let dynamicOutput = "";

  try {
    // Attempt to get models from CLI (may not be supported yet)
    const result = await execute({
      args: ["models"],
      timeoutMs: 15_000,
      parseJson: false,
    });
    dynamicOutput = result.stdout;
  } catch {
    // Expected — `models` subcommand may not exist yet
  }

  if (dynamicOutput) {
    return {
      content: [{ type: "text" as const, text: dynamicOutput }],
    };
  }

  // Fallback: static list from Cursor documentation
  const models = [
    { name: "auto", description: "Cursor auto-selects the best model (default)" },
    { name: "composer-2", description: "Cursor Composer 2 — proprietary, 200K context, $0.50/$2.50 per 1M tokens" },
    { name: "composer-2-fast", description: "Composer 2 fast variant — same intelligence, lower latency, $1.50/$7.50 per 1M tokens" },
    { name: "composer-1.5", description: "Cursor Composer 1.5 — previous generation" },
    { name: "composer-1", description: "Cursor Composer 1 — legacy" },
    { name: "cursor/claude-4-sonnet", description: "Claude 4 Sonnet via Cursor" },
    { name: "cursor/claude-4.5-sonnet", description: "Claude 4.5 Sonnet via Cursor" },
    { name: "cursor/claude-4.6-opus-high", description: "Claude 4.6 Opus (high compute) via Cursor" },
    { name: "cursor/gpt-5.1", description: "GPT-5.1 via Cursor" },
    { name: "cursor/gpt-5.2", description: "GPT-5.2 via Cursor" },
    { name: "gpt-5.4", description: "GPT-5.4" },
    { name: "gpt-5.4-mini", description: "GPT-5.4 Mini" },
    { name: "cursor/gemini-3-flash", description: "Gemini 3 Flash via Cursor" },
    { name: "gemini-3.1-pro", description: "Gemini 3.1 Pro" },
    { name: "gemini-3-pro", description: "Gemini 3 Pro" },
    { name: "cursor/grok", description: "Grok via Cursor" },
    { name: "kimi-k2.5", description: "Moonshot Kimi K2.5" },
  ];

  const lines = models.map((m) => `${m.name.padEnd(35)} ${m.description}`);

  return {
    content: [{
      type: "text" as const,
      text: `Available Cursor models:\n\n${lines.join("\n")}\n\nNote: Model availability depends on your Cursor subscription plan.\nUse --model <name> with cursor-agent to select a specific model.`,
    }],
  };
}
