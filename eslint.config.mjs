// @ts-check
// Structure lint: the shared preset (lint/structure.mjs). TypeScript 7 has no JavaScript API for typescript-eslint
// to parse with, so Babel's TypeScript parser plugin parses it.
import babelParser from "@babel/eslint-parser";
import { structure } from "./lint/structure.mjs";

export default [
  { ignores: ["dist/**", ".jscpd-report/**"] },
  {
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] } },
      },
    },
  },
  ...structure(),
];
