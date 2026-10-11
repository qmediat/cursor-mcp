// @ts-check
// The baseline ratchet shared by our repositories: a baseline may only shrink. A project carries this file as
// `lint/baseline-ratchet.mjs`, byte for byte; it is edited where the presets are kept, never in a copy.
//
//   node lint/baseline-ratchet.mjs [--base <ref>] [--duplicates <jscpd-report.json>]
//     Compares every tracked baseline with the base branch (--base, else $BASELINE_RATCHET_BASE — a release job sets
//     HEAD: the tag's tree was checked on its pull request —, else origin/$GITHUB_BASE_REF in a pull request, else
//     origin/main) and fails when an entry appeared or a count rose — `eslint --suppress-all` and a regenerated
//     rubocop todo would otherwise hide a new violation. A baseline the base branch does not have is an adoption.
//     With --duplicates, jscpd's report must measure exactly the duplicated lines `jscpd-baseline.json` records: more
//     is a new repeat, fewer asks for the baseline to be lowered (--write-duplicates), no file analyzed is "cannot tell".
//   node lint/baseline-ratchet.mjs --write-duplicates <jscpd-report.json>   records the measured duplicated lines
//   node lint/baseline-ratchet.mjs --counts           every baseline's size, as JSON (exit 2 when one is unreadable)
// Every run also holds the vendored preset files (lint/structure.mjs, lint/baseline-ratchet.mjs) to
// lint/presets.sha256, the presets' own list copied beside them: a file edited here is refused.
// Exit: 0 clean, 1 a baseline grew or does not hold, 2 cannot tell (no base ref, an unreadable file or report).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const DUPLICATES = "jscpd-baseline.json";
export const LOCK = "lint/presets.sha256";
const VENDORED = ["lint/structure.mjs", "lint/baseline-ratchet.mjs"];

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

// An entry's key holds the file it is about and what is recorded for it, apart: a rename moves the file and nothing
// else, whatever characters the path has. The file is relative to the baseline's root; "" when no file carries it.
const SEP = "\0";
/** @param {string} file @param {string} label @returns {string} */
const keyOf = (file, label) => `${file}${SEP}${label}`;
/** @param {string} key @returns {[string, string]} the file and the label */
const partsOf = (key) => [key.slice(0, key.indexOf(SEP)), key.slice(key.indexOf(SEP) + 1)];

/**
 * Every suppressed (file, rule) of an ESLint bulk-suppressions file, with its count.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function eslintEntries(text) {
  /** @type {Map<string, number>} */
  const entries = new Map();
  for (const [file, rules] of Object.entries(JSON.parse(text))) {
    for (const [rule, { count }] of Object.entries(rules)) entries.set(keyOf(file, rule), countOf(count, file));
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
    else if (cop && kind === "excludes") values.forEach((path) => entries.set(keyOf(path, `${cop} excludes`), 1));
    else if (cop && kind === "setting") {
      entries.set(keyOf("", `${cop} ${at(values, 0)}`), settingWeight(at(values, 0), at(values, 1)));
    }
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
  return new Map(lines.filter((line) => line && !line.startsWith("#")).map((line) => [keyOf(line, ""), 1]));
}

/**
 * The lines in a repeat a jscpd baseline records per file.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function duplicateEntries(text) {
  const files = JSON.parse(text).files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("files is not a map of duplicated lines per file");
  }
  return new Map(Object.entries(files).map(([file, lines]) => [keyOf(file, ""), countOf(lines, file)]));
}

/**
 * The entries whose value is higher at head than at base (an entry absent at base counts from zero).
 * @param {Map<string, number>} base
 * @param {Map<string, number>} head
 * @returns {[string, number][]}
 */
export function grown(base, head) {
  return [...head].filter(([key, count]) => count > (base.get(key) ?? 0));
}

/** @param {Map<string, number>} entries @returns {number} */
const sum = (entries) => [...entries.values()].reduce((all, value) => all + value, 0);
/** @param {Map<string, number>} entries @returns {number} */
const size = (entries) => entries.size;
/** @param {string} file @param {string} label @returns {string} */
const fileFirst = (file, label) => (label ? `${file} ${label}` : file);
/** @param {string} file @param {string} label @returns {string} */
const labelFirst = (file, label) => (file ? `${label} ${file}` : label);

