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
if (!process.env.FAKE_OBEYS_TERM) process.on("SIGTERM", () => {});
const fs = require("node:fs");
if (process.env.FAKE_GRANDCHILD) {
  // a helper that inherits the pipes and outlives its parent unless the group is signalled; with FAKE_STUBBORN_HELPER
  // it ignores SIGTERM too (only SIGKILL ends it)
  const helper = process.env.FAKE_STUBBORN_HELPER
    ? require("node:child_process").spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 30_000)"], { stdio: "inherit" })
    : require("node:child_process").spawn("sleep", ["30"], { stdio: "inherit" });
  fs.writeFileSync(${JSON.stringify(pidFile)} + ".helper", String(helper.pid));
}
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
if (process.env.FAKE_EXITS_AT_ONCE) {
  process.stdout.write("done");
  process.exit(0);
}
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

test("a leader that exits while a helper holds the pipes: the call settles with its output after the grace, the helper is killed", async () => {
  await fresh();
  process.env.FAKE_GRANDCHILD = "1";
  process.env.FAKE_EXITS_AT_ONCE = "1";
  let helperPid;
  try {
    const started = Date.now();
    const result = await execute({ args: ["-p", "x"], timeoutMs: 10_000, parseJson: false });
    helperPid = Number(await readFile(`${pidFile}.helper`, "utf8"));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "done", "what the leader wrote before it exited");
    assert.ok(Date.now() - started < 5_000, "settled without the helper's 30 s");
  } finally {
    delete process.env.FAKE_GRANDCHILD;
    delete process.env.FAKE_EXITS_AT_ONCE;
  }
  await sleep(100);
  assert.ok(!alive(helperPid), "the helper was signalled with the group");
});

test("a helper that ignores SIGTERM is SIGKILLed at the deadline even though the leader obeyed SIGTERM", async () => {
  await fresh();
  process.env.FAKE_GRANDCHILD = "1";
  process.env.FAKE_STUBBORN_HELPER = "1";
  process.env.FAKE_OBEYS_TERM = "1";
  let helperPid;
  try {
    const ac = new AbortController();
    const call = execute({ args: ["-p", "x"], timeoutMs: 10_000, signal: ac.signal });
    await childPid();
    helperPid = Number(await readFile(`${pidFile}.helper`, "utf8"));
    await sleep(200); // the helper's node is up and ignores SIGTERM
    ac.abort();
    await assert.rejects(call, CursorAbortError);
    assert.ok(alive(helperPid), "the helper survived SIGTERM (the leader did not)");
    await sleep(300 + 300);
    assert.ok(!alive(helperPid), "SIGKILL reached the group at the deadline");
  } finally {
    delete process.env.FAKE_GRANDCHILD;
    delete process.env.FAKE_STUBBORN_HELPER;
    delete process.env.FAKE_OBEYS_TERM;
  }
});

test("the server's own SIGTERM ends every running cursor-agent group", async () => {
  await fresh();
  const { spawn } = await import("node:child_process");
  const script = `
    const { execute } = await import(${JSON.stringify(new URL("../dist/executor.js", import.meta.url).href)});
    execute({ args: ["-p", "x"], timeoutMs: 30_000 }).catch(() => {});
    setTimeout(() => {}, 60_000);
  `;
  const server = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, FAKE_GRANDCHILD: "1" },
  });
  const pid = await childPid();
  const helperPid = Number(await readFile(`${pidFile}.helper`, "utf8"));
  assert.ok(alive(pid) && alive(helperPid));
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  await sleep(200);
  assert.ok(!alive(pid), "the agent is gone with the server");
  assert.ok(!alive(helperPid), "its helper too");
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
