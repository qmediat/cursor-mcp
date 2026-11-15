// The README "Supports" check (scripts/check-supports.mjs) run as `npm run check:supports` runs it: on a package
// directory whose README heading matches its package.json version it exits 0; a differing or missing heading exits 1
// with one line naming both versions. Fixtures: test/fixtures/supports/<case>/{README.md,package.json}.
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
  assert.match(stderr, /^check-supports: README\.md or package\.json in .* cannot be read: .*\n$/);
});