/**
 * The baseline formats. `name` is where the tools read it — a baseline's files are relative to the directory the name
 * starts in (ESLint and jscpd write theirs where they run, rubocop resolves a todo's paths from its directory, the
 * legacy list names files from the directory above its `scripts/`) —, `measure` the size `--counts` reports, `show` how an entry is written.
 */
const KINDS = [
  { key: "eslint", name: "eslint-suppressions.json", entries: eslintEntries, measure: sum, show: fileFirst },
  { key: "rubocop", name: ".rubocop_todo.yml", entries: rubocopEntries, measure: size, show: labelFirst },
  { key: "legacy", name: "scripts/lint-baseline.txt", entries: listEntries, measure: size, show: fileFirst },
  { key: "duplicates", name: DUPLICATES, entries: duplicateEntries, measure: sum, show: fileFirst },
];

/** @param {string} path @param {string} name @returns {boolean} */
const isNamed = (path, name) => path === name || path.endsWith(`/${name}`);
/** @param {string[]} tracked @param {string} name @returns {string[]} */
const named = (tracked, name) => tracked.filter((path) => isNamed(path, name));
/** @param {string} path a baseline's path, @param {string} name its kind's name @returns {string} its root, "" or "dir/" */
const rootOf = (path, name) => path.slice(0, path.length - name.length);

/** @returns {string[]} the tracked paths, relative to the working directory */
const trackedFiles = () => git("ls-files", "-z").split("\0").filter(Boolean);

/**
 * @typedef {object} Kind a baseline format (KINDS)
 * @property {string} name
 * @property {(text: string) => Map<string, number>} entries
 * @property {(entries: Map<string, number>) => number} measure
 * @property {(file: string, label: string) => string} show
 */
/**
 * @typedef {object} History the base and what changed since, every path from the repository's top
 * @property {string} ref the base
 * @property {string} prefix the working directory from the top, "" or "dir/"
 * @property {Map<string, string>} moved old path → new path (git's rename detection)
 * @property {Map<string, string>} origins new path → old path
 * @property {string[]} base every file at the base
 * @property {Set<string>} kept the base's files the head still tracks
 */
/** @typedef {{ from: string, root: string, entries: Map<string, number> }} Copy a baseline at the base */

/**
 * What changed since the base, seen from the repository's top whatever directory the ratchet runs in (the head's
 * baselines are the directory's). Asked through ls-tree and ls-files, whose answers are listings, not messages in the
 * user's language; NUL-separated, whatever characters a path has; any git failure throws (cannot tell).
 * @param {string} ref
 * @returns {History}
 */
function historyOf(ref) {
  const list = (/** @type {string[]} */ ...args) => git(...args).split("\0").filter(Boolean);
  const parts = git("diff", "-M", "--name-status", "--diff-filter=R", "-z", ref).split("\0");
  /** @type {Map<string, string>} */
  const moved = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) moved.set(at(parts, i + 1), at(parts, i + 2));
  const base = list("ls-tree", "-r", "--name-only", "--full-tree", "-z", ref);
  const head = new Set(list("ls-files", "--full-name", "-z", "--", ":/"));
  const kept = new Set(base.filter((path) => head.has(path)));
  const origins = new Map([...moved].map(([from, to]) => [to, from]));
  return { ref, prefix: git("rev-parse", "--show-prefix").trim(), moved, origins, base, kept };
}

/**
 * An entry's key with its file's path from the top — its head path when git saw it renamed; an entry no file carries
 * (a rubocop setting) keeps its label alone.
 * @param {string} key
 * @param {string} root the baseline's root from the top, "" or "dir/"
 * @param {Map<string, string>} [moved]
 * @returns {string}
 */
function topKey(key, root, moved = new Map()) {
  const [file, label] = partsOf(key);
  if (file === "") return key;
  const path = posix.join(root, file);
  return keyOf(moved.get(path) ?? path, label);
}

