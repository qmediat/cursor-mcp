// The version check (scripts/check-supports.mjs) run as `npm run check:supports` runs it: on a package directory whose
// README heading, server.json and package-lock.json name its package.json version it exits 0; a differing or missing
// heading, a stale version field or a missing version file exits 1 with one line per mismatch. Fixtures:
// test/fixtures/supports/<case>/{README.md,package.json,server.json,package-lock.json}, one file left out where the
// case is about it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/check-supports.mjs", import.meta.url));

/** Runs the check on one fixture directory; returns its exit status and output. */
function runCheck(fixture) {
  const dir = fileURLToPath(new URL(`./fixtures/supports/${fixture}/`, import.meta.url));
  const run = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

test("a README whose Supports heading names the package version passes", () => {
  const { status, stderr } = runCheck("match");
  assert.equal(status, 0, stderr);
});

test("a README whose Supports heading names another version fails, naming both versions", () => {
  const { status, stderr } = runCheck("differ");
  assert.equal(status, 1);
  assert.match(stderr, /version 1\.2\.2; package\.json is 1\.2\.3/);
});

test("a README without the Supports heading fails, naming the package version", () => {
  const { status, stderr } = runCheck("missing");
  assert.equal(status, 1);
  assert.match(stderr, /no "## Supports · version X\.Y\.Z" heading; package\.json is 1\.2\.3/);
});

test("a directory without README.md fails with one line, not a stack trace", () => {
  const { status, stderr } = runCheck("absent");
  assert.equal(status, 1);
  assert.match(stderr, /^check-supports: README\.md, package\.json or a version file in .* cannot be read: .*\n$/);
});

test("server.json, package-lock.json and the README naming the package version pass, and the output says so", () => {
  const { status, stdout, stderr } = runCheck("match");
  assert.equal(status, 0, stderr);
  assert.match(stdout, /README\.md "Supports" and the version files name version 1\.2\.3/);
});

test("a stale top-level server.json version fails, naming the file, the value and the package version", () => {
  const { status, stderr } = runCheck("server-stale");
  assert.equal(status, 1);
  assert.equal(stderr, "server.json version is 1.2.2; package.json is 1.2.3\n");
});

test("a stale server.json packages[0].version fails, naming the field", () => {
  const { status, stderr } = runCheck("server-package-stale");
  assert.equal(status, 1);
  assert.equal(stderr, "server.json packages[0].version is 1.2.2; package.json is 1.2.3\n");
});

test("a stale package-lock.json root version fails, naming the field", () => {
  const { status, stderr } = runCheck("lock-stale");
  assert.equal(status, 1);
  assert.equal(stderr, 'package-lock.json packages[""].version is 1.2.2; package.json is 1.2.3\n');
});

test("two stale version fields fail with one line each", () => {
  const { status, stderr } = runCheck("two-stale");
  assert.equal(status, 1);
  assert.equal(
    stderr,
    "server.json version is 1.2.2; package.json is 1.2.3\npackage-lock.json version is 1.2.2; package.json is 1.2.3\n",
  );
});

test("a directory without server.json fails: the registry manifest is required", () => {
  const { status, stderr } = runCheck("server-absent");
  assert.equal(status, 1);
  assert.equal(stderr, "server.json is missing\n");
});

test("a server.json whose packages is not an array fails, naming it", () => {
  const { status, stderr } = runCheck("server-packages-object");
  assert.equal(status, 1);
  assert.equal(stderr, "server.json packages is not an array\n");
});

test("a directory without package-lock.json fails: the lockfile is required", () => {
  const { status, stderr } = runCheck("lock-absent");
  assert.equal(status, 1);
  assert.equal(stderr, "package-lock.json is missing\n");
});

test("a lockfile without a packages map (lockfileVersion 1) is checked on its root version only", () => {
  const { status, stderr } = runCheck("lock-v1");
  assert.equal(status, 0, stderr);
});
