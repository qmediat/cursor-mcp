// The stream-json path: a fake cursor-agent emits the documented events; the handler reports the model, the files
// changed and the answer in text and structuredContent, and sends one progress notification per event to a client
// that asked for progress. No real Cursor CLI involved.
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = await mkdtemp(join(tmpdir(), "cursor-mcp-stream-"));
const EVENTS = [
  { type: "system", subtype: "init", apiKeySource: "login", cwd: "/w", session_id: "s-1", model: "Composer 2.5", permissionMode: "default" },
  { type: "user", message: { role: "user", content: [{ type: "text", text: "fix it" }] }, session_id: "s-1" },
  { type: "tool_call", subtype: "started", call_id: "c1", tool_call: { readToolCall: { args: { path: "src/a.ts" } } }, session_id: "s-1" },
  { type: "tool_call", subtype: "completed", call_id: "c1", tool_call: { readToolCall: { args: { path: "src/a.ts" }, result: { success: { content: "x", isEmpty: false, exceededLimit: false, totalLines: 1, totalChars: 1 } } } }, session_id: "s-1" },
  { type: "tool_call", subtype: "completed", call_id: "c2", tool_call: { editToolCall: { args: { path: "src/a.ts" }, result: { success: {} } } }, session_id: "s-1" },
  { type: "tool_call", subtype: "completed", call_id: "c3", tool_call: { writeToolCall: { args: { path: "src/b.ts" }, result: { success: {} } } }, session_id: "s-1" },
  { type: "tool_call", subtype: "completed", call_id: "c4", tool_call: { editToolCall: { args: { path: "src/a.ts" }, result: { success: {} } } }, session_id: "s-1" },
  { type: "tool_call", subtype: "completed", call_id: "c5", tool_call: { editToolCall: { args: { path: "src/c.ts" }, result: { rejected: { reason: "no --force" } } } }, session_id: "s-1" },
  { type: "tool_call", subtype: "completed", call_id: "c6", tool_call: { shellToolCall: { args: { command: "rm -f src/d.ts" }, result: { success: {} } } }, session_id: "s-1" },
  { type: "tool_call", subtype: "completed", call_id: "c7", tool_call: { writeToolCall: { args: { path: "src/e.ts" }, result: { success: false } } }, session_id: "s-1" },
  { type: "tool_call", subtype: "completed", call_id: "c8", tool_call: { editToolCall: { args: { path: "src/c.ts" }, result: { success: { applied: true } } } }, session_id: "s-1" },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done." }] }, session_id: "s-1" },
  "this line is not JSON",
  { type: "result", subtype: "success", is_error: false, duration_ms: 1234, duration_api_ms: 1000, result: "Done.", session_id: "s-1", request_id: "r-9" },
];
/** Writes the one fake the executor resolves (it caches the binary's path): the given lines, strings as-is, objects
 * as JSON, optionally split at a byte offset with a pause between the halves. */