/** @param {Kind} kind @param {string} path from the top @param {History} history @returns {Copy} */
const copyAt = (kind, path, history) => ({
  from: path,
  root: rootOf(path, kind.name),
  entries: kind.entries(git("show", `${history.ref}:${path}`)),
});

/**
 * A head baseline's own base copy: at its path, or where git saw it renamed from under its kind's name; null when it
 * has none (a new or an unpaired moved baseline).
 * @param {Kind} kind
 * @param {string} top the baseline's path from the top
 * @param {History} history
 * @returns {Copy | null}
 */
function ownCopy(kind, top, history) {
  if (history.kept.has(top)) return copyAt(kind, top, history);
  const origin = history.origins.get(top);
  return origin !== undefined && isNamed(origin, kind.name) ? copyAt(kind, origin, history) : null;
}

/**
 * The file entries of every base baseline of a kind, keyed from the top through git's renames: what an entry falls
 * back to when its own baseline never named its file. Two baselines naming one entry: the larger count.
 * @param {Kind} kind
 * @param {History} history
 * @returns {Map<string, number>}
 */
function baseIndex(kind, history) {
  /** @type {Map<string, number>} */
  const index = new Map();
  for (const { root, entries } of named(history.base, kind.name).map((path) => copyAt(kind, path, history))) {
    for (const [key, count] of entries) {
      if (partsOf(key)[0] === "") continue;
      const where = topKey(key, root, history.moved);
      index.set(where, Math.max(index.get(where) ?? 0, count));
    }
  }
  return index;
}

/**
 * @typedef {object} Scope what a head baseline's entries answer to
 * @property {Copy | null} own its own base copy
 * @property {Copy[]} removed the base's baselines of its kind the head no longer tracks (when it has no own copy)
 * @property {string} root its root from the top
 * @property {() => Map<string, number>} index the kind's file entries from every base baseline
 * @property {History} history
 */

/**
 * The base count a head entry answers to: its own baseline's — under the file's name at the base (git's rename
 * followed back) or its name now —, else, for a file its own never named, the kind's index; a file-less entry (a
 * rubocop setting) answers to its own todo, or to the largest of the removed ones'.
 * @param {string} key
 * @param {Scope} scope
 * @returns {number}
 */
function baseCount(key, { own, removed, root, index, history }) {
  const [file, label] = partsOf(key);
  if (file === "") return Math.max(0, ...(own ? [own] : removed).map((copy) => copy.entries.get(key) ?? 0));
  const path = posix.join(root, file);
  const inOwn = (/** @type {string} */ name) => own?.entries.get(keyOf(posix.relative(own.root || ".", name), label));
  return inOwn(history.origins.get(path) ?? path) ?? inOwn(path) ?? index().get(keyOf(path, label)) ?? 0;
}

/**
 * Every baseline moved since the base to a path its tools do not read it under: the ratchet would not see it either.
 * @param {Map<string, string>} moved
 * @returns {string[]}
 */
function movedAway(moved) {
  return [...moved].flatMap(([from, to]) =>
    KINDS.filter(({ name }) => isNamed(from, name) && !isNamed(to, name)).map(
      ({ name }) => `${from} was moved to ${to}: a baseline is read under its name (${name}) only — move it back`,
    ),
  );
}

/**
 * What a head baseline is held to, or null for an adoption: one with no base copy is an adoption only when the change
 * removed no baseline of its kind and the base recorded none of its files (a moved, merged or split baseline is held).
 * @param {Kind} kind
 * @param {string} top
 * @param {Map<string, number>} head
 * @param {{ history: History, index: () => Map<string, number> }} base
 * @returns {Scope | null}
 */
function scopeOf(kind, top, head, { history, index }) {
  const own = ownCopy(kind, top, history);
  const root = rootOf(top, kind.name);
  const removed = own ? [] : named(history.base, kind.name).filter((path) => !history.kept.has(path));
  const recorded = [...head.keys()].some((key) => partsOf(key)[0] !== "" && index().has(topKey(key, root)));
  if (!own && removed.length === 0 && !recorded) return null;
  return { own, removed: removed.map((path) => copyAt(kind, path, history)), root, index, history };
}

