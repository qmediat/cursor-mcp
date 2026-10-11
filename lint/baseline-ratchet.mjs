// @ts-check
// The baseline ratchet shared by our repositories: a baseline may only shrink. A project carries this file as
// `lint/baseline-ratchet.mjs`, byte for byte; it is edited where the presets are kept, never in a copy.
//
//   node lint/baseline-ratchet.mjs [--base <ref>] [--duplicates <jscpd-report.json>]
//     Compares every tracked baseline with the base branch (--base, else $BASELINE_RATCHET_BASE — a release job sets
//     HEAD: the tag's tree was checked on its pull request —, else origin/$GITHUB_BASE_REF in a pull request, else the
//     commit a push moved the branch from (GitHub's push event), else origin/main) and fails when an entry appeared or a count rose — `eslint --suppress-all` and a regenerated
//     rubocop todo would otherwise hide a new violation. A baseline the base branch does not have is an adoption (unless a
//     base copy read in part could have named its files: cannot tell).
//     With --duplicates, jscpd's report must measure exactly the duplicated lines `jscpd-baseline.json` records: more
//     is a new repeat, fewer asks for the baseline to be lowered (--write-duplicates), no file analyzed is "cannot tell".
//   node lint/baseline-ratchet.mjs --write-duplicates <jscpd-report.json>   records the measured duplicated lines
//   node lint/baseline-ratchet.mjs --counts           {sizes: every kind's size, unreadable: [...]} as JSON (exit 2 when
//                                                     one is unreadable)
//   Any other argument (`--fix` through `npm run lint --`, `--duplicates=<report>`) is a usage error, exit 2.
// Every check (not --counts, not --write-duplicates) also holds the vendored preset files under lint/ of the directory
// it runs in to lint/presets.sha256, the presets' own list copied beside them: a file edited here is refused.
// Exit: 0 clean, 1 a baseline grew or does not hold, 2 cannot tell (no base ref, an unreadable file or report, an entry
// or a new baseline a base copy read in part could hold) — 1 whenever anything definitely grew.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DUPLICATES = "jscpd-baseline.json";
export const LOCK = "lint/presets.sha256";
export const VENDORED = ["lint/structure.mjs", "lint/baseline-ratchet.mjs", "lint/rubocop-structure.yml", "lint/rubocop-rspec.yml"];

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
 * A value a baseline holds that the ratchet cannot read: at head (`skipped` null) it is cannot-tell; in a base copy it
 * is left out and its reason kept in `skipped`, said by the run. A base entry left out can only make the head's read as
 * growth or cannot-tell, never hide it — and a line left out lends nothing to the entries around it.
 * @param {string} reason
 * @param {string[] | null} skipped
 */
function skip(reason, skipped) {
  if (skipped === null) throw new Error(reason);
  skipped.push(reason);
}

/**
 * @template T
 * @param {() => T} read a value of a baseline, thrown when unreadable
 * @param {string[] | null} skipped null at head
 * @returns {T | null} null when a base copy's value was left out
 */
