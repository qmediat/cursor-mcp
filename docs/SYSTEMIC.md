# SYSTEMIC conventions — `qmediat/cursor-mcp`

> The catalogue of this repository's cross-cutting rules: one §N per convention, the one definition each surface
> reads, and what enforces it. Present tense, current rules only; history lives in `CHANGELOG.md` and the PR bodies.

## §1 — Code structure: the preset, the baselines, the exemplars (2026-10-11)

**Rule 1 — the one definition.** `lint/structure.mjs` and `lint/baseline-ratchet.mjs` are copies of shared presets,
byte for byte (edited where the presets are kept, never here). `npm run lint` runs ESLint with `...structure()` —
complexity ≤ 10, nesting ≤ 3, ≤ 40 lines per function outside tests, a reason on every disable directive; in the
`node:test` suites no `assert.throws(fn)` / `assert.rejects(p)` without the expected error (a message alone is no
expectation) and no test without an assertion — over the TypeScript (parsed by Babel's TypeScript parser plugin:
TypeScript 7 ships no JavaScript API for typescript-eslint) and the test modules; jscpd counts repeats of ≥ 10 lines
over `src` and `test`; the ratchet holds the lines each file has in a repeat to `jscpd-baseline.json` (more is a new repeat, fewer asks for
`node lint/baseline-ratchet.mjs --write-duplicates .jscpd-report/jscpd-report.json`) and refuses any baseline that
grew against the base branch (CI checks out with `fetch-depth: 0`).

**Formatting.** Prettier (pinned in `package.json`; `.prettierrc.json`: printWidth 120, its defaults otherwise —
double quotes, semicolons, trailing commas: the style the code had) formats every `*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` file (the one glob: the `fmt` script); `npm run format` rewrites, `npm run format:check` is a CI step. Excluded (`.prettierignore`): the vendored
presets of Rule 1 and whatever ESLint ignores (the same list); `.gitattributes` keeps every text file LF. Prose,
JSON and YAML are not formatted by it. `.git-blame-ignore-revs` names the one-time reformat (#33) for `git blame`.

**The exemplars** — read before writing, not the nearest file:

| layer | file |
|---|---|
| module | `src/cursor-argv.ts` |
| test | `test/args.test.mjs` |

There is no shared test helper yet; the first one goes in `test/support/` and is named here.

**Rule 2 — the baselines at adoption.** `eslint-suppressions.json`: 9 violations in 5 files (5 over the complexity of
10, 4 functions over 40 lines); duplicates: 70 lines in 3 files (3 repeats, both sides counted). A baseline only shrinks: a function a PR changes
leaves it in that PR, the rest of a touched file in the next PR; after a rebase a conflicting
`eslint-suppressions.json` is regenerated (the base's file, then `npx eslint --prune-suppressions`) and a conflicting `jscpd-baseline.json` re-recorded (the base's file, then `--write-duplicates`), never merged by hand; the ratchet refuses whatever grew. A jscpd version bump can move the measured lines: that PR re-records the baseline with `--write-duplicates`, reviewed like a baseline cleanup.

`npm run lint` takes no arguments: ESLint's own flags (`--fix`, a file list) go to `npx eslint`. A suppression is a count per file and rule: a new violation of a rule in a file that already has suppressed ones
passes while another is fixed in the same PR — the count is the only guard there, so the self-review reads the
touched functions. `eslint-suppressions.json` is marked `linguist-generated` (a review packet carries it as data,
last): the ratchet holds it after adoption, and the adoption PR names its counts.

**Enforcement.** The CI job runs `npm run lint` and `npm run format:check` on every Node of its matrix. Named exclusions: the release job does not
lint (the tag's tree was linted on its pull request and on `main`); the root configuration files are outside jscpd's
pattern (no logic to repeat).
