// The pure pieces of the tools, tested without spawning cursor-agent: the argv each tool builds, the model id
// contract, the concurrency parser and the models-output cleaner. Runs on the built package (`npm test` builds first).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCursorAgentArgs, cursorAgentInputSchema } from "../dist/tools/cursor-agent.js";
import { buildCursorReplyArgs, cursorReplyInputSchema } from "../dist/tools/cursor-reply.js";
import { cleanModelsOutput } from "../dist/tools/cursor-models.js";
import { parseKillGraceMs, parseMaxConcurrency } from "../dist/executor.js";

test("any model id cursor-agent could accept passes the schema and reaches --model; `auto` sends no --model", () => {
  for (const id of ["composer-2.5", "cursor/claude-opus-5.5", "grok-4.7", "gpt-5.6-sol"]) {
    assert.equal(cursorAgentInputSchema.safeParse({ prompt: "x", model: id }).success, true, id);
    assert.deepEqual(buildCursorAgentArgs({ prompt: "x", model: id }, {}).slice(-4), ["--model", id, "--", "x"]);
  }
  assert.deepEqual(buildCursorAgentArgs({ prompt: "x", model: "auto" }, {}), ["-p", "--output-format", "json", "--trust", "--", "x"]);
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
    "-p", "--output-format", "json", "--trust", "--resume", "s1", "--model", "composer-2.5", "--", "y",
  ]);
  assert.deepEqual(buildCursorAgentArgs({ prompt: "x", mode: "plan", workspace: "/w", cloud: true }, {}), [
    "-p", "--output-format", "json", "--trust", "--mode", "plan", "--workspace", "/w", "-c", "--", "x",
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

test("no argument injection: the prompt follows `--`, and a session id that looks like an option is refused", () => {
  // `cursor-agent --resume [chatId]` takes an optional value and `-f` is --force: before 1.1.0 a session_id of "-f"
  // became --force and a prompt "- fix the list" was an unknown option.
  const agent = buildCursorAgentArgs({ prompt: "- fix the list item" }, {});
  assert.equal(agent.at(-2), "--", "the prompt is the first operand after --");
  assert.equal(agent.at(-1), "- fix the list item");
  const reply = buildCursorReplyArgs({ prompt: "-f", session_id: "abc-123" }, {});
  assert.deepEqual(reply.slice(-2), ["--", "-f"]);
  assert.ok(!reply.slice(0, -1).includes("-f"));
  for (const bad of ["-f", "--force", "", " ", "a b", "x;y"]) {
    assert.equal(cursorReplyInputSchema.safeParse({ prompt: "x", session_id: bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(cursorReplyInputSchema.safeParse({ prompt: "x", session_id: "0f3e2a1b-aaaa-4bbb-8ccc-123456789abc" }).success, true);
});

test("cursor_models drops the CLI's 'Loading models…' status line and keeps the list", () => {
  const real = "\u001b[2K\u001b[GLoading models…\n\u001b[2K\u001b[1A\u001b[2K\u001b[Gauto - Auto\ncomposer-2.5 - Composer 2.5\n";
  assert.equal(cleanModelsOutput(real), "auto - Auto\ncomposer-2.5 - Composer 2.5");
  assert.equal(cleanModelsOutput("\u001b[2K\u001b[GLoading models…\n\u001b[2K\u001b[1A\u001b[2K\u001b[GNo models available for this account.\n"), "");
});

test("a workspace that reads as an option is rejected by the schema", () => {
  assert.equal(cursorAgentInputSchema.safeParse({ prompt: "x", workspace: "-f" }).success, false);
  assert.equal(cursorAgentInputSchema.safeParse({ prompt: "x", workspace: "/tmp/w" }).success, true);
});

test("a model list that mentions 'no models available' in a line is kept; only that answer alone is empty", () => {
  assert.equal(cleanModelsOutput("No models available for this account"), "");
  assert.equal(cleanModelsOutput("auto\ncomposer-2.5 (no models available on free plans)"), "auto\ncomposer-2.5 (no models available on free plans)");
});

test("CURSOR_KILL_GRACE_MS above what a timer can wait, and CURSOR_MAX_CONCURRENCY above 64, are the defaults", () => {
  assert.equal(parseKillGraceMs("2147483647"), 2147483647);
  assert.equal(parseKillGraceMs("2147483648"), 5000, "Node would fire this timer after 1 ms");
  assert.equal(parseKillGraceMs("300"), 300);
  assert.equal(parseMaxConcurrency("64"), 64);
  assert.equal(parseMaxConcurrency("1000000"), 3);
});
