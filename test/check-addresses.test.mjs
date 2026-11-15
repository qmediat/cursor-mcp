// The address check (scripts/check-addresses.mjs) run as `npm run check:addresses` runs it: in a git repository whose
// tracked text files hold only qmediat.io addresses and the allowed ones it exits 0; any other address exits 1 with one
// `path:line: address` line; a directory git cannot list or a tracked file that cannot be read exits 2. Each case is a
// throwaway repository; every foreign address is built at run time by `addressOf`, so that this file holds none.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { addressesIn, findingsIn, staleEntries } from "../scripts/check-addresses.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-addresses.mjs", import.meta.url));
/**
 * An address built at run time, so that this file holds none for the repository's own check to find.
 * @param {string} local
 * @param {string} domain
 */
const addressOf = (local, domain) => `${local}${"@"}${domain}`;
const FOREIGN = addressOf("someone", "elsewhere.test");
const ENV = { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() };
/** @type {string[]} */
const made = [];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * A throwaway directory holding the given files; a git repository tracking them unless `tracked` is false.
 * @param {Record<string, string>} files path → text
 * @param {boolean} [tracked]
 * @returns {string} the directory
 */
function makeRepo(files, tracked = true) {
  const dir = mkdtempSync(join(tmpdir(), "addresses-"));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  if (!tracked) return dir;
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir, env: ENV }).status, 0, "git init");
  assert.equal(spawnSync("git", ["add", "--", ...Object.keys(files)], { cwd: dir, env: ENV }).status, 0, "git add");
  return dir;
}

/**
 * @param {string} dir the repository to scan
 * @param {NodeJS.ProcessEnv} [env]
 */
function runCheck(dir, env = ENV) {
  return spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8", env });
}

/**
 * Tracks a symlink named `link.md` in the repository, pointing at `target`.
 * @param {string} dir
 * @param {string} target
 */
function trackLink(dir, target) {
  symlinkSync(target, join(dir, "link.md"));
  assert.equal(spawnSync("git", ["add", "--", "link.md"], { cwd: dir, env: ENV }).status, 0, "git add");
}

test("an address in another domain fails with its path and line", () => {
  const run = runCheck(makeRepo({ "NOTES.md": `# notes\n\nwrite to ${FOREIGN} today\n` }));
  assert.equal(run.status, 1);
  assert.equal(run.stderr, `NOTES.md:3: ${FOREIGN}\n`);
});

test("an address whose local part has letters outside ASCII fails too", () => {
  const accented = addressOf("Zoë.Łukasz", "elsewhere.test");
  const run = runCheck(makeRepo({ "NOTES.md": `write to ${accented}\n` }));
  assert.equal(run.status, 1);
  assert.equal(run.stderr, `NOTES.md:1: ${accented}\n`);
});

test("qmediat.io and the allowed addresses pass", () => {
  const text = [
    "dev@qmediat.io",
    "Security@QMediat.io",
    "12345+someone@users.noreply.github.com",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "jane@example.com, joe@example.org, ann@example.net",
  ].join("\n");
  const run = runCheck(makeRepo({ "AUTHORS.md": text }));
  assert.equal(run.status, 0, run.stderr);
});

/**
 * Runs the check on one file of `lines` and asserts that line N reports `found[N]`, and nothing else is reported.
 * @param {string[]} lines
 * @param {string[]} found
 */
function assertEachFound(lines, found) {
  const run = runCheck(makeRepo({ "NOTES.md": lines.join("\n") }));
  assert.equal(run.status, 1);
  assert.equal(run.stderr, found.map((address, index) => `NOTES.md:${index + 1}: ${address}\n`).join(""));
}

test("an npm scope, a version pin, an image file name and a git remote are not addresses", () => {
  const text = [
    'npx @qmediat.io/cursor-mcp@1.2.3 "@modelcontextprotocol/sdk@1.29.x"',
    "zod@3.x sdk@1.29.x pkg@1.x.x pkg@1.2.x.x name@1.0.0-alpha.beta",
    "![logo](logo@2x.png) ![icon](icon@3x.webp)",
    "git@github.com:owner/repo.git Git@github.com:o/r",
    "https://git@github.com/o/r ssh://git@github.com/o/r.git git+ssh://git@github.com/o/r.git",
  ].join("\n");
  assert.deepEqual(addressesIn(text), []);
  const run = runCheck(makeRepo({ "README.md": text }));
  assert.equal(run.status, 0, run.stderr);
});

test("an address followed by a path, a port or a colon is still an address", () => {
  const alice = addressOf("alice", "gmail.com");
  const someone = addressOf("someone", "foreign.invalid");
  const lines = [`https://${alice}/profile`, `see ${alice}/x`, `Contact ${someone}: details`, `${someone}:8080`];
  assertEachFound(lines, [alice, alice, someone, someone]);
});

