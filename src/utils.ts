import { execFile } from "node:child_process";

/**
 * Cross-platform `which` — resolves the full path of a binary.
 * Returns null if the binary is not found.
 */
export function which(binary: string): Promise<string | null> {
  const cmd = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(cmd, [binary], (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const firstLine = stdout.trim().split("\n")[0]?.trim();
      resolve(firstLine || null);
    });
  });
}

/**
 * Format duration in ms to human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
