# Independent QA evidence for PR #613

QA identity: `codex:qa613web1:qa`. Source: `98471f3ba5fafe112dab510edce5eef488944351`.
Base and merge-base: `c4e52b53a1e6f6c53e116a8a36daf8131b52a47a`.
This evidence commit must have the source SHA as its only parent. Draft only; not a product change or merge candidate.

## Reproduction

`node tests/qa613web1/core-probe.mjs` executes the unchanged pure source and preserves failing assertions.
Observed exit 1: 6 pass, 8 fail. Two failures show a valid completed job named `__proto__` is silently discarded (single job removes the whole run; mixed jobs select the wrong slowest job). Six failures show impossible calendar dates accepted by `parseTwinArgs`.

`node tests/qa613web1/probe.mjs` was attempted once. Observed exit 1: 10 pass, 15 raw failures. One is a product assertion (calendar validation); 14 are environment blocks (`spawnSync ... EPERM`), not product failures or passes. The raw output and every attempted subprocess status remain in `probe.log` and `results.json`. Do not interpret a test's intended name as evidence that the subprocess ran. No assertions have been relaxed. The later `core-probe.mjs` is a separate direct-input probe and does not replace or erase that first attempt.

`fake-gh.mjs` is an offline fixture executable that never calls the network or real gh. It was not reached in this environment. The planned CLI probe uses the installed pnpm with `pnpm_config_verify_deps_before_run=false` solely to prevent pnpm 11's automatic dependency installation. Neither the full pnpm caller nor its pagination/output probes completed here.

## Existing tests

Direct executions: `node scripts/orchestrator/ci-twin-core.test.mjs` 7/7, `node scripts/orchestrator/metrics-core.test.mjs` 11/11, `node scripts/orchestrator/gh-rest.test.mjs` 10/10, all exit 0. The `node --test` command returned exit 0 with three file-level wrappers; individual-case evidence is the separate direct execution logs.

## Environment restrictions retained

- First git fetch: exit 128, existing proxy connection unavailable. Missing source objects subsequently read using the already available GitHub integration, with all imported object hashes verified. No proxy was changed and no permissions were requested or expanded.
- First plain `pnpm orch:twin --since 2026-10-23 --limit 1 --json`: exit 1. Installed pnpm 11.25.0 automatically attempted installation and failed creating its store with ENOENT. No dependency installation completed; package/lock/source files remain identical. The repository declares pnpm 10.33.0, unavailable in this session; nothing was installed to substitute it.
- Direct unmodified Node CLI: exit 2 after gh attempted its first GET. Error: `proxyconnect tcp ... socket: operation not permitted`. No network retry or escalation.
- Local harness subprocesses: `spawnSync node/pnpm EPERM`, status null; captured as blocked scope.
- GitHub integration rejected workflow-list URLs containing the `created` filter with INVALID_ARGUMENT/HTTP 400 (`not an allowed ... endpoint`). Live date filtering/pagination therefore not established. A direct run metadata read later returned RemoteProtocolError. These errors were not reinterpreted as empty data or success.

## Scope and limits

Passed direct probes cover median/p95 n=0/1/2/3/19/20/21/100/200 and n=10000; empty/text/JSON core rendering; limits and malformed arguments in the pure parser; unfinished, skipped and nonfinal-conclusion jobs; reversed/invalid/equal timestamps; negative wall excluded from wall statistics while retaining valid jobs; separate matrix names; ghList numeric paging for 0/1/100/101/200 items and its 50-page/malformed-body errors.

The real `pnpm orch:twin` successful execution, run-list paging for limits 1/100/101/150/200, GitHub's inclusive date semantics, full CLI text/JSON output, injected gh failures and full runtime side-effect tracing remain unexecuted. The fixture harness is reproducible material, not claimed execution evidence.

`queueMinutes` and `shardWhatIf` are library-only. Queue uses created-to-started timestamps, can return a duration for an unfinished job, and returns null for unknown/reversed times. Shard modeling assumes perfectly even division and repeated setup; it is not a measurement. Fractional and infinite shard counts are accepted by the current pure library; these observations are not presented as CLI bugs. Matrix names remain distinct. Despite stale PR-body wording, this head already excludes negative wall durations.

The concrete `__proto__` failure is reproduced at the core input boundary. The caller chain is `package.json:orch:twin` -> `ci-twin.mjs:22` -> `runShape`; GitHub job names are passed unchanged. The current workflow was not changed and this job name was not observed in its real run. End-to-end CLI reproduction is blocked, explicitly as above. Invalid calendar acceptance is a separate parser finding; the live GitHub response to those dates is unverified.

Static source/import inspection finds only gh GET-shaped calls on this CLI path (`gh api <path>`, no method override or field arguments), no Linear call, and no GitHub mutation. Core functions have no external I/O. The failed live call visibly attempted GET. Complete live success-path observation is blocked. Authorized evidence-PR/comment publication is separate from the feature under test.

Primary source CI evidence, fetched independently without comments/reviews: [CI run 40041886870](https://github.com/danielrisavi77-create/Ductus/actions/runs/40041886870), [build job 120714667299](https://github.com/danielrisavi77-create/Ductus/actions/runs/40041886870/job/120714667299), [Dependency review 40041886868](https://github.com/danielrisavi77-create/Ductus/actions/runs/40041886868). Connector reports both runs successful; CI's six jobs, including engineering unit tests in the build job, completed successfully. This is supporting CI evidence, not an adversarial PASS.

No review, QA, automatic/native/advisory comments or prior findings were fetched or used. Only PR body, issue #612 body, source, repository instructions and primary CI metadata were consulted. No subagents. Actual runtime: Codex; Node v24.19.0, installed pnpm 11.25.0. Exact model ID and session ID were not exposed and are not inferred.