/**
 * One tracked baseline against what its entries answer to; an adoption is said (never silent).
 * @param {Kind} kind
 * @param {string} path relative to the working directory
 * @param {{ history: History, index: () => Map<string, number> }} base
 * @returns {{ problems: string[], adoption: string | null }}
 */
function compare(kind, path, base) {
  const top = posix.join(base.history.prefix, path);
  const head = kind.entries(readFileSync(path, "utf8"));
  const scope = scopeOf(kind, top, head, base);
  if (scope === null) {
    const adoption = `${path} is new at ${base.history.ref} (an adoption, ${kind.measure(head)}): review its entries`;
    return { problems: [], adoption };
  }
  const elsewhere = [scope.own?.from ?? "", ...scope.removed.map(({ from }) => from)].filter((from) => from && from !== top);
  const held = elsewhere.length === 0 ? "" : ` (held to ${elsewhere.join(", ")}, removed here)`;
  const rose = [...head].filter(([key, count]) => count > baseCount(key, scope));
  const problems = rose.map(
    ([key, count]) => `${path}: grew: ${kind.show(...partsOf(key))} (${count})${held} — fix the code; a baseline only shrinks`,
  );
  return { problems, adoption: null };
}

/**
 * Every baseline that grew against the base, or was moved where it is not read; and every adoption.
 * @param {History} history
 * @param {string[]} tracked the baselines under the working directory are the ones checked
 * @returns {{ problems: string[], adoptions: string[] }}
 */
function growth(history, tracked) {
  const results = KINDS.flatMap((kind) => {
    /** @type {Map<string, number> | undefined} */
    let index;
    const base = { history, index: () => (index ??= baseIndex(kind, history)) };
    return named(tracked, kind.name).map((path) => compare(kind, path, base));
  });
  return {
    problems: [...movedAway(history.moved), ...results.flatMap(({ problems }) => problems)],
    adoptions: results.flatMap(({ adoption }) => (adoption === null ? [] : [adoption])),
  };
}

/**
 * The lines of each file that a repeat covers, from jscpd's JSON report — both sides of every clone, a line counted
 * once. Per file, not a total: a new copy of a repeated block can leave jscpd's total unchanged (it pairs the new copy
 * with one old copy and drops another pair) but never a file's count. "Cannot tell" when jscpd analyzed no file.
 * @param {string} reportPath
 * @returns {Map<string, number>}
 */
export function measuredDuplicates(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (!report.statistics?.total?.sources) {
    throw new Error(`${reportPath}: jscpd analyzed no files — check its paths and ignore patterns`);
  }
  if (!Array.isArray(report.duplicates)) throw new Error(`${reportPath}: no duplicates list — not a jscpd JSON report`);
  /** @type {Map<string, Set<number>>} */
  const covered = new Map();
  for (const clone of report.duplicates) [clone.firstFile, clone.secondFile].forEach((side) => cover(covered, side));
  return new Map([...covered].sort(([a], [b]) => a.localeCompare(b)).map(([file, lines]) => [file, lines.size]));
}

/**
 * @param {Map<string, Set<number>>} covered
 * @param {{ name: string, start: unknown, end: unknown }} side one file of a clone
 */
function cover(covered, side) {
  const file = isAbsolute(side.name) ? relative(process.cwd(), side.name) : side.name;
  const lines = covered.get(file) ?? new Set();
  const [start, end] = [countOf(side.start, `${file}: start`), countOf(side.end, `${file}: end`)];
  for (let line = start; line <= end; line += 1) lines.add(line);
  covered.set(file, lines);
}

/** @param {[string, number][]} entries @returns {string[]} each file with its lines */
const perFile = (entries) => entries.map(([key, lines]) => `${partsOf(key)[0]} (${lines})`);

