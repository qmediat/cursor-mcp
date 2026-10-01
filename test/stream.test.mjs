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
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done." }] }, session_id: "s-1" },
  "this line is not JSON",
  { type: "result", subtype: "success", is_error: false, duration_ms: 1234, duration_api_ms: 1000, result: "Done.", session_id: "s-1", request_id: "r-9" },
];
await writeFile(
  join(dir, "cursor-agent"),
  `#!/usr/bin/env node
const events = ${JSON.stringify(EVENTS)};
for (const e of events) process.stdout.write((typeof e === "string" ? e : JSON.stringify(e)) + "\\n");
`,
);
await chmod(join(dir, "cursor-agent"), 0o755);
process.env.PATH = `${dir}:${process.env.PATH}`;

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
  assert.equal(s.model, "Composer 2.5");
  assert.equal(s.duration_ms, 1234);
  assert.equal(s.tool_calls, 4, "completed tool calls, started ones not counted twice");
  assert.deepEqual(s.files_changed, ["src/a.ts", "src/b.ts"], "write/edit targets, each once; the read is not a change");
  const text = result.content[0].text;
  assert.ok(text.startsWith("Done."));
  assert.ok(text.includes("Model: Composer 2.5"));
  assert.ok(text.includes("Files changed:\n  src/a.ts\n  src/b.ts"));
  assert.ok(notifications.length >= 6, `one progress notification per interpreted event (${notifications.length})`);
  assert.ok(notifications.every((n) => n.method === "notifications/progress" && n.params.progressToken === "tok-1"));
  assert.ok(notifications.some((n) => n.params.message.includes("editToolCall src/a.ts")));
  const progress = notifications.map((n) => n.params.progress);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b), "progress only grows");
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
