# PostgreSQL Query Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore the latest main regression suite and prove authenticated Agent queries execute real PostgreSQL SQL with enforced user permissions.

**Architecture:** Use a disposable PostgreSQL schema and temporary SQLite platform database. Exercise HTTP login, datasource/dataset setup, theme binding, permissions, query execution and revocation. A deterministic harness submits tool calls; the HTTP server, contract compiler, SQL executor, PostgreSQL driver, result lock and audit storage remain real.

**Tech Stack:** Node.js test runner, pg, existing platform HTTP/session APIs, PostgreSQL 17 GitHub service.

**Spec:** `docs/postgresql.md`, `docs/architecture.md`; user-approved acceptance scope in this conversation: nightly checks, real PostgreSQL Agent query/results/audit, then revoke permissions in the same session.

## Global Constraints

- Never use a business database; require `YOLO_PG_TEST_DATABASE` and create/drop a random schema.
- Do not add core dependencies or change authentication defaults.
- Reuse existing managed worktree and PostgreSQL CI service.
- Do not claim external LLM acceptance: model tool selection is deterministic, database execution is real.
- No production behavior changes without a reproduced regression and a failing test.

## Review Focus

- No configured test database: explicit skip locally, mandatory execution in the PostgreSQL CI job.
- Adversarial requested region: row policy must force the authorized region in returned rows and executed SQL parameters.
- Dataset permission revoked: an existing session must not execute another dataset query or return previously cached results as fresh data.
- Theme permission revoked: existing-session queries must return 403 before executing SQL.
- Failure during setup: close HTTP server/pools/SQLite, stop timers and remove the disposable schema.

### Task 1: Restore the current main regression test

**Files:** Modify `tests/businessDatasets.test.js`.
**Interfaces:** Existing `compile_query_contract` guard returns `BUSINESS_DATASET_EXECUTION_REQUIRED`; no production interface changes.

- [x] Reproduce full coverage failure on main `3ec4234` and isolate the failing test. Author changed the user-facing error to Chinese; the test still requires an English source-type token.
- [x] Replace the `/BUSINESS_DATASET/` message assertion with `assert.equal(answer.message, blockedError.message)`. Retain existing assertions for the stable error code, recoverable flag and excluded indicator tool.
- [x] Run the focused test, `node --test --experimental-test-coverage`, `npm run lint`, and `npm run eval`; require zero failures.
- [x] Commit the test-only correction separately.

### Task 2: Real PostgreSQL query and revocation acceptance

**Files:** Create `tests/postgresql.query.http.test.js`; modify `.github/workflows/ci.yml`; extend `docs/postgresql.md` validation instructions.
**Interfaces:** Use existing session login and `/api/chat/query`; read `database.listDatasetQueryLogs()` for persisted SQL/user/dataset/success evidence. Reuse `compile_query_contract` and `execute_query_contract` tool schemas in `src/agent.js`.

- [x] Add an opt-in test with temporary platform storage, session credentials, a random PostgreSQL schema and `sales(day date, region text, amount numeric)` containing east=10, east=30, west=1000. Close all resources in `finally`.
- [x] Through authenticated management HTTP requests create the PG source/dataset, discover fields, bind the dataset to a theme, and grant the analyst access with a forced east row policy. Use fixed dates covering the fixture rows.
- [x] Submit a deterministic Agent tool sequence through the real query HTTP endpoint. Ask for west while the row policy requires east; assert actual returned aggregate=40, no west rows, a locked execution result, and successful persisted query audit for the correct user/dataset. Never stub `executeQuery`, pool access or result rows.
- [x] Revoke dataset access over HTTP and retry in the same session; assert no new successful SQL audit and no fresh executable result. Restore dataset access, revoke theme access, retry in the same session and assert HTTP 403 with no SQL execution. Include an unauthorized-user attempt before granting access.
- [x] Register this file in the existing PostgreSQL integration CI step. Without a local PG server, default suite must explicitly skip; the CI job must execute the test with zero skips.
- [x] Document that this proves real database execution under deterministic tool selection, not live external-model quality.
- [x] Run full coverage/lint/eval, then create and attach a PR. Require successful PostgreSQL integration and existing browser acceptance before reporting completion.

## Execution Evidence So Far

- Latest main: `3ec4234e7decda102b470dc9e6efd9acb4be54e8`.
- Full coverage: 403 tests, 394 passed, 1 failed, 8 skipped; aggregate line coverage 85.64%.
- Focused failing regression reproduced independently.
- Architecture check: zero errors. Semantic eval: 4/4 passed.
- Upstream GitHub account has pull-only permissions; cannot dispatch upstream nightly directly.
- No local `docker`, `psql`, `postgres` or `initdb` executable found on PATH. Real PostgreSQL execution will be required in the existing CI service.

## Self-Review

The two tasks cover every requested acceptance item. Production execution must stay real; the deterministic harness is limited to tool selection. Existing CI provides the disposable PG service, and default local skips cannot satisfy database acceptance. Resource cleanup and both dataset/theme revocation cases are explicit checks.

## Final Verification Record

Local final coverage: 405 tests, 396 passed, 9 explicitly environment-gated skipped, zero failures; line coverage 85.64%. Lint has zero errors and eval passes 4/4. The first real PG acceptance passed in CI run 38739771379. Independent review led to stronger revoked-response/tool-bypass assertions, driver-parameter observation and a setup-failure cleanup regression test; that cleanup test was verified RED then GREEN. The updated final head must pass the PostgreSQL and browser CI jobs before the PR leaves draft. External-model quality is explicitly outside this acceptance scope.
