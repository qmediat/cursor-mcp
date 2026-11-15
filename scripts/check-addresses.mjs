#!/usr/bin/env node
// @ts-check
// Every email address in a tracked text file is in qmediat.io, or on the short list of addresses that are not anyone's
// mailbox (GitHub's noreply domain, the reserved example domains, a commit trailer, this repository's fixtures — each
// allowed only in its own file). Exits 1 with one line per other address, `path:line: address`, and per allowlist
// entry whose file no longer holds its address; 2 ("cannot tell") with one line when git cannot list the tracked files
// and one per tracked file that cannot be read — a symlink is read when it resolves to a regular file inside the
// repository. Scans the repository given as the first argument (default: the repository holding this script). Binary
// files (a NUL in the first 8192 bytes, git's own test) and package-lock.json are not scanned.
import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { isProgram } from "./is-program.mjs";

// A local part (letters of any script), "@", and a domain of dot-separated labels ending in letters, not followed by
// more of a name. A path or a port after it does not change that: `https://alice@example.com/x` and
// `alice@example.com:8080` are addresses. An npm scope (`@scope/name`) has no local part and never matches.
const ADDRESS = /([\p{L}\p{N}._%+-]+)@((?:[A-Za-z0-9-]+\.)+[A-Za-z]+)(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])/gu;
// A package pinned to a version: numeric or `x` labels ending in `.x` (`zod@3.x`, `pkg@1.2.x.x`), or a three-part
// numeric core with a prerelease (`name@1.0.0-alpha.beta`); a domain such as `1-pass.com` or `1.263.com` is a host.
const VERSION_PIN = /^(?:\d+(?:\.(?:\d+|x))*\.x|\d+\.\d+\.\d+-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)$/i;
// An image file at a pixel scale, the whole domain being the file name (`logo@2x.png`, `icon@3x.webp`); a domain such
// as `2x.com` is a host.
const IMAGE_SCALE = /^\d+x\.(?:png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;
// A git remote in scp form: `git@example.com:owner/repo.git`, a colon then a path with a `/` (a port is not one).
const SCP_PATH = /^:\S*\//;
// A URL scheme just before the local part: `ssh://`, `git+ssh://`, `https://`. `git@example.com/owner/repo.git`
// without one is not a form git takes as a remote, so it stays an address.
const SCHEME_BEFORE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/$/;
const ALLOWED_DOMAINS = new Set([
  "qmediat.io",
  "users.noreply.github.com",
  "example.com",
  "example.org",
  "example.net",
]);
const ALLOWED_ADDRESSES = new Set(["noreply@anthropic.com"]);
/**
 * Addresses this repository's own files need, each allowed only in the file named: none here.
 * @type {AllowedEntry[]}
 */
export const REPOSITORY_ADDRESSES = [];
const SKIPPED_FILES = new Set(["package-lock.json"]);
// The file that lists the repository's entries names their addresses too.
const SELF = "scripts/check-addresses.mjs";
const BINARY_PROBE_BYTES = 8192;
const OWN_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** @typedef {{ file: string, address: string }} AllowedEntry */
/** @typedef {{ line: number, address: string }} Address */
/** @typedef {{ ok: true, files: string[] } | { ok: false, message: string }} Listing */
/** @typedef {{ kind: "text", text: string } | { kind: "skipped" } | { kind: "unreadable", reason: string }} FileText */

/**
 * @param {string} address
 * @returns {string} its domain, lower-cased: what every rule about domains reads
 */
function domainOf(address) {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * @param {RegExpMatchArray} match an ADDRESS match in `lineText`
 * @param {string} lineText
 * @returns {boolean} whether it is a git remote: local part `git` (any case), in scp form, or after a URL scheme and
 *   followed by `/` or `:`
 */
function isGitRemote(match, lineText) {
  if ((match[1] ?? "").toLowerCase() !== "git") return false;
  const start = match.index ?? 0;
  const after = lineText.slice(start + match[0].length);
  if (SCP_PATH.test(after)) return true;
  return SCHEME_BEFORE.test(lineText.slice(0, start)) && /^[/:]/.test(after);
}

/**
 * @param {RegExpMatchArray} match an ADDRESS match in `lineText`
 * @param {string} lineText
 * @returns {boolean} whether it names a mailbox: not a version pin, an image file name or a git remote
 */
function isAddress(match, lineText) {
  const domain = domainOf(match[0]);
  return !VERSION_PIN.test(domain) && !IMAGE_SCALE.test(domain) && !isGitRemote(match, lineText);
}

/**
 * @param {string} text a file's text
 * @returns {Address[]} every address in it, with its 1-based line
 */
export function addressesIn(text) {
  return text
    .split("\n")
    .flatMap((lineText, index) =>
      [...lineText.matchAll(ADDRESS)]
        .filter((match) => isAddress(match, lineText))
        .map((match) => ({ line: index + 1, address: match[0] })),
    );
}

/**
 * @param {string} address
 * @param {string} file the tracked path the address was found in
 * @param {AllowedEntry[]} [entries] the repository's own allowed addresses
 * @returns {boolean} whether the address is in qmediat.io, on the allowed list, or allowed in this file (an entry's
 *   own file, or this script, which lists it)
 */
export function isAllowed(address, file, entries = REPOSITORY_ADDRESSES) {
  const lower = address.toLowerCase();
  const domain = domainOf(address);
  if (ALLOWED_DOMAINS.has(domain) || ALLOWED_ADDRESSES.has(lower)) return true;
  return entries.some((entry) => (entry.file === file || file === SELF) && entry.address.toLowerCase() === lower);
}

/**
 * @param {string} path the file's path, as the finding names it
 * @param {string} text the file's text
 * @param {AllowedEntry[]} [entries] the repository's own allowed addresses
 * @returns {string[]} one `path:line: address` line per address that is not allowed
 */
export function findingsIn(path, text, entries = REPOSITORY_ADDRESSES) {
  return addressesIn(text)
    .filter(({ address }) => !isAllowed(address, path, entries))
    .map(({ line, address }) => `${path}:${line}: ${address}`);
}

/**
 * @param {AllowedEntry[]} entries the repository's own allowed addresses
 * @param {(file: string) => string | undefined} textOf a tracked file's text, or undefined when it has none
 * @returns {string[]} one line per entry whose file no longer holds its address
 */
export function staleEntries(entries, textOf) {
  return entries
    .filter((entry) => !(textOf(entry.file) ?? "").includes(entry.address))
    .map((entry) => `check-addresses: ${entry.file} no longer holds ${entry.address}: remove its allowlist entry`);
}

/**
 * @param {string} root the repository
 * @returns {Listing} the tracked files, or the one line that says why git cannot list them
 */
export function trackedFiles(root) {
  const run = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return { ok: false, message: `check-addresses: git cannot run: ${run.error.message}` };
  if (run.status !== 0) {
    const reason = run.stderr.split("\n")[0]?.trim() || `exit ${run.status}`;
    return { ok: false, message: `check-addresses: git cannot list the files of ${root}: ${reason}` };
  }
  return { ok: true, files: run.stdout.split("\0").filter(Boolean) };
}

/**
 * @param {unknown} error
 * @returns {string} the error's code (EACCES, ENOENT …), else its message
 */
function reasonOf(error) {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} path a regular file
 * @returns {FileText} its text, or skipped when its first bytes hold a NUL (only those bytes are read then)
 */
function readRegular(path) {
  const probe = Buffer.alloc(BINARY_PROBE_BYTES);
  const fd = openSync(path, "r");
  try {
    const length = readSync(fd, probe, 0, BINARY_PROBE_BYTES, 0);
    if (probe.subarray(0, length).includes(0)) return { kind: "skipped" };
  } finally {
    closeSync(fd);
  }
  return { kind: "text", text: readFileSync(path, "utf8") };
}

/**
 * @param {string} root the repository
 * @param {string} path a symlink inside it
 * @returns {FileText} its target's text when the target is a regular file inside the repository, else unreadable
 */
function readSymlink(root, path) {
  try {
    const target = realpathSync(path);
    const inside = relative(realpathSync(root), target);
    if (inside.startsWith("..") || isAbsolute(inside) || !statSync(target).isFile()) {
      return { kind: "unreadable", reason: "not a file inside the repository (symlink)" };
    }
    return readRegular(target);
  } catch (error) {
    return { kind: "unreadable", reason: `${reasonOf(error)} (symlink)` };
  }
}

/**
 * @param {string} root the repository
 * @param {string} file a tracked path
 * @returns {FileText} its text; skipped for package-lock.json, a binary file or a directory (a submodule)
 */
export function readTracked(root, file) {
  if (SKIPPED_FILES.has(basename(file))) return { kind: "skipped" };
  const path = join(root, file);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return readSymlink(root, path);
    return stat.isFile() ? readRegular(path) : { kind: "skipped" };
  } catch (error) {
    return { kind: "unreadable", reason: reasonOf(error) };
  }
}

/**
 * @param {string} root a repository
 * @returns {AllowedEntry[]} this repository's entries when root is the repository holding this script; none elsewhere
 */
function entriesFor(root) {
  return realpathSync(root) === realpathSync(OWN_ROOT) ? REPOSITORY_ADDRESSES : [];
}

/**
 * @param {string} root the repository
 * @param {string[]} files its tracked paths
 * @returns {{ findings: string[], unreadable: string[] }} the address lines and the files that cannot be read
 */
export function scan(root, files) {
  const entries = entriesFor(root);
  /** @type {Map<string, string>} */
  const texts = new Map();
  /** @type {string[]} */
  const unreadable = [];
  for (const file of files) {
    const read = readTracked(root, file);
    if (read.kind === "text") texts.set(file, read.text);
    if (read.kind === "unreadable") unreadable.push(`check-addresses: cannot read ${file}: ${read.reason}`);
  }
  const findings = [...texts].flatMap(([file, text]) => findingsIn(file, text, entries));
  findings.push(...staleEntries(entries, (file) => texts.get(file)));
  return { findings, unreadable };
}

/**
 * @param {string[]} argv the arguments after the script's name
 * @returns {number} the exit code
 */
export function main(argv) {
  const root = argv[0] ?? OWN_ROOT;
  const listing = trackedFiles(root);
  if (!listing.ok) {
    console.error(listing.message);
    return 2;
  }
  const { findings, unreadable } = scan(root, listing.files);
  for (const line of [...findings, ...unreadable]) console.error(line);
  if (unreadable.length > 0) return 2;
  if (findings.length > 0) return 1;
  console.log(`check-addresses: every address in the ${listing.files.length} tracked files is allowed`);
  return 0;
}

if (isProgram(import.meta.url)) process.exitCode = main(process.argv.slice(2));