function readValue(read, skipped) {
  if (skipped === null) return read();
  try {
    return read();
  } catch (error) {
    if (isDefect(error)) throw error; // a defect of this file, never a value of the data
    skipped.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** @param {unknown} error @returns {boolean} a programming error (the data's are plain Errors and JSON's SyntaxError) */
const isDefect = (error) => error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError;

/** @param {Map<string, number>} entries @returns {number} */
const sum = (entries) => [...entries.values()].reduce((all, value) => all + value, 0);
/** @param {Map<string, number>} entries @returns {number} */
const size = (entries) => entries.size;

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
 * @param {string[] | null} [skipped] null at head; a base copy's unreadable counts are left out into it
 * @returns {Map<string, number>}
 */
export function eslintEntries(text, skipped = null) {
  const record = JSON.parse(text);
  if (!isMap(record)) throw new Error("not a map of files to their suppressed rules");
  /** @type {Map<string, number>} */
  const entries = new Map();
  for (const [file, rules] of Object.entries(record)) {
    if (!isMap(rules)) {
      skip(`${file}: not a map of rules`, skipped);
      continue;
    }
    for (const [rule, value] of Object.entries(rules)) {
      const read = readValue(() => countOf(value?.count, file), skipped);
      if (read !== null) entries.set(keyOf(file, rule), read);
    }
  }
  return entries;
}

/** @param {unknown} value @returns {value is Record<string, any>} a JSON object (not an array, not null) */
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {ArrayLike<string | undefined> | null} list @param {number} index @returns {string} */
const at = (list, index) => list?.[index] ?? "";

/** @param {string} item a YAML scalar, quoted or not @returns {string} its value ('' and \" undone) */
function unquote(item) {
  const value = item.trim();
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
  if (/^".*"$/.test(value)) return value.slice(1, -1).replace(/\\(.)/g, "$1");
  return value;
}

/**
 * @typedef {"blank" | "cop" | "exclude" | "item" | "flow" | "setting" | "key" | "top"} TodoKind
 * @typedef {{ kind: TodoKind, values: string[] }} TodoLine
 * @typedef {{ cop: string, listing: boolean }} TodoState the cop being read, and whether inside its Exclude block
 */

/**
 * One line of a rubocop todo, its trailing comment dropped: blank, a cop header, `Exclude:` opening a block list, an
 * item, a flow list, a Max / Enabled setting — or a line the ratchet does not read: another key of the cop ("key",
 * indented) or of the file ("top", at column 0).
 * @param {string} raw
 * @returns {TodoLine}
 */
function rubocopLine(raw) {
  const line = withoutComment(raw);
  if (line.trim() === "") return { kind: "blank", values: [] };
  if (/^\s+Exclude:\s*$/.test(line)) return { kind: "exclude", values: [] };
  const header = /^([A-Z]\w*(?:\/\w+)+):\s*$/.exec(line);
  if (header) return { kind: "cop", values: [at(header, 1)] };
  const item = /^\s+-\s+(.+?)\s*$/.exec(line);
  if (item) return { kind: "item", values: [unquote(at(item, 1))] };
  const flow = /^\s+Exclude:\s*\[(.*)\]\s*$/.exec(line);
  if (flow) return { kind: "flow", values: at(flow, 1).split(",").map(unquote).filter(Boolean) };
  const setting = /^\s+(Max|Enabled):\s*(\S+)\s*$/.exec(line);
  if (setting) return { kind: "setting", values: [at(setting, 1), at(setting, 2)] };
  return { kind: /^\s/.test(line) ? "key" : "top", values: [] };
}

/**
 * A todo line without its trailing comment: a `#` that starts the line or follows a space, outside a quoted scalar — a
 * quoted path may hold " #", and an apostrophe inside a plain one (`it's.rb`) opens nothing.
 * @param {string} raw
 * @returns {string}
 */
function withoutComment(raw) {
  for (let i = 0; i < raw.length; i += 1) {
    if (opensQuote(raw, i)) i = closingQuote(raw, i);
    else if (raw.charAt(i) === "#" && (i === 0 || /\s/.test(raw.charAt(i - 1)))) return raw.slice(0, i);
  }
  return raw;
}

/**
 * Where the quoted scalar opened at `start` closes: '' inside single quotes and \" inside double quotes are escapes,
 * not its end; the line's end when it never closes.
 * @param {string} raw
 * @param {number} start
 * @returns {number}
 */
function closingQuote(raw, start) {
  const quote = raw.charAt(start);
  for (let i = start + 1; i < raw.length; i += 1) {
    const char = raw.charAt(i);
    if (quote === '"' && char === "\\") i += 1;
    else if (char === quote && quote === "'" && raw.charAt(i + 1) === "'") i += 1;
    else if (char === quote) return i;
  }
  return raw.length;
}

/** @param {string} raw @param {number} i @returns {boolean} a quote at i opens a quoted scalar: it starts a value */
const opensQuote = (raw, i) => /['"]/.test(raw.charAt(i)) && (i === 0 || /[\s[,]/.test(raw.charAt(i - 1)));

/**
 * The state after a todo line, or null when the line is not read where it stands: another key, an item outside an
 * Exclude block, a list or a setting before any cop.
 * @param {TodoLine} line
 * @param {TodoState} state
 * @returns {TodoState | null}
 */
function nextState({ kind, values }, { cop, listing }) {
  if (kind === "blank") return { cop, listing };
  if (kind === "cop") return { cop: at(values, 0), listing: false };
  if (cop === "" || kind === "key" || kind === "top" || (kind === "item" && !listing)) return null;
  return { cop, listing: kind === "exclude" || kind === "item" };
}

/**
 * Records a read line's entries: its excluded files, or its setting's weight.
 * @param {TodoLine} line
 * @param {string} cop
 * @param {Map<string, number>} entries
 * @param {string[] | null} skipped
 */
function recordTodoLine({ kind, values }, cop, entries, skipped) {
  if (kind === "item" || kind === "flow") values.forEach((path) => entries.set(keyOf(path, `${cop} excludes`), 1));
  if (kind !== "setting") return;
  const weight = readValue(() => settingWeight(at(values, 0), at(values, 1)), skipped);
  if (weight !== null) entries.set(keyOf("", `${cop} ${at(values, 0)}`), weight);
}

/**
 * Every (cop, file) a rubocop todo excludes, and every `Max:` / `Enabled:` it carries — a raised Max or a disabled cop
 * is a baseline too, so it may not grow either. Any other line (an `EnforcedStyle:` a todo generated without
 * --auto-gen-only-exclude writes, an inline mapping) is cannot-tell at head — the recipe generates exclusions only —
 * and left out of a base copy, where it ends what it would extend: a top-level key ends the cop, another key its
 * Exclude block.
 * @param {string} text
 * @param {string[] | null} [skipped] null at head; a base copy's unread lines and values are left out into it
 * @returns {Map<string, number>}
 */
export function rubocopEntries(text, skipped = null) {
  /** @type {Map<string, number>} */
  const entries = new Map();
  /** @type {TodoState} */
  let state = { cop: "", listing: false };
  for (const raw of text.split(/\r?\n/)) {
    const line = rubocopLine(raw);
    const next = nextState(line, state);
    if (next === null) {
      skip(`rubocop todo: "${raw.trim()}" is no line the ratchet reads (a cop, its Exclude list, Max, Enabled)`, skipped);
      state = { cop: line.kind === "top" ? "" : state.cop, listing: false };
      continue;
    }
    recordTodoLine(line, state.cop, entries, skipped);
    state = next;
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
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return new Map(lines.filter((line) => line && !line.startsWith("#")).map((line) => [keyOf(line, ""), 1]));
}

/**
 * The lines in a repeat a jscpd baseline records per file; its total must be their sum.
 * @param {string} text
 * @param {string[] | null} [skipped] null at head; a base copy's unreadable counts are left out into it
 * @returns {Map<string, number>}
 */
export function duplicateEntries(text, skipped = null) {
  const record = JSON.parse(text);
  if (!isMap(record)) throw new Error("not a jscpd baseline record");
  const files = record.files;
  if (!isMap(files)) {
    throw new Error("files is not a map of duplicated lines per file");
  }
  /** @type {Map<string, number>} */
  const entries = new Map();
  for (const [file, lines] of Object.entries(files)) {
    const read = readValue(() => countOf(lines, file), skipped);
    if (read !== null) entries.set(keyOf(file, ""), read);
  }
  const total = record.duplicatedLines;
  // a base copy's total is not read: it loses no entry, and a copy is read in part only when one is left out
  if (skipped === null && total !== sum(entries)) throw new Error(`duplicatedLines ${total} is not the sum of its files (${sum(entries)})`);
  return entries;
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
 * @property {(text: string, skipped?: string[] | null) => Map<string, number>} entries
 * @property {(entries: Map<string, number>) => number} measure
 * @property {(file: string, label: string) => string} show
 */
/**
 * @typedef {object} History the base and what changed since, every path from the repository's top
 * @property {string} ref the commit compared with: where the branch left the base
 * @property {string} name the base as named (a branch, a commit), for messages
 * @property {string} prefix the working directory from the top, "" or "dir/"
 * @property {Map<string, string>} moved old path → new path (git's rename detection)
 * @property {Map<string, string>} origins new path → old path
 * @property {string[]} base every file at the base
 * @property {Set<string>} kept the base's files the head still tracks
 * @property {string[]} skipped what base copies held that the ratchet could not read, left out (said by the run)
 */
/**
 * @typedef {object} Copy a baseline at the base
 * @property {string} from its path from the top
 * @property {string} root its root from the top
 * @property {Map<string, number>} entries what it was read to hold
 * @property {boolean} partial whether anything was left out of it (an absent entry may then be one it held)
 */

/**
 * What changed since the base, seen from the repository's top whatever directory the ratchet runs in (the head's
 * baselines are the directory's). Asked through ls-tree and ls-files, whose answers are listings, not messages in the
 * user's language; NUL-separated, whatever characters a path has; any git failure throws (cannot tell).
 * @param {string} ref the commit compared with
 * @param {string} [name] the base as named
 * @returns {History}
 */
function historyOf(ref, name = ref) {
  const list = (/** @type {string[]} */ ...args) => git(...args).split("\0").filter(Boolean);
  const parts = git("diff", "-M", "--name-status", "--diff-filter=R", "-z", ref).split("\0");
  /** @type {Map<string, string>} */
  const moved = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) moved.set(at(parts, i + 1), at(parts, i + 2));
  const base = list("ls-tree", "-r", "--name-only", "--full-tree", "-z", ref);
  const head = new Set(list("ls-files", "--full-name", "-z", "--", ":/"));
  const kept = new Set(base.filter((path) => head.has(path)));
  const origins = new Map([...moved].map(([from, to]) => [to, from]));
  return { ref, name, prefix: git("rev-parse", "--show-prefix").trim(), moved, origins, base, kept, skipped: [] };
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
  if (isOutside(file)) throw new Error(outsideReason(file));
  const path = posix.join(root, file);
  return keyOf(moved.get(path) ?? path, label);
}

/** @param {string} file @returns {boolean} whether an entry's file lies outside its baseline's directory */
const isOutside = (file) => {
  const normal = posix.normalize(file);
  return posix.isAbsolute(file) || normal === ".." || normal.startsWith("../");
};
/** @param {string} file @returns {string} */
const outsideReason = (file) => `a baseline entry names ${file}, outside its baseline's directory — no tool writes that`;

/**
 * A baseline as the base holds it, read leniently: what the ratchet cannot read is left out and said (History.skipped).
 * @param {Kind} kind
 * @param {string} path from the top
 * @param {History} history
 * @returns {Copy}
 */
function copyAt(kind, path, history) {
  const text = git("show", `${history.ref}:${path}`);
  /** @type {string[]} */
  const skipped = [];
  /** @type {Map<string, number>} */
  const entries = new Map();
  /** @type {string[]} */
  const whole = [];
  for (const [key, count] of readValue(() => kind.entries(text, skipped), whole) ?? []) {
    const file = partsOf(key)[0];
    if (isOutside(file)) skipped.push(outsideReason(file));
    else entries.set(key, count);
  }
  skipped.push(...whole.map((reason) => `the whole copy (${reason})`));
  history.skipped.push(...skipped.map((reason) => `${path} at its merge base with ${history.name}: ${firstLines([reason])}`));
  return { from: path, root: rootOf(path, kind.name), entries, partial: skipped.length > 0 };
}

/**
 * A head baseline's own base copy: at its path, or where git saw it renamed from under its kind's name; null when it
 * has none (a new or an unpaired moved baseline).
 * @param {Kind} kind
 * @param {string} top the baseline's path from the top
 * @param {KindBase} base the kind's copies, read once
 * @returns {Copy | null}
 */
function ownCopy(kind, top, { history, copies }) {
  const origin = history.kept.has(top) ? top : history.origins.get(top);
  if (origin === undefined || !isNamed(origin, kind.name)) return null;
  return copies().find((copy) => copy.from === origin) ?? null;
}

/**
 * @typedef {object} BaseIndex the base entries an entry may fall back to
 * @property {Map<string, number>} lend the entries that left their copy, with the count they carry
 * @property {Map<string, { at: string, count: number }>} unsure the entries of a copy whose head file (at `at`, from the
 *   top) cannot be read: it may still record them — up to the count it recorded at the base
 */

/**
 * The file entries that left their base copy since — the copy is gone, or no longer records them at head —, keyed from
 * the top through git's renames: what an entry falls back to when its own baseline never named its file. A file moved
 * between baselines keeps its count; a second baseline naming a file the first still records gets none. Two copies
 * naming one entry: the larger count.
 * @param {Kind} kind
 * @param {Copy[]} copies the kind's baselines at the base
 * @param {History} history
 * @returns {BaseIndex}
 */
function baseIndex(kind, copies, history) {
  /** @type {BaseIndex} */
  const index = { lend: new Map(), unsure: new Map() };
  for (const copy of copies) {
    const still = stillHeld(kind, copy, history);
    for (const [key, count] of copy.entries) {
      if (partsOf(key)[0] === "") continue;
      const where = topKey(key, copy.root, history.moved);
      if (still === null) index.unsure.set(where, { at: headPath(copy, history) ?? copy.from, count: Math.max(index.unsure.get(where)?.count ?? 0, count) });
      else if (!still.has(where)) index.lend.set(where, Math.max(index.lend.get(where) ?? 0, count));
    }
  }
  return index;
}

/**
 * What a base copy still records at head — where it is now, kept or moved by git —, keyed from the top: nothing when
 * its baseline is gone; null when its head file cannot be read (it may still record anything, so it lends no count).
 * @param {Kind} kind
 * @param {Copy} copy
 * @param {History} history
 * @returns {Set<string> | null}
 */
function stillHeld(kind, copy, history) {
  const now = headPath(copy, history);
  if (now === undefined || !isNamed(now, kind.name)) return new Set();
  const here = posix.relative(history.prefix.replace(/\/$/, "") || ".", now);
  const root = rootOf(now, kind.name);
  const keys = (/** @type {Map<string, number>} */ head) => [...head.keys()].map((key) => topKey(key, root));
  /** @type {string[]} */
  const said = [];
  const held = readValue(() => new Set(keys(kind.entries(readFileSync(here, "utf8")))), said);
  if (held === null) history.skipped.push(`${now} at head: ${firstLines(said)} — it lends no count to another baseline`);
  return held;
}

/** @param {string[]} reasons @returns {string} each reason's first line (a parser may quote its input), joined */
const firstLines = (reasons) => reasons.map((reason) => reason.split("\n")[0]).join("; ");

/** @param {Copy} copy @param {History} history @returns {string | undefined} where it is at head: kept, or moved by git */
const headPath = (copy, history) => (history.kept.has(copy.from) ? copy.from : history.moved.get(copy.from));

/**
 * Every file the kind's base copies record, from the top through git's renames: a new baseline naming one is held,
 * never an adoption.
 * @param {Copy[]} copies
 * @param {History} history
 * @returns {Set<string>}
 */
function recordedFiles(copies, history) {
  const keys = copies.flatMap(({ root, entries }) => [...entries.keys()].map((key) => topKey(key, root, history.moved)));
  return new Set(keys.map((key) => partsOf(key)[0]).filter((file) => file !== ""));
}

/**
 * @typedef {object} Scope what a head baseline's entries answer to
 * @property {Copy | null} own its own base copy
 * @property {Copy[]} removed the base's baselines of its kind the head no longer tracks (when it has no own copy)
 * @property {string} root its root from the top
 * @property {() => BaseIndex} index the kind's file entries from every base baseline
 * @property {History} history
 */

/**
 * @typedef {object} KindBase a kind's baselines at the base, read once per run
 * @property {History} history
 * @property {() => BaseIndex} index the file entries that left their copy, and those it cannot vouch for (baseIndex)
 * @property {() => Set<string>} recorded every file the kind's base copies record (recordedFiles)
 * @property {() => Copy[]} copies the kind's baselines at the base
 */

/**
 * The count a head entry answers to at the base, or undefined when no copy it answers to holds it: its own baseline's
 * — under the file's name at the base (git's rename followed back) or its name now —, else, for a file its own never
 * named (and its own was read whole), the kind's index; a file-less entry (a rubocop setting) answers to its own todo,
 * or to the largest of the removed ones'.
 * @param {string} key
 * @param {Scope} scope
 * @returns {number | undefined}
 */
function baseEntry(key, scope) {
  const { own, root, index, history } = scope;
  const [file, label] = partsOf(key);
  if (file === "") {
    const held = settingsCopies(scope).flatMap((copy) => copy.entries.get(key) ?? []);
    return held.length > 0 ? Math.max(...held) : undefined;
  }
  const path = posix.join(root, file);
  const inOwn = (/** @type {string} */ name) => own?.entries.get(keyOf(posix.relative(own.root || ".", name), label));
  const owned = inOwn(history.origins.get(path) ?? path) ?? inOwn(path);
  return owned !== undefined || own?.partial ? owned : index().lend.get(keyOf(path, label)); // read in part: maybe its own
}

/**
 * The base copies read in part that could name a file: a copy names files under its root only, and the file's base
 * path follows git's renames back.
 * @param {KindBase} base
 * @param {string} path a file from the top, as the head names it
 * @returns {Copy[]}
 */
function unreadFor(base, path) {
  const atBase = base.history.origins.get(path) ?? path;
  return base.copies().filter((copy) => copy.partial && atBase.startsWith(copy.root));
}

/**
 * The copies read in part that could hold an entry the base answered nothing for: a file's (its own copy, unreadFor),
 * or for a file-less entry its own todo or the removed ones.
 * @param {string} key
 * @param {Scope} scope
 * @param {KindBase} base
 * @returns {Copy[]}
 */
function unreadOf(key, scope, base) {
  const [file] = partsOf(key);
  if (file === "") return settingsCopies(scope).filter((copy) => copy.partial);
  const own = scope.own?.partial ? [scope.own] : []; // it may hold the file under its head name too
  return [...own, ...unreadFor(base, posix.join(scope.root, file))];
}

/** @param {Scope} scope @returns {Copy[]} the todos a file-less entry answers to: its own, else the removed ones */
const settingsCopies = (scope) => (scope.own ? [scope.own] : scope.removed);

/**
 * Why an entry absent from the base may not be growth: a copy read in part may hold it, or a copy unreadable at head
 * may still record it up to the count it had (above that count it grew whatever that copy holds now); null when
 * nothing could.
 * @param {string} key
 * @param {number} count the head's
 * @param {Scope} scope
 * @param {KindBase} base
 * @returns {string | null}
 */
function doubtOf(key, count, scope, base) {
  const unread = unreadOf(key, scope, base);
  if (unread.length > 0) return `${namesOf(unread)} at the base was read in part (said above) and may hold it`;
  const [file, label] = partsOf(key);
  const unsure = file === "" ? undefined : base.index().unsure.get(keyOf(posix.join(scope.root, file), label));
  if (unsure === undefined || count > unsure.count) return null;
  return `${unsure.at} cannot be read at head (said above) and may still record it`;
}

/** @param {Copy[]} copies @returns {string} */
const namesOf = (copies) => [...new Set(copies.map((copy) => copy.from))].join(", ");

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
 * What a head baseline is held to, or null for a new one: no base copy, no baseline of its kind removed, none of its
 * files recorded by the base (a moved, merged or split baseline is held).
 * @param {Kind} kind
 * @param {string} top
 * @param {Map<string, number>} head
 * @param {KindBase} base
 * @returns {Scope | null}
 */
function scopeOf(kind, top, head, base) {
  const { history, index } = base;
  const own = ownCopy(kind, top, base);
  const root = rootOf(top, kind.name);
  const gone = (/** @type {Copy} */ copy) => !history.kept.has(copy.from) && !history.moved.has(copy.from); // not moved by git
  const removed = own ? [] : base.copies().filter(gone);
  const files = base.recorded();
  const recorded = [...head.keys()].some((key) => partsOf(key)[0] !== "" && files.has(partsOf(topKey(key, root))[0]));
  if (!own && removed.length === 0 && !recorded) return null;
  return { own, removed, root, index, history };
}

/**
 * @typedef {{ problems: string[], adoption: string | null, unknowns: string[] }} Comparison one baseline's verdict: its
 *   growth, the adoption said, and the entries that cannot be told (a copy read in part may hold them)
 */

/**
 * Why a head baseline is held to what it is, for its growth messages ("" when it is held to its own base copy).
 * @param {Scope} scope
 * @param {string} top the baseline's path from the top
 * @returns {string}
 */
function heldNote(scope, top) {
  const moved = scope.own && scope.own.from !== top ? [`${scope.own.from}, moved here`] : [];
  const notes = [...moved, ...scope.removed.map(({ from }) => `${from}, removed here`)];
  return notes.length === 0 ? "" : ` (held to ${notes.join("; ")})`;
}

/**
 * One tracked baseline against what its entries answer to; an adoption is said (never silent).
 * @param {Kind} kind
 * @param {string} path relative to the working directory
 * @param {KindBase} base
 * @returns {Comparison}
 */
function compare(kind, path, base) {
  const top = posix.join(base.history.prefix, path);
  const head = kind.entries(readFileSync(path, "utf8"));
  const scope = scopeOf(kind, top, head, base);
  if (scope === null) return newBaseline(kind, path, top, head, base);
  const held = heldNote(scope, top);
  /** @type {Comparison} */
  const verdict = { problems: [], adoption: null, unknowns: [] };
  for (const [key, count] of head) {
    const was = baseEntry(key, scope);
    if (count <= (was ?? 0)) continue; // no rise (an enabled cop weighs 0)
    const doubt = was === undefined ? doubtOf(key, count, scope, base) : null;
    const shown = `${kind.show(...partsOf(key))} (${count})`;
    if (doubt === null) verdict.problems.push(`${path}: grew: ${shown}${held} — fix the code; a baseline only shrinks`);
    else verdict.unknowns.push(`${path}: ${shown} — ${doubt}: fix the code, or make that copy readable first`);
  }
  return verdict;
}

/**
 * A baseline the base has no copy of: an adoption — unless a base copy of its kind read in part could have named its
 * files (a copy names files under its root only; a file's base path follows git's renames back), which is cannot-tell.
 * @param {Kind} kind
 * @param {string} path relative to the working directory
 * @param {string} top from the top
 * @param {Map<string, number>} head
 * @param {KindBase} base
 * @returns {Comparison}
 */
function newBaseline(kind, path, top, head, base) {
  const root = rootOf(top, kind.name);
  const files = [...head.keys()].map((key) => partsOf(key)[0]).filter((file) => file !== "");
  const unread = files.flatMap((file) => unreadFor(base, posix.join(root, file)));
  if (unread.length > 0) {
    const unknown = `${path} is new, and ${namesOf(unread)} at the base was read in part (said above): its files may be recorded there — make that copy readable first`;
    return { problems: [], adoption: null, unknowns: [unknown] };
  }
  const adoption = `${path} is new since ${base.history.name} (an adoption, ${kind.measure(head)}): review its entries`;
  return { problems: [], adoption, unknowns: [] };
}

/**
 * One baseline's verdict, or — when it cannot be read — a cannot-tell of its own: every other baseline is still told.
 * @param {() => Comparison} tell
 * @param {string} path
 * @returns {Comparison}
 */
function toldOrNot(tell, path) {
  /** @type {string[]} */
  const unknowns = [];
  return toldAt(path, tell, unknowns) ?? { problems: [], adoption: null, unknowns };
}

/**
 * A check's result, or — when it cannot tell — null with its reason said under `where` (a defect still throws).
 * @template T
 * @param {string} where what the reason is about
 * @param {() => T} tell
 * @param {string[]} unknowns
 * @returns {T | null}
 */
function toldAt(where, tell, unknowns) {
  /** @type {string[]} */
  const said = [];
  const told = readValue(tell, said);
  unknowns.push(...said.map((reason) => `${where}: ${firstLines([reason])}`));
  return told;
}

/**
 * Every baseline that grew against the base, or was moved where it is not read; every adoption; every new baseline
 * that cannot be told from one (a base copy read in part could have named its files).
 * @param {History} history
 * @param {string[]} tracked the baselines under the working directory are the ones checked
 * @returns {{ problems: string[], adoptions: string[], unknowns: string[] }}
 */
function growth(history, tracked) {
  const results = KINDS.flatMap((kind) => {
    /** @type {Copy[] | undefined} */
    let copies;
    const all = () => (copies ??= named(history.base, kind.name).map((path) => copyAt(kind, path, history)));
    /** @type {BaseIndex | undefined} */
    let index;
    /** @type {Set<string> | undefined} */
    let recorded;
    /** @type {KindBase} */
    const base = {
      history,
      index: () => (index ??= baseIndex(kind, all(), history)),
      recorded: () => (recorded ??= recordedFiles(all(), history)),
      copies: all,
    };
    return named(tracked, kind.name).map((path) => toldOrNot(() => compare(kind, path, base), path));
  });
  return {
    problems: [...movedAway(history.moved), ...results.flatMap(({ problems }) => problems)],
    adoptions: results.flatMap(({ adoption }) => (adoption === null ? [] : [adoption])),
    unknowns: results.flatMap(({ unknowns }) => unknowns),
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
  if (!report?.statistics?.total?.sources) {
    throw new Error(`${reportPath}: jscpd analyzed no files — check its paths and ignore patterns`);
  }
  if (!Array.isArray(report.duplicates)) throw new Error(`${reportPath}: no duplicates list — not a jscpd JSON report`);
  /** @type {Map<string, Set<number>>} */
  const covered = new Map();
  for (const clone of report.duplicates) [clone?.firstFile, clone?.secondFile].forEach((side) => cover(covered, side));
  return new Map([...covered].sort(([a], [b]) => a.localeCompare(b)).map(([file, lines]) => [file, lines.size]));
}

/**
 * @param {Map<string, Set<number>>} covered
 * @param {unknown} side one file of a clone ({ name, start, end }), as the report holds it
 */
function cover(covered, side) {
  if (!isMap(side) || typeof side.name !== "string") throw new Error("a clone without its two files — not a jscpd JSON report");
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
  const fell = perFile(grown(measured, recorded));
  const stale = [...written.keys()].map((key) => partsOf(key)[0]).filter((file) => moved.has(posix.join(prefix, file)));
  return [
    ...rose.map((entry) => `a new repeat (over .jscpd.json's floors) in ${entry} — list them: jscpd --reporters console`),
    ...(fell.length ? [`${DUPLICATES} records more than jscpd measures (${fell.join(", ")}): lower it — --write-duplicates ${reportPath}`] : []),
    ...(stale.length ? [`${DUPLICATES} names renamed files (${stale.join(", ")}): record their new names — --write-duplicates ${reportPath}`] : []),
  ];
}

/** @param {string} reportPath @returns {string} the baseline jscpd's report gives, per file and in total */
function duplicatesBaseline(reportPath) {
  const files = measuredDuplicates(reportPath);
  return `${JSON.stringify({ duplicatedLines: sum(files), files: Object.fromEntries(files) }, null, 2)}\n`;
}

/** @param {string[]} tracked @returns {{ sizes: Record<string, number>, unreadable: string[] }} */
function counts(tracked) {
  /** @type {Record<string, number>} */
  const sizes = Object.fromEntries(KINDS.map(({ key }) => [key, 0]));
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
  return [...unlisted, ...lines.flatMap(([expected, path]) => copyProblems(expected, path))];
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

/** @param {string} expected the list's sha256 @param {string} path @returns {string[]} */
function copyProblems(expected, path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n"); // a CRLF checkout (core.autocrlf) is the same preset
  const actual = createHash("sha256").update(text).digest("hex");
  if (actual === expected) return [];
  return [`${path} differs from the preset it copies (${LOCK}): edit it where the presets are kept, never here`];
}

/**
 * The commit a GitHub push event moved the branch from: on a push to main, origin/main is the pushed commit itself, so
 * the push is compared with what the branch held before it. None for another event, a new or deleted branch or no
 * event file; an event file that cannot be read is cannot-tell.
 * @returns {string | null}
 */
function pushedFrom() {
  const file = process.env["GITHUB_EVENT_PATH"];
  if (process.env["GITHUB_EVENT_NAME"] !== "push" || !file) return null;
  const event = JSON.parse(readFileSync(file, "utf8"));
  if (!isMap(event)) throw new Error(`${file}: the push event is no JSON object`);
  const before = String(event.before ?? "");
  if (event.deleted === true) return null; // a deleted branch: nothing was pushed to compare
  return /^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before) ? before : null;
}

const VALUED = new Set(["--base", "--duplicates", "--write-duplicates"]);
const ARGS = new Set([...VALUED, "--counts"]);

/**
 * @param {string[]} argv
 * @returns {{ base: string | null, duplicates: string | null, write: string | null, counts: boolean }}
 */
export function parseArgs(argv) {
  const usage = "usage: [--base <ref>] [--duplicates <report>] | --write-duplicates <report> | --counts";
  const unknown = argv.filter((arg, i) => !ARGS.has(arg) && !VALUED.has(at(argv, i - 1)));
  if (unknown.length > 0) throw new Error(`unknown argument ${unknown.join(" ")} — ${usage}`);
  const twice = [...ARGS].filter((flag) => argv.filter((arg) => arg === flag).length > 1);
  if (twice.length > 0) throw new Error(`${twice.join(" ")} given twice — ${usage}`);
  const value = (/** @type {string} */ flag) => {
    if (!argv.includes(flag)) return null;
    const given = argv[argv.indexOf(flag) + 1];
    if (given === undefined || given === "" || given.startsWith("--")) throw new Error(`${flag} needs a value`);
    return given;
  };
  return { base: value("--base"), duplicates: value("--duplicates"), write: value("--write-duplicates"), counts: argv.includes("--counts") };
}

/**
 * The base a check compares with: --base, else $BASELINE_RATCHET_BASE, else origin/$GITHUB_BASE_REF in a pull request,
 * else the commit a push moved the branch from, else origin/main.
 * @param {string | null} named
 * @returns {{ ref: string, pushed: boolean }} the base, and whether a push event named it
 */
function baseOf(named) {
  const pr = process.env["GITHUB_BASE_REF"];
  const given = named ?? (process.env["BASELINE_RATCHET_BASE"] || (pr ? `origin/${pr}` : null));
  if (given !== null) return { ref: given, pushed: false };
  const before = pushedFrom();
  return before === null ? { ref: "origin/main", pushed: false } : { ref: before, pushed: true };
}

/**
 * The commit the branch left the base at (a pull request merge commit's merge base is the base itself): a baseline the
 * base lowered after the branch left it is no growth of the branch.
 * @param {{ ref: string, pushed: boolean }} base
 * @returns {string}
 */
function forkOf({ ref: base, pushed }) {
  try {
    git("rev-parse", "--verify", "--quiet", `${base}^{commit}`);
  } catch (error) {
    const said = String(/** @type {{ stderr?: unknown }} */ (error).stderr ?? "").trim().split("\n")[0];
    const forced = pushed ? "; a force push discards the commit it replaced — name the base (BASELINE_RATCHET_BASE)" : "";
    throw new Error(said ? `git: ${said}${forced}` : `base ${base} not found — fetch it (CI: fetch-depth: 0)${forced}`, { cause: error });
  }
  try {
    return git("merge-base", "HEAD", base).trim();
  } catch (error) {
    throw new Error(`no merge base of HEAD and ${base} — fetch the history (CI: fetch-depth: 0)`, { cause: error });
  }
}

/**
 * Every verdict of a run: the growth, the hold and the lock (what does not hold), the adoptions, and every cannot-tell
 * — the return is built after every reader ran, so none is left out.
 * @param {History} history
 * @param {string | null} report jscpd's report, or null for no hold
 * @returns {{ problems: string[], adoptions: string[], unknowns: string[] }}
 */
function verdicts(history, report) {
  /** @type {string[]} */
  const unknowns = [];
  const hold = report === null ? [] : (toldAt("the duplicates hold", () => holdProblems(report, history), unknowns) ?? []);
  const lock = toldAt("the presets list", presetProblems, unknowns) ?? [];
  const told = growth(history, trackedFiles());
  return { problems: [...told.problems, ...hold, ...lock], adoptions: told.adoptions, unknowns: [...unknowns, ...told.unknowns] };
}

/** @param {{ base: string | null, duplicates: string | null }} options @returns {number} */
function check(options) {
  const base = baseOf(options.base);
  const history = historyOf(forkOf(base), base.ref);
  const { problems: all, adoptions, unknowns } = verdicts(history, options.duplicates);
  for (const note of adoptions) console.log(`baseline-ratchet: ${note}`);
  // beside the verdicts it explains (stderr), not with the adoption notes
  for (const note of new Set(history.skipped)) console.error(`baseline-ratchet: left out: ${note}`);
  for (const problem of all) console.error(`baseline-ratchet: ${problem}`);
  for (const unknown of unknowns) console.error(`baseline-ratchet: cannot tell — ${unknown}`);
  if (all.length > 0) return 1; // a definite refusal is never read as an unverified run
  return unknowns.length > 0 ? 2 : 0;
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
    if (isDefect(error) && error instanceof Error) console.error(error.stack); // a defect of this file: where it is
    return 2;
  }
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
