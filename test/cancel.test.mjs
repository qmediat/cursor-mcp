// The executor against a fake `cursor-agent` on PATH: the client's signal reaches the child, SIGKILL follows SIGTERM
// after the grace period, and the semaphore slot is held until the child is gone. No real Cursor CLI involved.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = await mkdtemp(join(tmpdir(), "cursor-mcp-fake-"));
const pidFile = join(dir, "child.pid");
// a cursor-agent that ignores SIGTERM and lives 30 s: only SIGKILL ends it (one process, so `close` follows the kill)
await writeFile(
  join(dir, "cursor-agent"),
  `#!/usr/bin/env node
process.on("SIGTERM", () => {});
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => {}, 30_000);
`,
);
await chmod(join(dir, "cursor-agent"), 0o755);
process.env.PATH = `${dir}:${process.env.PATH}`;
process.env.CURSOR_KILL_GRACE_MS = "300";
process.env.CURSOR_MAX_CONCURRENCY = "1";

const { execute } = await import("../dist/executor.js");
const { handleCursorAgent } = await import("../dist/tools/cursor-agent.js");
const { CursorAbortError } = await import("../dist/errors.js");

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the fake writes its pid as soon as node is up; `which` + node startup take an unpredictable few hundred ms
const childPid = async (notPid = 0) => {
  for (let i = 0; i < 100; i += 1) {
    const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
    if (pid > 0 && pid !== notPid) return pid;
    await sleep(50);
  }
  throw new Error("the fake cursor-agent did not start");
};

test("a cancelled request kills a child that ignores SIGTERM (SIGKILL after the grace period) and frees the slot only then", async () => {
  const ac = new AbortController();
  const first = execute({ args: ["-p", "x"], timeoutMs: 10_000, signal: ac.signal });
  const pid = await childPid();
  assert.ok(alive(pid), "the fake child runs");
  const aborted = Date.now();
  ac.abort();
  await assert.rejects(first, CursorAbortError);
  const settledAfter = Date.now() - aborted;
  assert.ok(settledAfter >= 250, `the call settles only once the child is gone (${settledAfter} ms after abort)`);
  assert.ok(!alive(pid), "the child is gone after SIGKILL");
  // the slot was held while the child lived: a second call with concurrency 1 starts only now
  const ac2 = new AbortController();
  const second = execute({ args: ["-p", "y"], timeoutMs: 10_000, signal: ac2.signal });
  const pid2 = await childPid(pid);
  assert.ok(alive(pid2), "the second fake child runs");
  ac2.abort();
  await assert.rejects(second, CursorAbortError);
});

test("the tool handler passes the request signal on: handleCursorAgent is cancelled through it", async () => {
  const ac = new AbortController();
  const call = handleCursorAgent({ prompt: "x" }, ac.signal);
  await childPid();
  ac.abort();
  const result = await call.catch((e) => e);
  assert.ok(result instanceof CursorAbortError, String(result));
});
