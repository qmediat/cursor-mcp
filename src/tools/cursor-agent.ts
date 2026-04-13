import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../executor.js";
import { CursorModel, CursorMode, DEFAULT_TIMEOUT_MS } from "../types.js";
import { formatDuration } from "../utils.js";

export const cursorAgentInputSchema = z.object({
  prompt: z.string().min(1).max(100_000).describe(
    "The prompt or task for the Cursor agent. Supports natural language instructions for code generation, review, debugging, and more.",
  ),
  model: CursorModel.optional().describe(
    "AI model to use. Default: auto (Cursor picks the best model). Options: composer-2, composer-2-fast, cursor/claude-4-sonnet, gpt-5.4, gemini-3-pro, cursor/grok, etc.",
  ),
  mode: CursorMode.optional().describe(
    "Agent mode. 'agent' = full capabilities (file edit, terminal, search). 'plan' = design-focused, asks clarifying questions. 'ask' = read-only exploration. Default: agent.",
  ),
  workspace: z.string().optional().describe(
    "Working directory for the agent. Affects file search scope and project context. Default: server's current working directory.",
  ),
  cloud: z.boolean().optional().describe(
    "Run as a cloud agent on Cursor's infrastructure. Enables background execution — works while you're offline. Default: false.",
  ),
  timeout_seconds: z.number().int().min(10).max(3600).optional().describe(
    "Maximum execution time in seconds (10-3600). Default: 600 (10 minutes).",
  ),
});

export async function handleCursorAgent(
  args: z.infer<typeof cursorAgentInputSchema>,
): Promise<CallToolResult> {
  const cliArgs = ["-p", "--output-format", "json", "--trust"];

  // --force/--yolo: auto-approve all tool calls (file writes, terminal commands).
  // SECURITY: Never exposed as a tool parameter — LLMs must not control this.
  // Only the server operator can enable it via CURSOR_ALLOW_YOLO=true env var.
  if (process.env.CURSOR_ALLOW_YOLO === "true") {
    cliArgs.push("--force");
  }

  if (args.model && args.model !== "auto") {
    cliArgs.push("--model", args.model);
  }

  if (args.mode && args.mode !== "agent") {
    cliArgs.push("--mode", args.mode);
  }

  if (args.workspace) {
    cliArgs.push("--workspace", args.workspace);
  }

  if (args.cloud) {
    cliArgs.push("-c");
  }

  cliArgs.push(args.prompt);

  const timeoutMs = args.timeout_seconds
    ? args.timeout_seconds * 1000
    : DEFAULT_TIMEOUT_MS;

  const result = await execute({ args: cliArgs, timeoutMs });

  const lines: string[] = [];

  if (result.parsed) {
    const p = result.parsed;
    lines.push(p.result ?? "(no output)");

    const meta: string[] = [];
    if (p.session_id) meta.push(`Session: ${p.session_id}`);
    if (p.duration_ms) meta.push(`Duration: ${formatDuration(p.duration_ms)}`);
    if (p.subtype && p.subtype !== "success") meta.push(`Status: ${p.subtype}`);

    if (meta.length > 0) {
      lines.push("");
      lines.push(`---`);
      lines.push(meta.join(" | "));
    }
  } else {
    // Fallback: raw stdout when JSON parsing fails
    lines.push(result.stdout || "(no output)");
  }

  if (result.stderr) {
    lines.push("");
    lines.push(`[stderr] ${result.stderr}`);
  }

  const isError = result.parsed?.is_error === true || result.parsed?.subtype === "error";

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    ...(isError ? { isError: true } : {}),
  };
}
