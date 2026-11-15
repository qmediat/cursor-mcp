// The address check (scripts/check-addresses.mjs) run as `npm run check:addresses` runs it: in a git repository whose
// tracked text files hold only qmediat.io addresses and the allowed ones it exits 0; any other address exits 1 with one
// `path:line: address` line; a directory git cannot list or a tracked file that cannot be read exits 2. Each case is a
// throwaway repository. The shared corpus (test/fixtures/address-corpus.json) holds the pattern's cases; every test
// address, there and here, is written with `(at)` for the at-sign and made an address by `withAtSign` at run time, so
// this file holds none.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { addressesIn, findingsIn, isAllowed, staleEntries } from "../scripts/check-addresses.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-addresses.mjs", import.meta.url));
/**
 * The corpus every implementation of the check shares; `(at)` stands for the at-sign, so the file holds no address.
 * A finding names its one `address`, or `addresses` in order for a line with several.
 * @type {{ findings: { line: string, address?: string, addresses?: string[] }[], clean: string[], allowed: string[] }}
 */
const CORPUS = JSON.parse(readFileSync(new URL("./fixtures/address-corpus.json", import.meta.url), "utf8"));
/** @param {string} text written with `(at)` for the at-sign @returns {string} the text with the at-sign */
const withAtSign = (text) => text.replaceAll("(at)", "@");
const FOREIGN = withAtSign("someone(at)elsewhere.test");
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

/**
 * Runs the check on one file of `lines` and asserts that line N reports `found[N]`, in order, and nothing else.
 * @param {string[]} lines
 * @param {string[][]} found the addresses each line holds
 */
function assertEachFound(lines, found) {
  const run = runCheck(makeRepo({ "NOTES.md": lines.join("\n") }));
  assert.equal(run.status, 1);
  const expected = found.flatMap((addresses, index) =>
    addresses.map((address) => `NOTES.md:${index + 1}: ${address}\n`),
  );
  assert.equal(run.stderr, expected.join(""));
}

test("every corpus finding is reported as exactly its addresses, with its path and line", () => {
  const lines = CORPUS.findings.map(({ line }) => withAtSign(line));
  const found = CORPUS.findings.map(({ address, addresses }) => (addresses ?? [address ?? ""]).map(withAtSign));
  for (const [index, line] of lines.entries()) {
    assert.deepEqual(
      addressesIn(line).map(({ address }) => address),
      found[index],
      line,
    );
  }
  assertEachFound(lines, found);
});

test("no corpus clean line holds an address", () => {
  const lines = CORPUS.clean.map(withAtSign);
  for (const line of lines) assert.deepEqual(addressesIn(line), [], line);
  const run = runCheck(makeRepo({ "NOTES.md": lines.join("\n") }));
  assert.equal(run.status, 0, run.stderr);
});

test("every corpus allowed line holds an address that is found, then allowed", () => {
  const lines = CORPUS.allowed.map(withAtSign);
  for (const line of lines) {
    assert.deepEqual(
      addressesIn(line).map(({ address }) => address),
      [line],
      line,
    );
    assert.ok(isAllowed(line, "AUTHORS.md"), line);
  }
  const run = runCheck(makeRepo({ "AUTHORS.md": lines.join("\n") }));
  assert.equal(run.status, 0, run.stderr);
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

test("a repository entry matches its address in any case, as an allowed address and as a held one", () => {
  const entries = [{ file: "test/fixture.mjs", address: FOREIGN }];
  assert.deepEqual(findingsIn("test/fixture.mjs", FOREIGN.toUpperCase(), entries), []);
  assert.deepEqual(
    staleEntries(entries, () => `see ${FOREIGN.toUpperCase()}`),
    [],
  );
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
