# Ductura SUB+Free Runtime Implementation Plan

> For agentic workers: execute inline with superpowers:executing-plans; owner explicitly requested autonomous implementation in this session.

**Goal:** Pretvoriti odobreni SUB+Free raspored u testirani lokalni kontroler bez dodatne naplate.
**Architecture:** Standard-library Python CLI, SQLite registar, stroga task/worktree provjera, svježa evidencija financiranja i ograničeni native CLI adapteri. Stanje je izvan repoa; kanonski GitHub gate ostaje nepromijenjen.
**Tech Stack:** Python >=3.11, sqlite3, subprocess, Git, PowerShell; bez novih product dependencies.
**Spec:** docs/superpowers/specs/2026-10-06-sub-free-runtime.md

## Global Constraints
- 12 profila; 3 managed izvršavanja; 1 catch-up writer / 2 normal writera; 1 heavy job.
- Bez PAYG, dodatnih kredita, API fallbacka, novih kupnji, samostalnog merga ili tuđih worktreeova.
- Neizvjesnost prijave/kvote znači blokadu, ne pretpostavljeni PASS.
- Samo DESKTOP-LJMIVR9; lokalni registar nije globalna kontrola svih chatova.

## Review Focus
- Dvije simultane dodjele koriste stvarnu SQLite transakciju i samo jedna može dobiti isti task.
- Istek heartbeat-a ne dopušta drugom workeru da preuzme živ proces.
- Putanje sa .., simboličke poveznice, netočan remote i main checkout moraju biti odbijeni.
- Native CLI config/credential stanje nije dokaz da su extra credits/PAYG ugašeni.
- Timeout ili prevelik izlaz ostavljaju točan status, bez lažnog završetka.

### Task 1: Policy + transactional registry
Files: scripts/ai_runtime/policy.py, registry.py, tests/test_runtime.py.
Interfaces: validate_task(task), validate_funding(provider,evidence,now,executable_sha), Registry.acquire/finish/orphans/recover/status.
- [x] Write failing tests for validation, reservation, WIP, collisions and recovery.
- [x] Run unittest; confirm RED before implementation.
- [x] Implement pure policy and transactional registry.
- [x] Run unit tests; confirm GREEN.

### Task 2: Git and provider boundaries
Files: workspace.py, providers.py, tests/test_execution.py.
Interfaces: inspect_workspace(task,repo), prepare_worktree(repo,task_id,role), build_command(task,executable,prompt), clean_environment().
- [x] Test a real temporary Git repository, invalid remotes/refs and dirty worktrees.
- [x] Implement read-only preflight, exact commands, funding gate and safe env.
- [x] Test no fallback, disabled subagents and non-mutating dry-run.

### Task 3: Bounded execution + interface
Files: process.py, cli.py, scripts/ductus_ai.py, docs/AI_RUNTIME.md.
Interfaces: bounded_process(command,cwd,env,timeout), execute(task,repo,state), CLI doctor/status/prepare/check/run/handoff; recovery via guarded internal API.
- [x] Test success, error, timeout, output cap and redaction with synthetic child processes.
- [x] Implement bounded execution and persistent result/handoff.
- [ ] Test full CLI with local synthetic fixtures, then on Windows.
- [ ] Run existing product checks; record actual failures without weakening tests.
- [ ] Publish isolated PR for independent review; do not self-merge or falsify gate evidence.

## Izvedbeni zapis

54 nova testa prolaze u Linux okruženju; RED→GREEN zapisi čuvaju se uz isporuku. Fizički Windows je nakon pripreme worktreea prestao odgovarati. Windows/native-provider smoke i potpuni postojeći CI nisu označeni dovršenima. Specifične naredbe iz plana usklađene su sa stvarnim Python entrypointom; nema nepotrebnog novog PowerShell runtime sloja.
