---
name: run-ductus
description: Build, run, and drive the Ductus web app (Next.js, pnpm). Use when asked to start Ductus, build it, take a screenshot of its UI, or interact with the running app in a real browser.
---

Ductus is a Next.js 15 App Router app. Drive it with `.claude/skills/run-ductus/driver.mjs`: it builds, starts `next start` on a free port with the local demo journal on, drives `/rad` in Playwright Chromium (types invented text, reloads, checks it is restored), saves a screenshot and stops the server. Run it from the repo root. No Docker stack is needed: the journal is IndexedDB in the browser.

## Setup

```bash
pnpm install --frozen-lockfile
```

Needs Node 24 and the Chromium that the pinned `@playwright/test` uses (already present when the e2e suite runs on the machine).

## Run (agent path)

```bash
node .claude/skills/run-ductus/driver.mjs                 # build (~90 s) + start + drive
node .claude/skills/run-ductus/driver.mjs --skip-build    # reuse an existing .next (~10 s)
```

Options: `--port 3111` (default), `--out DIR` (default `<tmp>/run-ductus`), `--headed`. Ends with `OK: typed text restored after reload; screenshot <out>/rad-restored.png`; a non-zero exit means a step failed. Open the PNG to look at it.

The `/rad` editor is local-only and appears only with `DUCTUS_LOCAL_DEMO_JOURNAL=1` and `DUCTUS_DEPLOYMENT` of `local`, `ci` or `demo`; the driver sets both. Without them `/rad` shows a read-only sheet. To drive other pages or write your own flow, start the server yourself the same way (`pnpm build`, then `pnpm exec next start -p <port>` with those two variables) and reuse the selectors in `e2e/local-editor.spec.ts` (`getByRole("textbox", { name: "Tekst rada" })`).

## Test

```bash
pnpm test        # unit + property; e2e is `pnpm test:e2e` and needs the compose stack, see docs/TESTING.md
```

About 5300 tests pass in ~65 s. Under load `forbidden-terms` and `pr-metadata-precheck` can fail on a 5 s timeout; rerun that file alone before treating it as a regression.

## Gotchas

- **Never use a port from 3000-3004 for your own run.** Playwright's e2e config owns them, and a local Docker stack may own 3000. Use 3111 or another free one.
- **Do not start, stop or reset the compose stack from an agent run** (`pnpm stack:*`, `pnpm db:*`). Pages that need login or the database (`/api/auth/*`) need it; `/rad` does not.
- **`contenteditable` flips to `"true"` only after the local journal opens.** Reading the attribute right after `goto` sees `"false"`; wait for `[role="textbox"][contenteditable="true"]`.
- **Use only invented text** and sign in only through the fake OIDC provider (D-09).

## Troubleshooting

- **`editor stays read-only: flag or deployment not honoured`**: the server was not started with both variables (or something else owns the port and answered instead). Stop it and rerun.
- **`DeprecationWarning: Passing args to a child process with shell option true`** and the `pnpm.overrides` `[WARN]`: harmless output on Windows.
