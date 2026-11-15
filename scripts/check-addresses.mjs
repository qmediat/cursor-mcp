#!/usr/bin/env node
// @ts-check
// Every email address in a tracked text file is in qmediat.io, or on the short list of addresses that are not anyone's
// mailbox (GitHub's noreply domain, the reserved example domains, a commit trailer, this repository's fixtures). Exits
// 1 with one line per other address, `path:line: address`, and 2 with one line when git cannot list the tracked files.
// Scans the repository given as the first argument (default: the repository holding this script). Binary files (a NUL
// in the first 8000 bytes, git's own test) and package-lock.json are not read.
import { lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isProgram } from "./is-program.mjs";

// A local part, "@", and a domain of dot-separated labels ending in letters; not followed by more of a name or by
// ":path" (a `git@host:owner/repo` remote). An npm scope (`@scope/name`) has no local part and never matches.
const ADDRESS = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]+)(?![\w-]|\.\w|:[\w/~])/g;
// `name@1.2.3`, `name@1.50.x`: a package pinned to a version, not an address.
const VERSION_PIN = /^\d+(?:\.(?:\d+|x))+$/i;
const ALLOWED_DOMAINS = new Set([
  "qmediat.io",
  "users.noreply.github.com",
  "example.com",
  "example.org",
  "example.net",
]);
/** Addresses this repository's own fixtures need, each named with the file that holds it. */
const REPOSITORY_ADDRESSES = /** @type {string[]} */ ([]);
const ALLOWED_ADDRESSES = new Set(["noreply@anthropic.com", ...REPOSITORY_ADDRESSES]);
const SKIPPED_FILES = new Set(["package-lock.json"]);
const BINARY_PROBE_BYTES = 8000;

/** @typedef {{ line: number, address: string }} Address */
/** @typedef {{ ok: true, files: string[] } | { ok: false, message: string }} Listing */

/**
 * @param {string} text a file's text
 * @returns {Address[]} every address in it, with its 1-based line
 */
export function addressesIn(text) {
  return text
    .split("\n")
    .flatMap((lineText, index) =>
      [...lineText.matchAll(ADDRESS)]
        .filter((match) => !VERSION_PIN.test(match[1] ?? ""))
        .map((match) => ({ line: index + 1, address: match[0] })),
    );
}

/**
 * @param {string} address
 * @returns {boolean} whether the address is in qmediat.io or on the allowed list
 */
export function isAllowed(address) {
  const lower = address.toLowerCase();
  const domain = lower.slice(lower.lastIndexOf("@") + 1);
  return ALLOWED_DOMAINS.has(domain) || ALLOWED_ADDRESSES.has(lower);
}

/**
 * @param {string} path the file's path, as the finding names it
 * @param {string} text the file's text
 * @returns {string[]} one `path:line: address` line per address that is not allowed
 */
export function findingsIn(path, text) {
  return addressesIn(text)
    .filter(({ address }) => !isAllowed(address))
    .map(({ line, address }) => `${path}:${line}: ${address}`);
}

/**
 * @param {string} root the repository
 * @returns {Listing} the tracked files, or the one line that says why git cannot list them
 */
export function trackedFiles(root) {
  const run = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return { ok: false, message: `check-addresses: git cannot run: ${run.error.message}` };
  if (run.status !== 0) {
    const reason = run.stderr.trim().split("\n")[0] ?? `exit ${run.status}`;
    return { ok: false, message: `check-addresses: git cannot list the files of ${root}: ${reason}` };
  }
  return { ok: true, files: run.stdout.split("\0").filter(Boolean) };
}

/**
 * @param {string} path the file on disk
 * @returns {string | undefined} its text, or undefined for a binary file, a skipped file or one not in the work tree
 */
function readText(path) {
  if (SKIPPED_FILES.has(basename(path))) return undefined;
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) return undefined;
  const bytes = readFileSync(path);
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return undefined;
  return bytes.toString("utf8");
}

/**
 * @param {string[]} argv the arguments after the script's name
 * @returns {number} the exit code
 */
export function main(argv) {
  const root = argv[0] ?? fileURLToPath(new URL("..", import.meta.url));
  const listing = trackedFiles(root);
  if (!listing.ok) {
    console.error(listing.message);
    return 2;
  }
  const findings = listing.files.flatMap((file) => {
    const text = readText(join(root, file));
    return text === undefined ? [] : findingsIn(file, text);
  });
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) return 1;
  console.log(`check-addresses: every address in the ${listing.files.length} tracked files is allowed`);
  return 0;
}

if (isProgram(import.meta.url)) process.exitCode = main(process.argv.slice(2));
