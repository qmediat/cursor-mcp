// The executor against a fake `cursor-agent` on PATH: the client's signal reaches the child, SIGKILL follows SIGTERM
// after the grace period, and the semaphore slot is held until the child is gone. No real Cursor CLI involved.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { after, test } from "node:test";
import { FAKE_AGENT_SKIP, fakeAgentDir } from "./support/fake-agent.mjs";

const fake = await fakeAgentDir("cursor-mcp-fake-");
const { dir } = fake;
const pidFile = join(dir, "child.pid");
// a cursor-agent that ignores SIGTERM and lives 30 s: only SIGKILL ends it (one process, so `close` follows the kill);
// with FAKE_TERM_MARK it notes a SIGTERM in <pid file>.term and exits on it
await fake.write(
  `#!/usr/bin/env node
const fs = require("node:fs");
if (process.env.FAKE_TERM_MARK) {
  process.on("SIGTERM", () => {
    fs.writeFileSync(${JSON.stringify(pidFile)} + ".term", "TERM");
    process.exit(0);
  });
} else if (!process.env.FAKE_OBEYS_TERM) process.on("SIGTERM", () => {});
if (process.env.FAKE_GRANDCHILD) {
  // a helper that inherits the pipes and outlives its parent unless the group is signalled; with FAKE_STUBBORN_HELPER
  // it ignores SIGTERM too (only SIGKILL ends it)
  const stdio = process.env.FAKE_HELPER_NO_PIPES ? "ignore" : "inherit";
  const helper = process.env.FAKE_STUBBORN_HELPER
    ? require("node:child_process").spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 30_000)"], { stdio })
    : require("node:child_process").spawn("sleep", ["30"], { stdio });
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
process.env.PATH = fake.path;
after(() => fake.remove());
const GRACE_MS = 300; // the kill grace of the calls made in this process: SIGKILL follows SIGTERM after it
process.env.CURSOR_KILL_GRACE_MS = String(GRACE_MS);
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
const fresh = () => Promise.all(["", ".helper", ".term"].map((suffix) => rm(`${pidFile}${suffix}`, { force: true })));
// the fake writes its pid as soon as node is up; `which` + node startup take an unpredictable few hundred ms
const childPid = async (notPid = 0) => {
  for (let i = 0; i < 100; i += 1) {
    const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
    if (pid > 0 && pid !== notPid) return pid;
    await sleep(50);
  }
  throw new Error("the fake cursor-agent did not start");
};
// the fake's behaviour flags (FAKE_*) for one test body, removed again whatever the body did
const withFake = async (flags, body) => {
  for (const flag of flags) process.env[flag] = "1";
  try {
    return await body();
  } finally {
    for (const flag of flags) delete process.env[flag];
  }
};
const helperPidOf = async () => Number(await readFile(`${pidFile}.helper`, "utf8"));
// what the FAKE_TERM_MARK agent noted: "TERM" once it saw SIGTERM, "none" when it saw none (no mark); any other read failure throws
const termMark = () =>
  readFile(`${pidFile}.term`, "utf8").catch((e) => (e.code === "ENOENT" ? "none" : Promise.reject(e)));
// a call aborted while its helper ignores SIGTERM: the helper outlives SIGTERM, SIGKILL reaches it at the deadline
const assertHelperKilledAtDeadline = async (survived) => {
  const ac = new AbortController();
  const call = execute({ args: ["-p", "x"], timeoutMs: 10_000, signal: ac.signal });
  await childPid();
  const helperPid = await helperPidOf();
  await sleep(200); // the helper's node is up and ignores SIGTERM
  ac.abort();
  await assert.rejects(call, CursorAbortError);
  assert.ok(alive(helperPid), survived);
  await sleep(GRACE_MS * 2);
  assert.ok(!alive(helperPid), "SIGKILL reached the group at the deadline");
};
// a server process with the shutdown handlers installed and one execute call ({ args: ["-p", "x"], timeoutMs: 30 s }
// and `call`), the fake's `flags` set and its own kill grace; `abortAfterMs` cancels the call, `exitAfterMs` ends the
// server by process.exit (an exit it cannot delay), each after so many ms
const spawnServer = ({ call = {}, flags = [], graceMs, abortAfterMs, exitAfterMs } = {}) => {
  const options = JSON.stringify({ args: ["-p", "x"], timeoutMs: 30_000, ...call });
  const lines = [
    `const { execute, installShutdownHandlers } = await import(${JSON.stringify(new URL("../dist/executor.js", import.meta.url).href)});`,
    "installShutdownHandlers();",
    "const ac = new AbortController();",
    `execute({ ...${options}${abortAfterMs === undefined ? "" : ", signal: ac.signal"} }).catch(() => {});`,
    abortAfterMs === undefined ? "" : `setTimeout(() => ac.abort(), ${abortAfterMs});`,
    exitAfterMs === undefined ? "" : `setTimeout(() => process.exit(0), ${exitAfterMs});`,
    "setTimeout(() => {}, 60_000);",
  ];
  const env = { ...process.env, ...Object.fromEntries(flags.map((flag) => [flag, "1"])) };
  if (graceMs !== undefined) env.CURSOR_KILL_GRACE_MS = String(graceMs);
  return spawn(process.execPath, ["--input-type=module", "-e", lines.join("\n")], {
    stdio: ["ignore", "ignore", "inherit"],
    env,
  });
};

test(
  "a cancelled request kills a child that ignores SIGTERM (SIGKILL after the grace period) and frees the slot only then",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const ac = new AbortController();
    const first = execute({ args: ["-p", "x"], timeoutMs: 10_000, signal: ac.signal });
    const pid = await childPid();
    assert.ok(alive(pid), "the fake child runs");
    const aborted = Date.now();
    ac.abort();
    await assert.rejects(first, CursorAbortError);
    const settledAfter = Date.now() - aborted;
    assert.ok(
      settledAfter >= GRACE_MS - 50,
      `the call settles only once the child is gone (${settledAfter} ms after abort)`,
    );
    assert.ok(!alive(pid), "the child is gone after SIGKILL");
    // the slot was held while the child lived: a second call with concurrency 1 starts only now
    const ac2 = new AbortController();
    const second = execute({ args: ["-p", "y"], timeoutMs: 10_000, signal: ac2.signal });
    const pid2 = await childPid(pid);
    assert.ok(alive(pid2), "the second fake child runs");
    ac2.abort();
    await assert.rejects(second, CursorAbortError);
  },
);

test(
  "a signal aborted before the call still ends the child: SIGTERM, then SIGKILL after the grace period",
  { skip: FAKE_AGENT_SKIP },
  async () => {
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
  },
);

test(
  "a grandchild holding the pipes neither survives the cancellation nor keeps the request alive",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const ac = new AbortController();
    const { pid, helperPid } = await withFake(["FAKE_GRANDCHILD"], async () => {
      const call = execute({ args: ["-p", "x"], timeoutMs: 10_000, signal: ac.signal });
      const started = { pid: await childPid(), helperPid: await helperPidOf() };
      assert.ok(alive(started.helperPid), "the helper runs");
      const aborted = Date.now();
      ac.abort();
      await assert.rejects(call, CursorAbortError);
      assert.ok(Date.now() - aborted < 5_000, "settled without waiting for the helper's 30 s");
      return started;
    });
    await sleep(100);
    assert.ok(!alive(pid), "the child is gone");
    assert.ok(!alive(helperPid), "the helper went with its process group");
  },
);

test(
  "a request cancelled while it waits for a slot leaves the queue at once; the running child is untouched",
  { skip: FAKE_AGENT_SKIP },
  async () => {
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
  },
);

test(
  "a leader that exits while a helper holds the pipes: the call settles with its output after the grace, the helper is killed",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const helperPid = await withFake(["FAKE_GRANDCHILD", "FAKE_EXITS_AT_ONCE"], async () => {
      const started = Date.now();
      const result = await execute({ args: ["-p", "x"], timeoutMs: 10_000, parseJson: false });
      const helperPid = await helperPidOf();
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "done", "what the leader wrote before it exited");
      assert.ok(Date.now() - started < 5_000, "settled without the helper's 30 s");
      return helperPid;
    });
    await sleep(100);
    assert.ok(!alive(helperPid), "the helper was signalled with the group");
  },
);

test(
  "a helper that ignores SIGTERM is SIGKILLed at the deadline even though the leader obeyed SIGTERM",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    await withFake(["FAKE_GRANDCHILD", "FAKE_STUBBORN_HELPER", "FAKE_OBEYS_TERM"], () =>
      assertHelperKilledAtDeadline("the helper survived SIGTERM (the leader did not)"),
    );
  },
);

test("the server's own SIGTERM ends every running cursor-agent group", { skip: FAKE_AGENT_SKIP }, async () => {
  await fresh();
  const server = spawnServer({ flags: ["FAKE_GRANDCHILD"] });
  const pid = await childPid();
  const helperPid = await helperPidOf();
  assert.ok(alive(pid) && alive(helperPid));
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  await sleep(200);
  assert.ok(!alive(pid), "the agent is gone with the server");
  assert.ok(!alive(helperPid), "its helper too");
});

test(
  "the server's shutdown signals SIGTERM first: an agent that exits on SIGTERM sees it",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const server = spawnServer({ flags: ["FAKE_TERM_MARK"], graceMs: 2000 });
    await childPid();
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
    assert.equal(await termMark(), "TERM", "the agent saw SIGTERM");
  },
);

test(
  "an exit the server cannot delay SIGKILLs every group: an agent that would exit on SIGTERM never sees one",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const server = spawnServer({ flags: ["FAKE_TERM_MARK"], graceMs: 2000, exitAfterMs: 700 });
    const pid = await childPid();
    await new Promise((r) => server.once("exit", r));
    await sleep(200);
    assert.ok(!alive(pid), "the agent did not outlive the server");
    assert.equal(await termMark(), "none", "SIGKILL, never SIGTERM, on an exit");
  },
);

test(
  "the server's shutdown reaches a helper whose leader already exited (the group outlives its leader)",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const server = spawnServer({
      call: { parseJson: false },
      flags: ["FAKE_GRANDCHILD", "FAKE_STUBBORN_HELPER", "FAKE_EXITS_AT_ONCE"],
      graceMs: 2000,
    });
    const pid = await childPid();
    const helperPid = await helperPidOf();
    await sleep(300); // the leader has exited, the helper's node is up and ignores SIGTERM
    assert.ok(!alive(pid), "the leader exited");
    assert.ok(alive(helperPid), "the helper lives on");
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
    await sleep(200);
    assert.ok(!alive(helperPid), "the helper was SIGKILLed by the server's shutdown");
  },
);

test(
  "a stubborn helper that redirected its stdio (the pipes close with the leader) is still SIGKILLed at the deadline",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    await withFake(["FAKE_GRANDCHILD", "FAKE_STUBBORN_HELPER", "FAKE_HELPER_NO_PIPES", "FAKE_OBEYS_TERM"], () =>
      assertHelperKilledAtDeadline("the helper survived SIGTERM and holds no pipe"),
    );
  },
);

test(
  "a second signal during the shutdown grace ends the server at once, SIGKILL first",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const server = spawnServer({
      call: { parseJson: false },
      flags: ["FAKE_GRANDCHILD", "FAKE_STUBBORN_HELPER", "FAKE_HELPER_NO_PIPES", "FAKE_EXITS_AT_ONCE"],
      graceMs: 20000,
    });
    await childPid();
    const helperPid = await helperPidOf();
    await sleep(300);
    assert.ok(alive(helperPid));
    const signalled = Date.now();
    server.kill("SIGTERM");
    await sleep(100);
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
    assert.ok(Date.now() - signalled < 5_000, "no 20 s grace after the second signal");
    await sleep(200);
    assert.ok(!alive(helperPid), "the helper was SIGKILLed before the server ended");
  },
);

test(
  "a cancelled call whose group died at once leaves nothing behind: the server's shutdown does not wait the grace",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const server = spawnServer({ flags: ["FAKE_OBEYS_TERM"], graceMs: 20000, abortAfterMs: 700 });
    const pid = await childPid();
    await sleep(1_000); // the abort happened, the leader obeyed SIGTERM, the group is empty
    assert.ok(!alive(pid));
    const signalled = Date.now();
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
    assert.ok(Date.now() - signalled < 3_000, "no 20 s grace for an empty group");
  },
);

test(
  "the tool handler passes the request signal on: handleCursorAgent is cancelled through it",
  { skip: FAKE_AGENT_SKIP },
  async () => {
    await fresh();
    const ac = new AbortController();
    const call = handleCursorAgent({ prompt: "x" }, { signal: ac.signal });
    await childPid();
    ac.abort();
    const result = await call.catch((e) => e);
    assert.ok(result instanceof CursorAbortError, String(result));
  },
);
