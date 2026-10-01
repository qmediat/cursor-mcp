/** The argv every headless cursor-agent call starts with, and the one gate that may add `--force`. */

/** Non-interactive, JSON output, the workspace trusted: what cursor_agent and cursor_reply have in common. */
export function headlessArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const cliArgs = ["-p", "--output-format", "json", "--trust"];
  // --force/--yolo: auto-approve all tool calls (file writes, terminal commands).
  // SECURITY: never a tool parameter — a model must not control it. Only the server operator enables it, through
  // CURSOR_ALLOW_YOLO=true in the server's environment (SECURITY.md).
  if (env.CURSOR_ALLOW_YOLO === "true") cliArgs.push("--force");
  return cliArgs;
}
