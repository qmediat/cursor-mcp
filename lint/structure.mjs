// @ts-check
// The structure preset shared by our repositories. A project carries this file as `lint/structure.mjs`, byte for
// byte: it is edited where the presets are kept, never in a copy (a copy that differs is reported as drifted).
// It holds structure rules only; a project's parser, style and typed rules stay in its own eslint.config.
import comments from "@eslint-community/eslint-plugin-eslint-comments";

/** @typedef {import("eslint").Linter.Config} Config */
/** @typedef {import("eslint").ESLint.Plugin} Plugin */

const SOURCES = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
const TESTS = [
  "**/*.{test,spec,e2e}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "**/{test,tests,__tests__,e2e}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
];

// node:test — assert.throws / assert.rejects (also t.assert.…, assert.strict.…, an imported throws) with no expected
// error, or with only a message (a string or a template; a RegExp literal is an expected error), passes on any
// exception; a stub's `.throws(err)` is not an assertion and is left alone. Exported so a project with its own
// `no-restricted-syntax` for tests can list these selectors beside its own (a rule's options replace, never merge).
const THROWS_CALLS = [
  "CallExpression[callee.object.name='assert'][callee.property.name=/^(throws|rejects)$/]",
  "CallExpression[callee.object.property.name=/^(assert|strict)$/][callee.property.name=/^(throws|rejects)$/]",
  "CallExpression[callee.object.name='strict'][callee.property.name=/^(throws|rejects)$/]",
  "CallExpression[callee.type='Identifier'][callee.name=/^(throws|rejects)$/]",
];
const NO_EXPECTED_ERROR = [
  "[arguments.length<2]",
  "[arguments.length>=2][arguments.1.type='Identifier'][arguments.1.name='undefined']",
  "[arguments.length>=3][arguments.1.type='Literal'][arguments.1.raw='null']", // two arguments: the Literal rule below
  "[arguments.length=2][arguments.1.type='TemplateLiteral']",
  "[arguments.length=2][arguments.1.type='Literal']:not([arguments.1.regex])",
];
export const BARE_THROWS = THROWS_CALLS.flatMap((call) => NO_EXPECTED_ERROR.map((args) => call + args)).map(
  (selector) => ({
    selector,
    message: "Name the expected error (a class, a RegExp or a validation function): a message alone is no expectation.",
  }),
);

// node:test — a test or a t.test subtest whose function calls no assertion passes whatever the code does. An
// assertion is assert… (assert.strict… and an imported strict… too), expect… (expect.poll, expect.soft), t.assert…, a
// function node:assert exports imported by name, or a helper named assert* / expect*; t.skip / t.todo say the test is
// deliberately empty. test.only and it.only are tests; test.skip is not run.
const ASSERT_EXPORTS =
  "ok|equal|notEqual|strictEqual|notStrictEqual|deepEqual|notDeepEqual|deepStrictEqual|notDeepStrictEqual|" +
  "partialDeepStrictEqual|throws|doesNotThrow|rejects|doesNotReject|match|doesNotMatch|fail|ifError";
const ASSERTING = [
  `CallExpression[callee.type='Identifier'][callee.name=/^(${ASSERT_EXPORTS})$/]`,
  "CallExpression[callee.object.name=/^(assert|expect|strict)$/]",
  "CallExpression[callee.object.object.name='assert']",
  "CallExpression[callee.object.name='t'][callee.property.name=/^(skip|todo)$/]",
  "CallExpression[callee.object.property.name='assert']",
  "CallExpression[callee.name=/^(assert|expect)/]",
  "CallExpression[callee.property.name=/^(assert|expect)/]",
];
// node:test with Playwright's expect — an expect() used as a statement, with no matcher, asserts nothing.
export const BARE_EXPECT = {
  selector:
    ":matches(ExpressionStatement > CallExpression.expression, ExpressionStatement > AwaitExpression > CallExpression)[callee.name='expect']",
  message: "An expect() without a matcher asserts nothing: call one (toBe, toEqual, toHaveText, …).",
};

export const NO_ASSERTION = {
  selector:
    ":matches(CallExpression[callee.name=/^(test|it)$/], CallExpression[callee.object.name=/^(test|it)$/][callee.property.name='only'], " +
    "CallExpression[callee.object.name='t'][callee.property.name='test'])" +
    " > :matches(ArrowFunctionExpression, FunctionExpression)" +
    ASSERTING.map((call) => `:not(:has(${call}))`).join(""),
  message: "A test without an assertion passes whatever the code does: assert, or call a helper named assert* or expect*.",
};

// Vitest — a toThrow() with no expected error, a test with no assertion, an expect() with no matcher (Vitest's
// expect takes a message as its second argument). A helper that asserts is named `expect*` or `assert*`, so the
// test that calls it counts as asserting.
/** @type {import("eslint").Linter.RulesRecord} */
const VITEST_RULES = {
  "vitest/require-to-throw-message": "error",
  "vitest/expect-expect": ["error", { assertFunctionNames: ["expect*", "assert*"] }],
  "vitest/valid-expect": ["error", { maxArgs: 2 }],
};

// The 40-line limit for production code; exported so a project that gives it back to files the test glob catches (a
// Next.js route segment named test/) spreads the same rule, never a copy of its options.
/** @type {import("eslint").Linter.RuleEntry} */
export const FUNCTION_LENGTH = ["error", { max: 40, skipBlankLines: false, skipComments: false }];

/**
 * The structure rules as flat-config objects. Pass `vitest` (the `@vitest/eslint-plugin` default export) when the
 * project's tests run on Vitest; without it the tests get the node:test rule.
 * @param {{ vitest?: Plugin }} [options]
 * @returns {Config[]}
 */
export function structure({ vitest } = {}) {
  /** @type {Config} */
  const tests = vitest
    ? { files: TESTS, plugins: { vitest }, rules: VITEST_RULES }
    : { files: TESTS, rules: { "no-restricted-syntax": ["error", ...BARE_THROWS, NO_ASSERTION, BARE_EXPECT] } };
  return [
    { ignores: ["**/.claude/worktrees/**"] }, // Claude Code's worktrees: another checkout of the same files
    {
      files: SOURCES,
      plugins: { "@eslint-community/eslint-comments": comments },
      linterOptions: { reportUnusedDisableDirectives: "error" },
      rules: {
        complexity: ["error", 10],
        "max-depth": ["error", 3],
        "@eslint-community/eslint-comments/require-description": ["error", { ignore: ["eslint-enable"] }],
        "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      },
    },
    { files: SOURCES, ignores: TESTS, rules: { "max-lines-per-function": FUNCTION_LENGTH } },
    tests,
  ];
}
