// The address check (scripts/check-addresses.mjs) run as `npm run check:addresses` runs it: in a git repository whose
// tracked text files hold only qmediat.io addresses and the allowed ones it exits 0; any other address exits 1 with one
// `path:line: address` line; a directory git cannot list exits 2. Each case is a throwaway repository; a foreign
// address is assembled at run time so that this file holds none.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { addressesIn } from "../scripts/check-addresses.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-addresses.mjs", import.meta.url));
const FOREIGN = "someone" + "@elsewhere.test";

/**
 * Runs the check on a throwaway directory holding the given files; tracked by git unless `tracked` is false.
 * @param {Record<string, string>} files path → text
 * @param {boolean} [tracked]
 */
function runCheck(files, tracked = true) {
  const dir = mkdtempSync(join(tmpdir(), "addresses-"));
  try {
    for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
    if (tracked) {
      spawnSync("git", ["init", "-q"], { cwd: dir });
      spawnSync("git", ["add", "--", ...Object.keys(files)], { cwd: dir });
    }
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() };
    return spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8", env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an address in another domain fails with its path and line", () => {
  const run = runCheck({ "NOTES.md": `# notes\n\nwrite to ${FOREIGN} today\n` });
  assert.equal(run.status, 1);
  assert.equal(run.stderr, `NOTES.md:3: ${FOREIGN}\n`);
});

test("qmediat.io and the allowed addresses pass", () => {
  const text = [
    "dev@qmediat.io",
    "Security@QMediat.io",
    "12345+someone@users.noreply.github.com",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "jane@example.com, joe@example.org, ann@example.net",
  ].join("\n");
  const run = runCheck({ "AUTHORS.md": text });
  assert.equal(run.status, 0, run.stderr);
});

test("an npm scope, a version pin and a git remote are not addresses", () => {
  const text =
    'npx @qmediat.io/cursor-mcp@1.2.3 "@modelcontextprotocol/sdk@1.29.x" zod@3.x git@github.com:qmediat/x.git';
  assert.deepEqual(addressesIn(text), []);
  assert.equal(runCheck({ "README.md": text }).status, 0);
});

test("a binary file and package-lock.json are not read", () => {
  const run = runCheck({ "logo.bin": `\0${FOREIGN}`, "package-lock.json": `{ "author": "${FOREIGN}" }` });
  assert.equal(run.status, 0, run.stderr);
});

test("a directory git cannot list fails with exit 2 and one line", () => {
  const run = runCheck({ "NOTES.md": FOREIGN }, false);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^check-addresses: git cannot list the files of .*\n$/);
});

test("the repository's own tracked files pass", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});
