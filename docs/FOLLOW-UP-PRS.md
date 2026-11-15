# Follow-up PRs

## DEF-VERSION-FILES (2026-11-15). One check for every file that carries the version

`npm run check:supports` compares the README's `## Supports · version X.Y.Z` heading with `package.json` in CI and in
the release workflow. The `server.json` versions (the MCP registry manifest) are compared with `package.json` only by
an inline step of `release.yml`, so a stale `server.json` is found at tag time, not at PR time. Move that comparison
into the same script (one helper, every version-bearing file) and run it in CI.

## DEF-ADDRESSES-CHECK (2026-11-15). A check that every email address is in `qmediat.io`

AGENTS.md states the rule; nothing enforces it (an account address sat in `docs/SESSION-RESUME.md` from 2026-04-13 to
2026-11-15). Add a check, beside the one above, that fails on an address outside `qmediat.io` in a tracked text file
(test fixtures on `example.com` excepted by name).
