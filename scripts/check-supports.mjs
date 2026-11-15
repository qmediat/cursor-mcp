#!/usr/bin/env node
// @ts-check
// The README's "## Supports · version X.Y.Z" heading names the package version: exits 1 with one line naming both
// when they differ or the heading is missing, and with one line naming the file when README.md or package.json
// cannot be read. Reads both in the directory given as the first argument (default: the current directory, the
// package root under `npm run`).
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HEADING = /^## Supports · version (\S+)[ \t]*$/m;

/** @typedef {{ ok: true, version: string } | { ok: false, message: string }} Verdict */

/**
 * @param {string} readme the README text
 * @param {string} packageVersion the version in package.json
 * @returns {Verdict}
 */
export function checkSupports(readme, packageVersion) {
  const found = HEADING.exec(readme)?.[1];
  if (found === undefined) {
    return {
      ok: false,
      message: `README.md has no "## Supports · version X.Y.Z" heading; package.json is ${packageVersion}`,
    };
  }
  if (found !== packageVersion) {
    return { ok: false, message: `README.md "Supports" names version ${found}; package.json is ${packageVersion}` };
  }
  return { ok: true, version: packageVersion };
}

/**
 * @param {string} root the package directory
 * @returns {Verdict}
 */
export function checkPackage(root) {
  try {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return checkSupports(readme, String(version));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `check-supports: README.md or package.json in ${root} cannot be read: ${reason}` };
  }
}

/**
 * @param {string[]} argv the arguments after the script's name
 * @returns {number} the exit code
 */
export function main(argv) {
  const verdict = checkPackage(argv[0] ?? process.cwd());
  if (!verdict.ok) {
    console.error(verdict.message);
    return 1;
  }
  console.log(`README.md "Supports" names version ${verdict.version}, as package.json does`);
  return 0;
}

/** @returns {boolean} whether this file is the program node runs (not a module another file imports) */
function isProgram() {
  const self = fileURLToPath(import.meta.url);
  const started = process.argv[1] ?? "";
  try {
    return Boolean(started) && realpathSync(started) === realpathSync(self);
  } catch {
    return resolve(started) === self; // a path realpath cannot resolve still names this file when node started it
  }
}

if (isProgram()) process.exitCode = main(process.argv.slice(2));
