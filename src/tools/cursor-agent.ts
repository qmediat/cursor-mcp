import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../executor.js";
import { CursorModel, CursorMode, CursorWorkspace, DEFAULT_TIMEOUT_MS } from "../types.js";
import { headlessArgs } from "../cursor-argv.js";
import { buildReport, observerFor, toCallToolResult, type ToolExtra } from "../run-report.js";
import { sessionStore } from "../session-store.js";

export const cursorAgentInputSchema = z.object({
  prompt: z.string().min(1).max(100_000).describe(
    "The prompt or task for the Cursor agent. Supports natural language instructions for code generation, review, debugging, and more.",
  ),
  model: CursorModel.optional().describe(
    "AI model id as cursor-agent accepts it, passed through to --model (any id cursor_models lists; e.g. a Composer, Claude, GPT, Gemini or Grok id on your plan). Default: auto (Cursor picks the model). Was a closed list of old ids before 1.1.0.",
  ),
  mode: CursorMode.optional().describe(
    "Agent mode. 'agent' = full capabilities (file edit, terminal, search). 'plan' = design-focused, asks clarifying questions. 'ask' = read-only exploration. Default: agent.",
  ),
  workspace: CursorWorkspace.optional().describe(
    "Working directory for the agent. Affects file search scope and project context. Default: server's current working directory.",
  ),
  timeout_seconds: z.number().int().min(10).max(3600).optional().describe(
    "Maximum execution time in seconds (10-3600). Default: 600 (10 minutes).",
  ),
});

export type CursorAgentArgs = z.infer<typeof cursorAgentInputSchema>;

/** The cursor-agent argv for a cursor_agent call. `--force` comes from the operator's environment only (SECURITY.md). */
export function buildCursorAgentArgs(args: CursorAgentArgs, env: NodeJS.ProcessEnv = process.env): string[] {
  const cliArgs = headlessArgs(env);

  if (args.model && args.model !== "auto") {
    cliArgs.push("--model", args.model);
  }

  if (args.mode && args.mode !== "agent") {
    cliArgs.push("--mode", args.mode);
  }

  if (args.workspace) {
    cliArgs.push("--workspace", args.workspace);
  }

  cliArgs.push("--", args.prompt); // the prompt is an operand, never an option, whatever it starts with
  return cliArgs;
}

export async function handleCursorAgent(args: CursorAgentArgs, extra?: ToolExtra): Promise<CallToolResult> {
  const cliArgs = buildCursorAgentArgs(args);
  const timeoutMs = args.timeout_seconds ? args.timeout_seconds * 1000 : DEFAULT_TIMEOUT_MS;
  const observer = observerFor(extra);
  const result = await execute({
    args: cliArgs,
    timeoutMs,
    ...(extra?.signal ? { signal: extra.signal } : {}),
    onEvent: (event) => observer.on(event),
  });
  const report = buildReport(result.parsed, result.stdout, result.stderr, observer);
  if (report.session_id) {
    sessionStore.record(report.session_id, args.prompt, { model: args.model ?? "auto", mode: args.mode ?? "agent" });
  }
  return toCallToolResult(report);
}
