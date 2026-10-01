/** The argv every headless cursor-agent call starts with, and the two operator-only knobs that may extend it. */

export type OutputFormat = "json" | "stream-json" | "text";

/** CURSOR_SANDBOX: `enabled` or `disabled` is passed as `--sandbox <mode>`; unset leaves the CLI's own default; any
 * other value is a configuration error — refused at startup (`index.ts`) and on every call that would use it. */
export function sandboxArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const mode = env.CURSOR_SANDBOX;
  if (mode === undefined || mode === "") return [];
  if (mode === "enabled" || mode === "disabled") return ["--sandbox", mode];
  throw new Error(`CURSOR_SANDBOX must be "enabled" or "disabled", not ${JSON.stringify(mode)}`);
}

/** Non-interactive, the workspace trusted, the chosen output format: what cursor_agent and cursor_reply have in
 * common. Without `--force` cursor-agent only PROPOSES file changes in print mode (cursor.com/docs/cli/headless). */
export function headlessArgs(env: NodeJS.ProcessEnv = process.env, format: OutputFormat = "stream-json"): string[] {
  const cliArgs = ["-p", "--output-format", format, "--trust", ...sandboxArgs(env)];
  // --force/--yolo: auto-approve all tool calls (file writes, terminal commands).
  // SECURITY: never a tool parameter — a model must not control it. Only the server operator enables it, through
  // CURSOR_ALLOW_YOLO=true in the server's environment (SECURITY.md).
  if (env.CURSOR_ALLOW_YOLO === "true") cliArgs.push("--force");
  return cliArgs;
}
