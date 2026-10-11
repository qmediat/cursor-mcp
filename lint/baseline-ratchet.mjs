// @ts-check
// The baseline ratchet shared by our repositories: a baseline may only shrink. A project carries this file as
// `lint/baseline-ratchet.mjs`, byte for byte; it is edited where the presets are kept, never in a copy.
//
//   node lint/baseline-ratchet.mjs [--base <ref>] [--duplicates <jscpd-report.json>]
//     Compares every tracked baseline with the base branch (default: origin/$GITHUB_BASE_REF in a pull request, else
//     origin/main) and fails when an entry appeared or a count rose — `eslint --suppress-all` and a regenerated
//     rubocop todo would otherwise hide a new violation. A baseline the base branch does not have is an adoption.
//     With --duplicates, jscpd's report must measure exactly the duplicated lines `jscpd-baseline.json` records: more
//     is a new repeat, fewer asks for the baseline to be lowered (--write-duplicates), no file analyzed is "cannot tell".
//   node lint/baseline-ratchet.mjs --write-duplicates <jscpd-report.json>   records the measured duplicated lines
//   node lint/baseline-ratchet.mjs --counts           every baseline's size, as JSON (exit 2 when one is unreadable)
// Exit: 0 clean, 1 a baseline grew or does not hold, 2 cannot tell (no base ref, an unreadable file or report).
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DUPLICATES = "jscpd-baseline.json";

/** @param {...string} args */
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }); // a large tree

/**
 * A count read from a baseline: a whole number ≥ 0, or the file cannot be trusted (cannot tell).
 * @param {unknown} value
 * @param {string} where
 * @returns {number}
 */
