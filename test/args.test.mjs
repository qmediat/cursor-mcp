// The pure pieces of the tools, tested without spawning cursor-agent: the argv each tool builds, the model id
// contract, the concurrency parser and the models-output cleaner. Runs on the built package (`npm test` builds first).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCursorAgentArgs, cursorAgentInputSchema } from "../dist/tools/cursor-agent.js";
import { buildCursorReplyArgs } from "../dist/tools/cursor-reply.js";
import { cleanModelsOutput } from "../dist/tools/cursor-models.js";
import { parseMaxConcurrency } from "../dist/executor.js";

test("any model id cursor-agent could accept passes the schema and reaches --model; `auto` sends no --model", () => {
  for (const id of ["composer-2.5", "cursor/claude-opus-5.5", "grok-4.7", "gpt-5.6-sol"]) {
    assert.equal(cursorAgentInputSchema.safeParse({ prompt: "x", model: id }).success, true, id);
    assert.deepEqual(buildCursorAgentArgs({ prompt: "x", model: id }, {}).slice(-3), ["--model", id, "x"]);
  }
  assert.deepEqual(buildCursorAgentArgs({ prompt: "x", model: "auto" }, {}), ["-p", "--output-format", "json", "--trust", "x"]);
  for (const bad of ["", " ", "a b", "-x", "../etc"]) {
    assert.equal(cursorAgentInputSchema.safeParse({ prompt: "x", model: bad }).success, false, JSON.stringify(bad));
  }
});

test("--force is added only when the operator set CURSOR_ALLOW_YOLO=true, for cursor_agent AND cursor_reply", () => {
  const on = { CURSOR_ALLOW_YOLO: "true" };
  assert.ok(buildCursorAgentArgs({ prompt: "x" }, on).includes("--force"));
  assert.ok(!buildCursorAgentArgs({ prompt: "x" }, {}).includes("--force"));
  assert.ok(!buildCursorAgentArgs({ prompt: "x" }, { CURSOR_ALLOW_YOLO: "1" }).includes("--force"));
  assert.ok(buildCursorReplyArgs({ prompt: "y", session_id: "s1" }, on).includes("--force"));
  assert.ok(!buildCursorReplyArgs({ prompt: "y", session_id: "s1" }, {}).includes("--force"));
});

test("cursor_reply resumes the session and keeps --trust, mode flags and the prompt last", () => {
  assert.deepEqual(buildCursorReplyArgs({ prompt: "y", session_id: "s1", model: "composer-2.5" }, {}), [
    "-p", "--output-format", "json", "--trust", "--resume", "s1", "--model", "composer-2.5", "y",
  ]);
  assert.deepEqual(buildCursorAgentArgs({ prompt: "x", mode: "plan", workspace: "/w", cloud: true }, {}), [
    "-p", "--output-format", "json", "--trust", "--mode", "plan", "--workspace", "/w", "-c", "x",
  ]);
});

test("CURSOR_MAX_CONCURRENCY: a positive integer, else the default 3 (never a semaphore that blocks forever)", () => {
  assert.equal(parseMaxConcurrency(undefined), 3);
  assert.equal(parseMaxConcurrency(""), 3);
  assert.equal(parseMaxConcurrency("5"), 5);
  assert.equal(parseMaxConcurrency("1"), 1);
  for (const bad of ["0", "-1", "2.5", "abc", "NaN"]) assert.equal(parseMaxConcurrency(bad), 3, bad);
});

test("cursor_models: ANSI codes stripped, 'No models available' is an empty list, real output kept", () => {
  assert.equal(cleanModelsOutput("\u001b[2K\u001b[1mLoading models…\u001b[0m\nNo models available for this account.\n"), "");
  assert.equal(cleanModelsOutput(""), "");
  assert.equal(cleanModelsOutput("\u001b[32mcomposer-2.5\u001b[0m\ngpt-5.6-sol\n"), "composer-2.5\ngpt-5.6-sol");
});