async function writeFake(lines, splitAt = 0) {
  const text = `${lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")}\n`;
  await writeFile(
    join(dir, "cursor-agent"),
    `#!/usr/bin/env node
const out = Buffer.from(${JSON.stringify(text)}, "utf8");
const at = ${splitAt};
if (at > 0) { process.stdout.write(out.subarray(0, at)); setTimeout(() => process.stdout.write(out.subarray(at)), 50); }
else process.stdout.write(out);
`,
  );
  await chmod(join(dir, "cursor-agent"), 0o755);
}
await writeFake(EVENTS);
process.env.PATH = `${dir}:${process.env.PATH}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { handleCursorAgent } = await import("../dist/tools/cursor-agent.js");
const { handleCursorReply } = await import("../dist/tools/cursor-reply.js");
const { NdjsonParser } = await import("../dist/stream.js");

test("cursor_agent reports the model, the files changed (once each) and the answer, in text and structuredContent", async () => {
  const notifications = [];
  const extra = {
    progressToken: "tok-1",
    sendNotification: async (n) => {
      notifications.push(n);
    },
  };
  const result = await handleCursorAgent({ prompt: "fix it" }, extra);
  const s = result.structuredContent;
  assert.equal(s.result, "Done.");
  assert.equal(s.status, "success");
  assert.equal(s.is_error, false);
  assert.equal(s.session_id, "s-1");
  assert.equal(s.request_id, "r-9");
  assert.equal(s.exit_code, 0);
  assert.equal(s.model, "Composer 2.5");
  assert.equal(s.duration_ms, 1234);
  assert.equal(s.tool_calls, 8, "completed tool calls, started ones not counted twice");
  assert.deepEqual(s.files_changed, ["src/a.ts", "src/b.ts", "src/c.ts"], "write/edit targets whose success is a value, each once; c.ts succeeded later and left the proposed list");
  assert.deepEqual(s.files_proposed, ["src/e.ts"], "success: false is not applied");
  assert.equal(s.noise_lines, 1, "the non-JSON line is counted, never dropped");
  assert.deepEqual(s.noise_sample, ["this line is not JSON"]);
  const text = result.content[0].text;
  assert.ok(text.startsWith("Done."));
  assert.ok(text.includes("Model: Composer 2.5"));
  assert.ok(text.includes("Files changed:\n  src/a.ts\n  src/b.ts"));
  assert.ok(text.includes("not applied (no --force, refused or failed):\n  src/e.ts"));
  assert.ok(text.includes("Non-event stdout lines: 1"));
  assert.equal(notifications.length, 10, "one per interpreted event: init, 8 completed tool calls, 1 assistant message");
  assert.ok(notifications.some((n) => n.params.message.includes("editToolCall src/c.ts (not applied)")));
  assert.ok(notifications.every((n) => n.method === "notifications/progress" && n.params.progressToken === "tok-1"));
  assert.ok(notifications.some((n) => n.params.message.includes("editToolCall src/a.ts")));
  assert.deepEqual(notifications.map((n) => n.params.progress), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "one counter, one step per event");
});

test("a client without a progress token gets the same report and no notification", async () => {
  let sent = 0;
  const result = await handleCursorReply({ prompt: "more", session_id: "s-1" }, { sendNotification: async () => { sent += 1; } });
  assert.equal(result.structuredContent.session_id, "s-1");
  assert.equal(result.structuredContent.model, "Composer 2.5");
  assert.equal(sent, 0);
});

test("the NDJSON parser keeps a non-JSON line as noise and parses a result without a trailing newline", () => {
  const events = [];
  const noise = [];
  const parser = new NdjsonParser((e) => events.push(e), (l) => noise.push(l));
  parser.feed('{"type":"system","subtype":"init","model":"m"}\nnot json\n{"type":"result","subtype":"success"');
  parser.feed(',"is_error":false}');
  parser.end();
  assert.deepEqual(events.map((e) => e.type), ["system", "result"]);
  assert.deepEqual(noise, ["not json"]);
});

test("a result event with null fields does not crash the server; the nulls become absent fields", async () => {
  await writeFake([
    { type: "system", subtype: "init", model: "m", session_id: "s-2" },
    { type: "result", subtype: "error", is_error: true, result: null, request_id: null, session_id: "s-2" },
  ]);
  const { execute } = await import("../dist/executor.js");
  const r = await execute({ args: ["-p", "x"], timeoutMs: 10_000, onEvent: () => {} });
  assert.equal(r.parsed.subtype, "error");
  assert.equal("result" in r.parsed, false);
});

test("a multi-byte character split across stdout chunks is decoded whole", async () => {
  const text = "Zażółć gęślą jaźń";
  const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: "s-3" });
  const at = Buffer.from(line, "utf8").indexOf(Buffer.from("ż", "utf8")) + 1; // inside the two-byte ż
  await writeFake([line], at);
  const { execute } = await import("../dist/executor.js");
  const r = await execute({ args: ["-p", "x"], timeoutMs: 10_000, onEvent: () => {} });
  assert.equal(r.parsed.result, text);
});

test("no result event: the last assistant message is the answer, the status says so, the run is an error, the init session is kept", async () => {
  await writeFake([
    { type: "system", subtype: "init", model: "m", session_id: "s-4" },
    { type: "tool_call", subtype: "completed", call_id: "c1", tool_call: { readToolCall: { args: { path: "secret.txt" }, result: { success: { content: "TOP SECRET" } } } } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Half done" }] } },
  ]);
  const result = await handleCursorAgent({ prompt: "x" });
  const s = result.structuredContent;
  assert.equal(s.status, "no-result-event");
  assert.equal(s.is_error, true);
  assert.equal(s.result, "Half done", "never the raw transcript");
  assert.equal(s.session_id, "s-4");
  assert.ok(!result.content[0].text.includes("TOP SECRET"));
});

test("an observer that throws synchronously or whose notification rejects never fails the run", async () => {
  await writeFake(EVENTS);
  const notifications = [];
  const extra = {
    progressToken: 7,
    sendNotification: async (n) => {
      notifications.push(n);
      throw new Error("client gone");
    },
  };
  const result = await handleCursorAgent({ prompt: "fix it" }, extra);
  assert.equal(result.structuredContent.status, "success");
  assert.ok(notifications.length > 0);
  const { execute } = await import("../dist/executor.js");
  const r = await execute({
    args: ["-p", "x"],
    timeoutMs: 10_000,
    onEvent: () => {
      throw new Error("sync observer failure");
    },
  });
  assert.equal(r.parsed.subtype, "success");
});

test("a run that exits non-zero but printed a result event reports that result, not a generic CLI error", async () => {
  await writeFake([
    { type: "system", subtype: "init", model: "m", session_id: "s-5" },
    { type: "result", subtype: "error", is_error: true, result: "The model refused", session_id: "s-5" },
  ]);
  const path = join(dir, "cursor-agent");
  const { readFile: rf } = await import("node:fs/promises");
  await writeFile(path, `${await rf(path, "utf8")}process.exitCode = 1;\n`);
  const result = await handleCursorAgent({ prompt: "x" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, "error");
  assert.equal(result.structuredContent.result, "The model refused");
  assert.equal(result.structuredContent.session_id, "s-5");
  assert.equal(result.structuredContent.exit_code, 1, "the CLI's exit code is reported beside the agent's result");
  assert.ok(result.content[0].text.includes("Exit code: 1"));
});

test("a result event whose optional fields are null is still the result", async () => {
  await writeFake([{ type: "result", subtype: null, is_error: null, duration_ms: null, duration_api_ms: null, result: "ok", session_id: "s-7", request_id: null }]);
  const result = await handleCursorAgent({ prompt: "x" });
  assert.equal(result.structuredContent.result, "ok");
  assert.equal(result.structuredContent.status, "unknown");
  assert.equal(result.structuredContent.exit_code, 0);
});

test("a lone init line is not a run's result; an init without a model still gives the session", async () => {
  await writeFake([{ type: "system", subtype: "init", session_id: "s-6" }]);
  const result = await handleCursorAgent({ prompt: "x" });
  assert.equal(result.structuredContent.status, "no-result-event");
  assert.equal(result.structuredContent.session_id, "s-6");
  assert.equal(result.structuredContent.model, null);
});

test("a stream cut before any assistant message: the stdout sample is the answer, never '(no output)'", async () => {
  await writeFake(["Loading…", "error: the agent crashed"]);
  const result = await handleCursorAgent({ prompt: "x" });
  assert.equal(result.structuredContent.status, "no-result-event");
  assert.equal(result.structuredContent.result, "", "CLI noise is never presented as the agent's answer");
  assert.deepEqual(result.structuredContent.noise_sample, ["Loading…", "error: the agent crashed"]);
  assert.ok(result.content[0].text.includes("Non-event stdout (sample):\n  Loading…\n  error: the agent crashed"));
});

test("every progress notification has landed before the result returns, even a slow client", async () => {
  await writeFake(EVENTS);
  let landed = 0;
  const extra = {
    progressToken: "slow",
    sendNotification: async () => {
      await sleep(30);
      landed += 1;
    },
  };
  const result = await handleCursorAgent({ prompt: "fix it" }, extra);
  assert.equal(result.structuredContent.status, "success");
  assert.equal(landed, 10, "no notification arrives after the result");
});