function countOf(value, where) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${where}: not a count`);
  return value;
}

/**
 * Every suppressed (file, rule) of an ESLint bulk-suppressions file, with its count.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function eslintEntries(text) {
  /** @type {Map<string, number>} */
  const entries = new Map();
  for (const [file, rules] of Object.entries(JSON.parse(text))) {
    for (const [rule, { count }] of Object.entries(rules)) entries.set(`${file} ${rule}`, countOf(count, file));
  }
  return entries;
}

/** @param {ArrayLike<string | undefined> | null} list @param {number} index @returns {string} */
const at = (list, index) => list?.[index] ?? "";

/** @param {string} item a YAML scalar, quoted or not @returns {string} */
const unquote = (item) => item.trim().replace(/^['"]|['"]$/g, "");

/**
 * One line of a rubocop todo, its trailing comment dropped: a cop header, excluded files (a block item or a flow
 * list), a Max / Enabled setting, or anything else.
 * @param {string} raw
 * @returns {{ kind: string, values: string[] }}
 */
function rubocopLine(raw) {
  const line = raw.replace(/\s+#.*$/, "");
  const header = /^([A-Z]\w*\/\w+):\s*$/.exec(line);
  if (header) return { kind: "cop", values: [at(header, 1)] };
  const item = /^\s+-\s+(.+?)\s*$/.exec(line);
  if (item) return { kind: "excludes", values: [unquote(at(item, 1))] };
  const flow = /^\s+Exclude:\s*\[(.*)\]\s*$/.exec(line);
  if (flow) return { kind: "excludes", values: at(flow, 1).split(",").map(unquote).filter(Boolean) };
  const setting = /^\s+(Max|Enabled):\s*(\S+)\s*$/.exec(line);
  return setting ? { kind: "setting", values: [at(setting, 1), at(setting, 2)] } : { kind: "other", values: [] };
}

/**
 * Every (cop, file) a rubocop todo excludes, and every cop setting it carries — a raised `Max:` or an
 * `Enabled: false` is a baseline too (a todo generated without --auto-gen-only-exclude), so it may not grow either.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function rubocopEntries(text) {
  /** @type {Map<string, number>} */
  const entries = new Map();
  let cop = "";
  for (const raw of text.split("\n")) {
    const { kind, values } = rubocopLine(raw);
    if (kind === "cop") cop = at(values, 0);
    else if (cop && kind === "excludes") values.forEach((path) => entries.set(`${cop} excludes ${path}`, 1));
    else if (cop && kind === "setting") entries.set(`${cop} ${at(values, 0)}`, settingWeight(at(values, 0), at(values, 1)));
  }
  return entries;
}

/**
 * A cop setting's weight: Enabled false (quoted or not) is one disabled cop, Enabled true none, a Max its number;
 * anything else cannot be compared, so it is "cannot tell", never a weight of 0 that would read as a shrink.
 * @param {string} name Max or Enabled
 * @param {string} raw the setting's value as written
 * @returns {number}
 */
function settingWeight(name, raw) {
  const value = unquote(raw);
  if (name === "Enabled" && (value === "false" || value === "true")) return value === "false" ? 1 : 0;
  const number = Number(value);
  if (name === "Max" && value !== "" && Number.isFinite(number)) return number;
  throw new Error(`rubocop todo: ${name}: ${raw} is no value the ratchet can compare`);
}

/**
 * A list of files written before the standard: one entry per line that is neither blank nor a comment.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function listEntries(text) {
  const lines = text.split("\n").map((line) => line.trim());
  return new Map(lines.filter((line) => line && !line.startsWith("#")).map((line) => [line, 1]));
}

/**
 * The duplicated lines a jscpd baseline records.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function duplicateEntries(text) {
  return new Map([["duplicated lines", countOf(JSON.parse(text).duplicatedLines, "duplicatedLines")]]);
}

/**
 * The entries whose value is higher at head than at base (an entry absent at base counts from zero).
 * @param {Map<string, number>} base
 * @param {Map<string, number>} head
 * @returns {string[]}
 */
export function grown(base, head) {
  return [...head].filter(([key, count]) => count > (base.get(key) ?? 0)).map(([key, count]) => `${key} (${count})`);
}

/** @param {Map<string, number>} entries @returns {number} */
const sum = (entries) => [...entries.values()].reduce((all, value) => all + value, 0);
/** @param {Map<string, number>} entries @returns {number} */
const size = (entries) => entries.size;

/** The baseline formats; `measure` is the size `--counts` reports. */
const KINDS = [
  { key: "eslint", name: "eslint-suppressions.json", entries: eslintEntries, measure: sum },
  { key: "rubocop", name: ".rubocop_todo.yml", entries: rubocopEntries, measure: size },
  { key: "legacy", name: "scripts/lint-baseline.txt", entries: listEntries, measure: size },
  { key: "duplicates", name: DUPLICATES, entries: duplicateEntries, measure: sum },
];

/** @param {string[]} tracked @param {string} name @returns {string[]} */
const named = (tracked, name) => tracked.filter((path) => path === name || path.endsWith(`/${name}`));

/** @returns {string[]} the tracked paths, relative to the working directory */
const trackedFiles = () => git("ls-files", "-z").split("\0").filter(Boolean);

/**
 * The file at the base branch; null when the base does not have it (an adoption). Asked through ls-tree, whose
 * answer is a listing, not a message in the user's language; any git failure throws (cannot tell).
 * @param {string} ref
 * @param {string} path relative to the working directory, as `git ls-files` lists it
 * @returns {string | null}
 */
function atBase(ref, path) {
  if (git("ls-tree", "--name-only", ref, "--", path).trim() === "") return null;
  return git("show", `${ref}:./${path}`);
}

/**
 * Every baseline that grew against the base; a baseline the base does not have is an adoption, said (never silent).
 * @param {string} ref
 * @param {string[]} tracked
 * @returns {{ problems: string[], adoptions: string[] }}
 */
function growth(ref, tracked) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const adoptions = [];
  for (const { name, entries, measure } of KINDS) {
    for (const path of named(tracked, name)) {
      const head = entries(readFileSync(path, "utf8"));
      const base = atBase(ref, path);
      if (base === null) adoptions.push(`${path} is new at ${ref} (an adoption, ${measure(head)}): review it as code`);
      const rose = base === null ? [] : grown(entries(base), head);
      problems.push(...rose.map((entry) => `${path}: grew: ${entry} — fix the code; a baseline only shrinks`));
    }
  }
  return { problems, adoptions };
}

/**
 * The duplicated lines jscpd measured, from its JSON report; "cannot tell" when it analyzed no file.
 * @param {string} reportPath
 * @returns {number}
 */
export function measuredDuplicates(reportPath) {
  const stats = JSON.parse(readFileSync(reportPath, "utf8")).statistics.total;
  if (!stats.sources) throw new Error(`${reportPath}: jscpd analyzed no files — check its paths and ignore patterns`);
  return countOf(stats.duplicatedLines, `${reportPath}: statistics.total.duplicatedLines`);
}

/** @param {string} reportPath @returns {string[]} */
function holdProblems(reportPath) {
  const measured = measuredDuplicates(reportPath);
  const recorded = sum(duplicateEntries(readFileSync(DUPLICATES, "utf8")));
  const said = `${measured} duplicated lines, ${recorded} in ${DUPLICATES}`;
  if (measured > recorded) return [`${said}: a new repeat of ≥ 10 lines — list them with jscpd --reporters console`];
  if (measured < recorded) return [`${said}: lower the baseline — --write-duplicates ${reportPath}`];
  return [];
}

/** @param {string[]} tracked @returns {{ sizes: Record<string, number>, unreadable: string[] }} */
function counts(tracked) {
  /** @type {Record<string, number>} */
  const sizes = { eslint: 0, rubocop: 0, legacy: 0, duplicates: 0 };
  /** @type {string[]} */
  const unreadable = [];
  for (const { key, name, entries, measure } of KINDS) {
    for (const path of named(tracked, name)) {
      try {
        sizes[key] = (sizes[key] ?? 0) + measure(entries(readFileSync(path, "utf8")));
      } catch (error) {
        unreadable.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { sizes, unreadable };
}

/**
 * @param {string[]} argv
 * @returns {{ base: string, duplicates: string | null, write: string | null, counts: boolean }}
 */
export function parseArgs(argv) {
  const value = (/** @type {string} */ flag) => {
    if (!argv.includes(flag)) return null;
    const given = argv[argv.indexOf(flag) + 1];
    if (given === undefined || given === "" || given.startsWith("--")) throw new Error(`${flag} needs a value`);
    return given;
  };
  const env = process.env["GITHUB_BASE_REF"];
  return {
    base: value("--base") ?? (env ? `origin/${env}` : "origin/main"),
    duplicates: value("--duplicates"),
    write: value("--write-duplicates"),
    counts: argv.includes("--counts"),
  };
}

/** @param {{ base: string, duplicates: string | null }} options @returns {number} */
function check(options) {
  try {
    git("rev-parse", "--verify", "--quiet", `${options.base}^{commit}`);
  } catch {
    throw new Error(`base ${options.base} not found — fetch it (CI: fetch-depth: 0)`);
  }
  const hold = options.duplicates === null ? [] : holdProblems(options.duplicates);
  const { problems, adoptions } = growth(options.base, trackedFiles());
  for (const note of adoptions) console.log(`baseline-ratchet: ${note}`);
  for (const problem of [...problems, ...hold]) console.error(`baseline-ratchet: ${problem}`);
  return problems.length + hold.length === 0 ? 0 : 1;
}

/** @param {string[]} argv @returns {number} the exit code */
export function main(argv) {
  try {
    const options = parseArgs(argv);
    if (options.write !== null) {
      writeFileSync(DUPLICATES, `${JSON.stringify({ duplicatedLines: measuredDuplicates(options.write) })}\n`);
      return 0;
    }
    if (options.counts) {
      const sizes = counts(trackedFiles());
      console.log(JSON.stringify(sizes));
      return sizes.unreadable.length === 0 ? 0 : 2; // the sizes are printed either way; an unreadable one is cannot-tell
    }
    return check(options);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`baseline-ratchet: cannot tell — ${reason}`);
    return 2;
  }
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
