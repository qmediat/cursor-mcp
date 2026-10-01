// The executor against a fake `cursor-agent` on PATH: the client's signal reaches the child, SIGKILL follows SIGTERM
// after the grace period, and the semaphore slot is held until the child is gone. No real Cursor CLI involved.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const fs = require("node:fs");
if (process.env.FAKE_GRANDCHILD) {
  // a helper that inherits the pipes and outlives its parent unless the group is signalled
  const helper = require("node:child_process").spawn("sleep", ["30"], { stdio: "inherit" });
  fs.writeFileSync(${JSON.stringify(pidFile)} + ".helper", String(helper.pid));
}
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
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
// every test starts without the pid files of the previous one: a stale pid is not a running child
const fresh = () => Promise.all([rm(pidFile, { force: true }), rm(`${pidFile}.helper`, { force: true })]);
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
  await fresh();
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

test("a signal aborted before the call still ends the child: SIGTERM, then SIGKILL after the grace period", async () => {
  await fresh();
  const ac = new AbortController();
  ac.abort();
  const call = execute({ args: ["-p", "x"], timeoutMs: 10_000, signal: ac.signal });
  await assert.rejects(call, CursorAbortError);
  // whatever was spawned is gone and the slot is free: the next call starts at once
  await fresh();
  const ac2 = new AbortController();
  const next = execute({ args: ["-p", "y"], timeoutMs: 10_000, signal: ac2.signal });
  const pid = await childPid();
  assert.ok(alive(pid));
  ac2.abort();
  await assert.rejects(next, CursorAbortError);
  assert.ok(!alive(pid));
});

test("a grandchild holding the pipes neither survives the cancellation nor keeps the request alive", async () => {
  await fresh();
  const ac = new AbortController();
  process.env.FAKE_GRANDCHILD = "1";
  let pid;
  let helperPid;
  try {
    const call = execute({ args: ["-p", "x"], timeoutMs: 10_000, signal: ac.signal });
    pid = await childPid();
    helperPid = Number(await readFile(`${pidFile}.helper`, "utf8"));
    assert.ok(alive(helperPid), "the helper runs");
    const aborted = Date.now();
    ac.abort();
    await assert.rejects(call, CursorAbortError);
    assert.ok(Date.now() - aborted < 5_000, "settled without waiting for the helper's 30 s");
  } finally {
    delete process.env.FAKE_GRANDCHILD;
  }
  await sleep(100);
  assert.ok(!alive(pid), "the child is gone");
  assert.ok(!alive(helperPid), "the helper went with its process group");
});

test("a request cancelled while it waits for a slot leaves the queue at once; the running child is untouched", async () => {
  await fresh();
  const ac = new AbortController();
  const running = execute({ args: ["-p", "x"], timeoutMs: 10_000, signal: ac.signal });
  const pid = await childPid();
  const acQueued = new AbortController();
  const queued = execute({ args: ["-p", "y"], timeoutMs: 10_000, signal: acQueued.signal });
  await sleep(100);
  const aborted = Date.now();
  acQueued.abort();
  await assert.rejects(queued, CursorAbortError);
  assert.ok(Date.now() - aborted < 200, "no grace period: nothing was spawned for it");
  assert.ok(alive(pid), "the running child is unaffected");
  assert.equal(Number(await readFile(pidFile, "utf8")), pid, "the queued call never spawned");
  ac.abort();
  await assert.rejects(running, CursorAbortError);
});

test("the tool handler passes the request signal on: handleCursorAgent is cancelled through it", async () => {
  await fresh();
  const ac = new AbortController();
  const call = handleCursorAgent({ prompt: "x" }, ac.signal);
  await childPid();
  ac.abort();
  const result = await call.catch((e) => e);
  assert.ok(result instanceof CursorAbortError, String(result));
});