/**
 * jscpd's measurement against jscpd-baseline.json, whose files are taken through the renames since the base: a new
 * repeat, fewer lines than recorded, or a baseline that still names a renamed file — each asks for something else.
 * Both name files from the working directory, where jscpd ran.
 * @param {string} reportPath
 * @param {History} history
 * @returns {string[]}
 */
function holdProblems(reportPath, { prefix, moved }) {
  const measured = new Map([...measuredDuplicates(reportPath)].map(([file, lines]) => [keyOf(file, ""), lines]));
  const written = duplicateEntries(readFileSync(DUPLICATES, "utf8"));
  const here = (/** @type {string} */ key) => keyOf(posix.relative(prefix || ".", partsOf(topKey(key, prefix, moved))[0]), "");
  const recorded = new Map([...written].map(([key, lines]) => [here(key), lines]));
  const rose = perFile(grown(recorded, measured));
  if (rose.length > 0) return rose.map((entry) => `a new repeat of ≥ 10 lines in ${entry} — list them: jscpd --reporters console`);
  const fell = perFile(grown(measured, recorded));
  if (fell.length > 0) return [`${DUPLICATES} records more than jscpd measures (${fell.join(", ")}): lower it — --write-duplicates ${reportPath}`];
  const stale = [...written.keys()].map((key) => partsOf(key)[0]).filter((file) => moved.has(posix.join(prefix, file)));
  if (stale.length > 0) return [`${DUPLICATES} names renamed files (${stale.join(", ")}): record their new names — --write-duplicates ${reportPath}`];
  return [];
}

/** @param {string} reportPath @returns {string} the baseline jscpd's report gives, per file and in total */
function duplicatesBaseline(reportPath) {
  const files = measuredDuplicates(reportPath);
  return `${JSON.stringify({ duplicatedLines: sum(files), files: Object.fromEntries(files) }, null, 2)}\n`;
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
 * The vendored preset files against lint/presets.sha256: one edited here, one the list does not name, or vendored
 * files without the list are problems. A listed preset the project does not carry is no problem (a Ruby project
 * vendors the ratchet alone); a directory with no vendored file has nothing to hold.
 * @returns {string[]}
 */
function presetProblems() {
  const present = VENDORED.filter((path) => existsSync(path));
  if (present.length === 0) return [];
  if (!existsSync(LOCK)) return [`${present.join(", ")} without ${LOCK}: copy the presets' list beside them`];
  const lines = lockLines(readFileSync(LOCK, "utf8"));
  const listed = new Set(lines.map(([, path]) => path));
  const unlisted = present.filter((path) => !listed.has(path)).map((path) => `${path} is not in ${LOCK}`);
  return [...unlisted, ...lines.flatMap(([sum, path]) => copyProblems(sum, path))];
}

/** @param {string} text @returns {[string, string][]} each line's sha256 and path */
function lockLines(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  return lines.map((line) => {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (!match) throw new Error(`${LOCK}: "${line}" is no sha256 line`);
    return [at(match, 1), at(match, 2)];
  });
}

/** @param {string} sum @param {string} path @returns {string[]} */
function copyProblems(sum, path) {
  if (!existsSync(path)) return [];
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual === sum) return [];
  return [`${path} differs from the preset it copies (${LOCK}): edit it where the presets are kept, never here`];
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
  const pr = process.env["GITHUB_BASE_REF"];
  return {
    base: value("--base") ?? (process.env["BASELINE_RATCHET_BASE"] || (pr ? `origin/${pr}` : "origin/main")),
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
  const history = historyOf(options.base);
  const hold = options.duplicates === null ? [] : holdProblems(options.duplicates, history);
  const { problems, adoptions } = growth(history, trackedFiles());
  const all = [...problems, ...hold, ...presetProblems()];
  for (const note of adoptions) console.log(`baseline-ratchet: ${note}`);
  for (const problem of all) console.error(`baseline-ratchet: ${problem}`);
  return all.length === 0 ? 0 : 1;
}

/** @param {string[]} argv @returns {number} the exit code */
export function main(argv) {
  try {
    const options = parseArgs(argv);
    if (options.write !== null) {
      writeFileSync(DUPLICATES, duplicatesBaseline(options.write));
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
