#!/usr/bin/env node
// @ts-check
// The README's "## Supports · version X.Y.Z" heading names the package version: exits 1 with one line naming both
// when they differ or the heading is missing. Reads README.md and package.json in the directory given as the first
// argument (default: the current directory, the package root under `npm run`).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HEADING = /^## Supports · version (\S+)[ \t]*$/m;

/** @typedef {{ ok: true } | { ok: false, message: string }} Verdict */

/**
 * @param {string} readme the README text
 * @param {string} packageVersion the version in package.json
 * @returns {Verdict}
 */
function checkSupports(readme, packageVersion) {
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
  return { ok: true };
}

/** @param {string} root the package directory */
function main(root) {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const verdict = checkSupports(readme, String(version));
  if (!verdict.ok) {
    console.error(verdict.message);
    process.exit(1);
  }
  console.log(`README.md "Supports" names version ${version}, as package.json does`);
}

main(process.argv[2] ?? process.cwd());
