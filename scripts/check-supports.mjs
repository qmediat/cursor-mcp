#!/usr/bin/env node
// @ts-check
// Every file that carries the package version names package.json's: the README's "## Supports · version X.Y.Z"
// heading, server.json's `version` and every `packages[].version`, package-lock.json's `version` and
// `packages[""].version` (a version file that does not exist carries none). Exits 1 with one line per mismatch naming
// the file, the value found and package.json's version, and with one line naming the directory when README.md,
// package.json or a version file cannot be read. Reads them in the directory given as the first argument (default: the
// current directory, the package root under `npm run`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isProgram } from "./is-program.mjs";

const HEADING = /^## Supports · version (\S+)[ \t]*$/m;

/** @typedef {{ ok: true, version: string } | { ok: false, message: string }} Verdict */
/** @typedef {{ file: string, field: string, value: unknown }} VersionField */

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
 * The fields that carry the package version in server.json and package-lock.json.
 * @param {any} server the parsed server.json, or undefined when the file does not exist
 * @param {any} lock the parsed package-lock.json, or undefined when the file does not exist
 * @returns {VersionField[]}
 */
export function versionFields(server, lock) {
  /** @type {VersionField[]} */
  const fields = [];
  if (server !== undefined) {
    fields.push({ file: "server.json", field: "version", value: server.version });
    const packages = Array.isArray(server.packages) ? server.packages : [];
    packages.forEach((entry, index) => {
      fields.push({ file: "server.json", field: `packages[${index}].version`, value: entry?.version });
    });
  }
  if (lock !== undefined) {
    fields.push({ file: "package-lock.json", field: "version", value: lock.version });
    fields.push({ file: "package-lock.json", field: 'packages[""].version', value: lock.packages?.[""]?.version });
  }
  return fields;
}

/**
 * @param {VersionField[]} fields
 * @param {string} packageVersion the version in package.json
 * @returns {string[]} one line per field that names another version
 */
export function versionMismatches(fields, packageVersion) {
  return fields
    .filter((field) => field.value !== packageVersion)
    .map((field) => `${field.file} ${field.field} is ${shown(field.value)}; package.json is ${packageVersion}`);
}

/**
 * @param {unknown} value a version field's value
 * @returns {string} the value as a line shows it
 */
function shown(value) {
  if (value === undefined) return "missing";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * @param {string} path
 * @returns {any} the parsed JSON file, or undefined when it does not exist
 */
function readJsonIfPresent(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @param {string} dir the directory holding server.json and package-lock.json
 * @param {string} packageVersion the version in package.json
 * @returns {string[]} one line per version field of those files that names another version
 */
export function versionFileMismatches(dir, packageVersion) {
  const server = readJsonIfPresent(join(dir, "server.json"));
  const lock = readJsonIfPresent(join(dir, "package-lock.json"));
  return versionMismatches(versionFields(server, lock), packageVersion);
}

/**
 * @param {Verdict} readme the README's verdict
 * @param {string[]} mismatches the version files'
 * @returns {Verdict} the README's verdict when no version file differs; otherwise a failure, one line per mismatch
 */
function withMismatches(readme, mismatches) {
  const lines = readme.ok ? mismatches : [readme.message, ...mismatches];
  return lines.length === 0 ? readme : { ok: false, message: lines.join("\n") };
}

/**
 * @param {string} root the package directory
 * @returns {Verdict}
 */
export function checkPackage(root) {
  try {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const version = String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
    return withMismatches(checkSupports(readme, version), versionFileMismatches(root, version));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `check-supports: README.md, package.json or a version file in ${root} cannot be read: ${reason}`,
    };
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
  console.log(`README.md "Supports" and the version files name version ${verdict.version}, as package.json does`);
  return 0;
}

if (isProgram(import.meta.url)) process.exitCode = main(process.argv.slice(2));
