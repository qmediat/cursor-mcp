import { type ChildProcess, spawn } from "node:child_process";
import { which } from "./utils.js";
import { CursorCliError, CursorTimeoutError, CursorNotFoundError, CursorAbortError } from "./errors.js";
import { CursorResultSchema, DEFAULT_TIMEOUT_MS, CURSOR_BINARY, DEFAULT_KILL_GRACE_MS, DEFAULT_MAX_CONCURRENCY, MAX_TIMER_MS, MAX_CONCURRENCY_LIMIT } from "./types.js";
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

  /** A slot, or a wait for one that the request's signal can end: a cancelled request leaves the queue at once. */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new CursorAbortError();
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve, reject) => {
      const grant = (): void => {
        signal?.removeEventListener("abort", leave);
        this.active++;
        resolve(() => this.release());
      };
      const leave = (): void => {
        const at = this.queue.indexOf(grant);
        if (at >= 0) this.queue.splice(at, 1);
        reject(new CursorAbortError());
      };
      signal?.addEventListener("abort", leave, { once: true });
      this.queue.push(grant);
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** An environment knob as an integer in [1, max]; anything else (unset, 0, negative, fractional, text, above max) is
 * the default. */
function parseBounded(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
}

/** CURSOR_MAX_CONCURRENCY: 1 to MAX_CONCURRENCY_LIMIT, else the default 3. */
export function parseMaxConcurrency(raw: string | undefined): number {
  return parseBounded(raw, DEFAULT_MAX_CONCURRENCY, MAX_CONCURRENCY_LIMIT);
}

/** CURSOR_KILL_GRACE_MS: 1 to MAX_TIMER_MS milliseconds (what setTimeout can wait), else the default 5000. */
export function parseKillGraceMs(raw: string | undefined): number {
  return parseBounded(raw, DEFAULT_KILL_GRACE_MS, MAX_TIMER_MS);
}

// both read once, with the other knobs, when the server starts
const semaphore = new Semaphore(parseMaxConcurrency(process.env.CURSOR_MAX_CONCURRENCY));
const killGraceMs = parseKillGraceMs(process.env.CURSOR_KILL_GRACE_MS);

/** The cursor-agent groups running now: the server's own shutdown signals them, since a detached group does not
 * receive the terminal's SIGINT/SIGHUP with the server. */
const live = new Set<ChildProcess>();

function shutdownGroups(sig: NodeJS.Signals): void {
  for (const child of live) {
    if (child.pid === undefined) continue;
    try {
      if (process.platform === "win32") child.kill(sig);
      else process.kill(-child.pid, sig);
    } catch {
      // already gone
    }
  }
}

// A signal to the server: every group gets SIGTERM, SIGKILL after the grace period if any is still there, and the
// server then ends by the signal's default action (the handler is gone after once). An exit the server cannot delay
// (stdin closed, an explicit exit) sends SIGKILL: no agent outlives the server.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(sig, () => {
    shutdownGroups("SIGTERM");
    const end = (): void => {
      shutdownGroups("SIGKILL");
      process.kill(process.pid, sig);
    };
    if (live.size === 0) end();
    else setTimeout(end, killGraceMs);
  });
}
process.on("exit", () => shutdownGroups("SIGKILL"));

export async function execute(options: ExecuteOptions): Promise<ExecuteResult> {
  const release = await semaphore.acquire(options.signal);
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

    // Its own process group (POSIX): a cancellation reaches cursor-agent's helpers too, so none keeps editing after
    // the request is reported aborted, and a helper that inherited the pipes cannot keep the request alive. The
    // server's own shutdown signals every live group (see `shutdownGroups`).
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      detached: process.platform !== "win32",
    });
    live.add(child);

    // The group may outlive its leader: the signal goes to the group while any member exists, never to the leader's
    // pid alone once it has exited (a pid can be reused).
    const signalGroup = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === "win32") child.kill(sig);
        else process.kill(-child.pid, sig);
      } catch {
        // no member left (ESRCH) or not ours: nothing to signal
      }
    };

    // A cancellation (the client's signal or the timeout) sends SIGTERM to the group; SIGKILL follows after the grace
    // period whatever the leader did meanwhile — a helper that ignores SIGTERM dies with it. The promise (and the
    // semaphore slot behind it) is released once the leader is gone — on `exit`, not `close`.
    let abortError: Error | null = null;
    let sigkillTimer: NodeJS.Timeout | undefined;
    const escalate = (): void => {
      if (sigkillTimer !== undefined) return;
      sigkillTimer = setTimeout(() => signalGroup("SIGKILL"), killGraceMs);
      sigkillTimer.unref(); // the deadline holds, but it never keeps the server alive on its own
    };
    const onAbort = (): void => {
      if (abortError !== null) return;
      abortError = timeoutSignal.aborted ? new CursorTimeoutError(timeoutMs) : new CursorAbortError();
      signalGroup("SIGTERM");
      escalate();
    };
    combinedSignal.addEventListener("abort", onAbort, { once: true });
    // a signal that was aborted before the listener existed never fires it
    if (combinedSignal.aborted) onAbort();

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const finish = (error: Error | null, result?: ExecuteResult): void => {
      if (settled) return;
      settled = true;
      combinedSignal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result!);
    };

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        finish(new CursorNotFoundError());
      } else {
        finish(new CursorCliError(null, "", error.message));
      }
    });

    const settleFromBuffers = (exitCode: number | null, signalCode: NodeJS.Signals | null): void => {
      if (abortError !== null) {
        finish(abortError);
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

      if (exitCode === null) {
        // killed by something other than this request (an operator, the OOM killer): not a result
        finish(new CursorCliError(null, stderr, `cursor-agent was killed by ${signalCode ?? "a signal"}`));
        return;
      }
      if (exitCode !== 0) {
        finish(new CursorCliError(exitCode, stderr, `cursor-agent exited with code ${exitCode}`));
        return;
      }
      finish(null, parseResult(stdout, stderr, exitCode, parseJson));
    };

    // `close` (the pipes closed) normally follows `exit` at once. When it does not, a helper that inherited the
    // pipes is holding them: the group is signalled and the call settles with what was read, after the same grace.
    let closeTimer: NodeJS.Timeout | undefined;
    child.on("exit", (exitCode, signalCode) => {
      live.delete(child);
      if (abortError !== null) {
        finish(abortError);
        return;
      }
      closeTimer = setTimeout(() => {
        signalGroup("SIGTERM");
        escalate();
        settleFromBuffers(exitCode, signalCode);
      }, killGraceMs);
    });

    child.on("close", (exitCode, signalCode) => {
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      settleFromBuffers(exitCode, signalCode);
    });
  });
}

function parseResult(stdout: string, stderr: string, exitCode: number, parseJson: boolean): ExecuteResult {
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
  return result;
}
