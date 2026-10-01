import { spawn } from "node:child_process";
import { which } from "./utils.js";
import { CursorCliError, CursorTimeoutError, CursorNotFoundError, CursorAbortError } from "./errors.js";
import { CursorResultSchema, DEFAULT_TIMEOUT_MS, CURSOR_BINARY, KILL_GRACE_MS, DEFAULT_MAX_CONCURRENCY } from "./types.js";
import type { CursorResult } from "./types.js";

let binaryPath: string | null = null;

async function resolveBinary(): Promise<string> {
  if (binaryPath) return binaryPath;
  const resolved = await which(CURSOR_BINARY);
  if (!resolved) throw new CursorNotFoundError();
  binaryPath = resolved;
  return binaryPath;
}

export interface ExecuteOptions {
  args: string[];
  timeoutMs?: number;
  parseJson?: boolean;
  signal?: AbortSignal;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  parsed?: CursorResult;
}

/**
 * Concurrency limiter — prevents spawning too many cursor-agent processes.
 * Default max=3 (cursor-agent has known issues with >3 concurrent local processes).
 * Override with CURSOR_MAX_CONCURRENCY env var.
 */
class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** CURSOR_MAX_CONCURRENCY as a positive integer; anything else (unset, 0, negative, fractional, text) is the default. */
export function parseMaxConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_CONCURRENCY;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_CONCURRENCY;
}

const semaphore = new Semaphore(parseMaxConcurrency(process.env.CURSOR_MAX_CONCURRENCY));

export async function execute(options: ExecuteOptions): Promise<ExecuteResult> {
  const release = await semaphore.acquire();
  try {
    return await executeInternal(options);
  } finally {
    release();
  }
}

async function executeInternal(options: ExecuteOptions): Promise<ExecuteResult> {
  const { args, timeoutMs = DEFAULT_TIMEOUT_MS, parseJson = true, signal } = options;
  const binary = await resolveBinary();

  // Combine MCP cancellation signal with hard timeout using AbortSignal.any() (Node 20+)
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  return new Promise<ExecuteResult>((resolve, reject) => {
    let settled = false;

    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      signal: combinedSignal,
    });

    // The spawn `signal` sends SIGTERM once; a CLI that ignores it would outlive the request and keep its semaphore
    // slot. SIGKILL follows after the grace period unless the child has exited.
    let killTimer: NodeJS.Timeout | undefined;
    const escalate = (): void => {
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, KILL_GRACE_MS);
    };
    combinedSignal.addEventListener("abort", escalate, { once: true });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const finish = (error: Error | null, result?: ExecuteResult): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result!);
    };

    child.on("error", (error) => {
      if (error.name === "AbortError") {
        // Distinguish timeout from MCP client cancellation
        if (timeoutSignal.aborted) {
          finish(new CursorTimeoutError(timeoutMs));
        } else {
          finish(new CursorAbortError());
        }
      } else if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        finish(new CursorNotFoundError());
      } else {
        finish(new CursorCliError(null, "", error.message));
      }
    });

    child.on("close", (exitCode) => {
      if (killTimer !== undefined) clearTimeout(killTimer);
      combinedSignal.removeEventListener("abort", escalate);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

      if (exitCode !== 0 && exitCode !== null) {
        finish(new CursorCliError(exitCode, stderr, `cursor-agent exited with code ${exitCode}`));
        return;
      }

      const result: ExecuteResult = { stdout, stderr, exitCode };

      if (parseJson && stdout) {
        try {
          const raw = JSON.parse(stdout);
          result.parsed = CursorResultSchema.parse(raw);
        } catch {
          // JSON parse failed — return raw stdout, not an error.
          // cursor-agent may output non-JSON in some modes (e.g., `ls`).
        }
      }

      finish(null, result);
    });
  });
}
