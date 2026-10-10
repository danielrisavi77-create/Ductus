---
name: ductus-browser-cli
description: Drive a real browser from the shell with the Playwright CLI already installed in this repo, for QA, bug hunting and reproducing UI behaviour without an MCP server.
---

The Playwright CLI ships inside the pinned `@playwright/test`; nothing else is installed. Wherever its documentation says `playwright-cli <command>`, run `pnpm exec playwright cli <command>`.

1. `pnpm exec playwright cli --help` lists the commands and prints the path of the bundled skill (`Agent skill: ...SKILL.md`). Read that file's quick start; open a file under its `references/` only for the topic you need.
2. Start the app the way `docs/TESTING.md` describes, then `open`, `goto`, and act on element refs from the snapshot. Prefer snapshots to screenshots.
3. `close` the browser when done.

Rules: synthetic data only; sign in only through the local fake OIDC provider; do not point it at production. A reproduced bug becomes an issue (`ductus-bug-hunter`) or a test in a QA task (`ductus-qa`), not an ad-hoc fix.
