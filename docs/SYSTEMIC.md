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
over `src` and `test`; the ratchet holds the count to `jscpd-baseline.json` (more is a new repeat, fewer asks for
`node lint/baseline-ratchet.mjs --write-duplicates .jscpd-report/jscpd-report.json`) and refuses any baseline that
grew against the base branch (CI checks out with `fetch-depth: 0`).

**The exemplars** — read before writing, not the nearest file:

| layer | file |
|---|---|
| module | `src/cursor-argv.ts` |
| test | `test/args.test.mjs` |

There is no shared test helper yet; the first one goes in `test/support/` and is named here.

**Rule 2 — the baselines at adoption.** `eslint-suppressions.json`: 9 violations in 5 files (5 over the complexity of
10, 4 functions over 40 lines); duplicates: 35 lines (3 repeats). A baseline only shrinks: a function a PR changes
leaves it in that PR, the rest of a touched file in the next PR; after a rebase a conflicting
`eslint-suppressions.json` is regenerated (the base's file, then `npx eslint --prune-suppressions`), never merged by
hand.

**Enforcement.** The CI job runs `npm run lint` on every Node of its matrix.