test("only git, in scp form with a path or after a URL scheme, is a remote; any other git@ or local part is an address", () => {
  const git = addressOf("git", "github.com");
  const alice = addressOf("alice", "github.com");
  const dotted = addressOf("x.git", "github.com");
  const lines = [`${git}:8080`, `${git}:`, `${git}/qmediat/x.git`, `ssh://${alice}/o/r`, `${dotted}:owner/repo`];
  assertEachFound(lines, [git, git, git, alice, dotted]);
});

test("a host whose first label is a pixel scale is an address, not an image", () => {
  const found = [addressOf("bob", "2x.com"), addressOf("sales", "2x.io"), addressOf("info", "10x.media")];
  assertEachFound(found, found);
});

test("a host that only starts like a version is an address, not a version pin", () => {
  const found = [
    addressOf("bob", "1-pass.com"),
    addressOf("me", "123-reg.co.uk"),
    addressOf("info", "2-for-1.com"),
    addressOf("admin", "1-2.example.com"),
    addressOf("alice", "1.2.gmail.com"),
    addressOf("someone", "1.263.com"),
  ];
  assertEachFound(found, found);
});

test("a binary file and package-lock.json are not read", () => {
  const run = runCheck(makeRepo({ "logo.bin": `\0${FOREIGN}`, "package-lock.json": `{ "author": "${FOREIGN}" }` }));
  assert.equal(run.status, 0, run.stderr);
});

test("a tracked file that cannot be read exits 2 with one line", { skip: process.getuid?.() === 0 }, () => {
  const dir = makeRepo({ "NOTES.md": FOREIGN });
  chmodSync(join(dir, "NOTES.md"), 0o000);
  const run = runCheck(dir);
  chmodSync(join(dir, "NOTES.md"), 0o644);
  assert.equal(run.status, 2);
  assert.equal(run.stderr, "check-addresses: cannot read NOTES.md: EACCES\n");
});

test("a tracked file that vanished from the work tree exits 2 with one line", () => {
  const dir = makeRepo({ "NOTES.md": "nothing here\n" });
  rmSync(join(dir, "NOTES.md"));
  const run = runCheck(dir);
  assert.equal(run.status, 2);
  assert.equal(run.stderr, "check-addresses: cannot read NOTES.md: ENOENT\n");
});

test("a tracked symlink to a file inside the repository is read", () => {
  const dir = makeRepo({ "kept.md": "nothing here\n" });
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "notes", "target.md"), `write to ${FOREIGN}\n`);
  trackLink(dir, "notes/target.md");
  const run = runCheck(dir);
  assert.equal(run.status, 1);
  assert.equal(run.stderr, `link.md:1: ${FOREIGN}\n`);
});

test("a tracked symlink that leaves the repository exits 2, naming it a symlink", () => {
  const outside = makeRepo({ "elsewhere.md": FOREIGN }, false);
  const dir = makeRepo({ "kept.md": "nothing here\n" });
  trackLink(dir, join(outside, "elsewhere.md"));
  const run = runCheck(dir);
  assert.equal(run.status, 2);
  assert.equal(run.stderr, "check-addresses: cannot read link.md: not a file inside the repository (symlink)\n");
});

test("a directory git cannot list fails with exit 2 and one line", () => {
  const run = runCheck(makeRepo({ "NOTES.md": FOREIGN }, false));
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^check-addresses: git cannot list the files of .*: fatal: .*\n$/);
});

test("a git that fails without a word is named by its exit status", () => {
  const bin = makeRepo({ git: "#!/bin/sh\nexit 3\n" }, false);
  chmodSync(join(bin, "git"), 0o755);
  const run = runCheck(bin, { ...ENV, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^check-addresses: git cannot list the files of .*: exit 3\n$/);
});

test("a repository entry allows its address only in its own file", () => {
  const entries = [{ file: "test/fixture.mjs", address: FOREIGN }];
  assert.deepEqual(findingsIn("test/fixture.mjs", FOREIGN, entries), []);
  assert.deepEqual(findingsIn("scripts/check-addresses.mjs", FOREIGN, entries), [], "the script that lists it");
  assert.deepEqual(findingsIn("README.md", FOREIGN, entries), [`README.md:1: ${FOREIGN}`]);
});

test("a repository entry whose file no longer holds its address is reported", () => {
  const entries = [{ file: "test/fixture.mjs", address: FOREIGN }];
  assert.deepEqual(
    staleEntries(entries, () => FOREIGN),
    [],
  );
  assert.deepEqual(
    staleEntries(entries, () => "gone"),
    [`check-addresses: test/fixture.mjs no longer holds ${FOREIGN}: remove its allowlist entry`],
  );
});

test("the repository's own tracked files pass", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});
