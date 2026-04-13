import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../executor.js";
import { which } from "../utils.js";
import { CURSOR_BINARY } from "../types.js";

export const cursorHealthInputSchema = z.object({});

export async function handleCursorHealth(): Promise<CallToolResult> {
  const checks: string[] = [];
  let healthy = true;

  // Check 1: Binary found
  const binaryPath = await which(CURSOR_BINARY);
  if (binaryPath) {
    checks.push(`[OK] cursor-agent found: ${binaryPath}`);
  } else {
    checks.push("[FAIL] cursor-agent not found. Install: curl https://cursor.com/install -fsS | bash");
    healthy = false;
  }

  // Check 2: Version
  if (binaryPath) {
    try {
      const result = await execute({
        args: ["--version"],
        timeoutMs: 10_000,
        parseJson: false,
      });
      checks.push(`[OK] Version: ${result.stdout}`);
    } catch {
      checks.push("[FAIL] Could not get version");
      healthy = false;
    }
  }

  // Check 3: Auth status
  if (binaryPath) {
    try {
      const result = await execute({
        args: ["status"],
        timeoutMs: 15_000,
        parseJson: false,
      });
      if (result.stdout.toLowerCase().includes("not logged in") ||
          result.stdout.toLowerCase().includes("not authenticated")) {
        checks.push("[FAIL] Not authenticated. Run: cursor-agent login");
        healthy = false;
      } else {
        checks.push(`[OK] Auth: ${result.stdout.split("\n")[0]}`);
      }
    } catch (error) {
      checks.push(`[WARN] Could not check auth status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Check 4: Concurrency config
  const maxConcurrency = Number(process.env.CURSOR_MAX_CONCURRENCY) || 3;
  checks.push(`[INFO] Max concurrency: ${maxConcurrency} (CURSOR_MAX_CONCURRENCY)`);

  // Check 5: Yolo mode
  const yoloEnabled = process.env.CURSOR_ALLOW_YOLO === "true";
  checks.push(`[INFO] Auto-approve mode: ${yoloEnabled ? "ENABLED (--force)" : "disabled (safe)"}`);

  const status = healthy ? "HEALTHY" : "UNHEALTHY";

  return {
    content: [{
      type: "text" as const,
      text: `Cursor MCP Health Check: ${status}\n\n${checks.join("\n")}`,
    }],
    ...(healthy ? {} : { isError: true }),
  };
}
