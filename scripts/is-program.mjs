// @ts-check
// The guard the repository's scripts share: run `main` only when node started the script itself, not when a test
// imports it. lint/baseline-ratchet.mjs keeps its own copy: it is vendored byte for byte across repositories.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} moduleUrl the calling module's `import.meta.url`
 * @returns {boolean} whether that module is the program node runs (not a module another file imports)
 */
export function isProgram(moduleUrl) {
  const self = fileURLToPath(moduleUrl);
  const started = process.argv[1] ?? "";
  try {
    return Boolean(started) && realpathSync(started) === realpathSync(self);
  } catch {
    return resolve(started) === self; // a path realpath cannot resolve still names this file when node started it
  }
}
