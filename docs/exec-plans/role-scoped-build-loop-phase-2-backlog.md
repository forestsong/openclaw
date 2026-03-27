---
summary: "Actionable Phase 2 backlog for turning the first role-scoped build loop into a round-aware evaluator workflow"
read_when:
  - You finished Role-Scoped Build Loop Phase 1 and want the next highest-leverage work
  - You need richer evaluator packs and better build-round visibility before adding a loop runner
  - You want a concrete issue order for P5 Phase 2
owner: "OpenClaw harness"
freshness: "monthly"
last_reviewed: "2026-03-27"
title: "Role-Scoped Build Loop Phase 2 Backlog"
---

# Role-Scoped Build Loop Phase 2 Backlog

## Goal

Turn the Phase 1 role-scoped build recipe into a round-aware evaluator workflow that humans and agents can inspect, trust, and repeat before any dedicated loop runner exists.

## Why Phase 2 exists

Phase 1 gave OpenClaw the minimum viable build-loop substrate:

- role presets
- stable build-run artifacts
- role-aware spawn defaults
- `verify-pack.json`
- a first browser-backed evaluator slice
- a manual walkthrough

That is enough to run the loop.

It is not yet enough to run multiple rounds cleanly or explain evaluator decisions well enough for long-running app work.

The next quality jump should come from:

- round-aware build/eval reporting
- richer evaluator packs beyond browser + exec
- a stable blocking-finding contract
- `/context` visibility into the active build run

## Phase 2 definition

Phase 2 is complete when OpenClaw can do all of the following without introducing a loop DSL:

- represent multiple planner/builder/evaluator rounds under one build run
- surface the current build-run status and latest blocking findings in `/context`
- execute at least two richer evaluator pack families beyond `exec / logs / report / browser`
- emit stable evaluator findings with evidence references instead of loose summaries

## Stop line

Do not build a general loop runner, automatic round scheduler, or PR automation on top of P5 until the issues in this file are complete.

That stop line matters because Phase 1 already proved the role recipe is viable. The bigger risk now is automating an evaluator workflow before build-round state and evaluator outputs are trustworthy enough to drive further action.

## Recommended issue order

1. `reporting/build-round-schema-and-artifacts`
2. `context/build-run-round-reporting`
3. `verify/api-evaluator-pack`
4. `verify/log-artifact-evaluator-pack`
5. `evaluator/blocking-findings-contract`
6. `docs/manual-build-round-ops`

## Issue 1: `reporting/build-round-schema-and-artifacts`

**Title**

`runtime: make build-report and eval-report round-aware with stable per-round metadata`

**Why**

Phase 1 artifacts describe a single pass well enough, but they do not yet make long-running retries or multiple evaluator rounds easy to inspect. Without round state, build runs remain hard to audit.

**Goal**

Add minimal round-aware metadata to build-loop artifacts.

**Scope**

- extend `build-report.json` with round metadata such as:
  - `round`
  - `role`
  - `generated_at`
  - `session_key` or equivalent run ref
  - `parent_round`
- extend `eval-report.json` with round metadata plus summary status fields
- add helpers to resolve the latest round for a build run
- keep existing single-round readers backward compatible when possible

**Non-goals**

- no loop scheduler
- no artifact history compaction
- no new chat transcript storage model

**Likely files**

- `src/agents/build-runs.ts`
- `src/agents/build-runs.test.ts`
- `src/config/sessions/types.ts`
- `src/agents/system-prompt-report.ts`

**Deliverables**

- round-aware artifact schema updates
- helper to read latest build/eval round summary
- regression tests for multi-round artifact loading

**Acceptance criteria**

- a build run can store multiple rounds without ambiguity
- helpers can find the latest builder and evaluator round for a run
- malformed round metadata fails clearly

## Issue 2: `context/build-run-round-reporting`

**Title**

`context: surface active build-run status, round summaries, and top findings`

**Why**

Once a build run spans several rounds, `/context detail` must explain where the run is now, not just generic verify/failure state.

**Goal**

Expose build-run round state clearly in operator-facing reporting.

**Scope**

- add build-run summary to system/session reporting
- show current build-run id, latest round numbers, and latest evaluator status
- show artifact paths or refs for:
  - `acceptance.json`
  - `verify-pack.json`
  - latest `build-report.json`
  - latest `eval-report.json`
- surface top blocking findings and retry advice

**Non-goals**

- no separate dashboard page yet
- no loop control command yet

**Likely files**

- `src/agents/system-prompt-report.ts`
- `src/auto-reply/reply/commands-context-report.ts`
- `src/auto-reply/reply/commands-context-report.test.ts`

**Deliverables**

- build-run summary block in `/context`
- machine-readable JSON output for build-run state
- focused tests for round summary rendering

**Acceptance criteria**

- `/context detail` can explain the current build run in one screen
- humans can tell which round failed and where to inspect evidence next
- the new reporting reuses existing verify/failure/retry surfaces instead of replacing them

## Issue 3: `verify/api-evaluator-pack`

**Title**

`verify: add api/http evaluator checks with status, body, and JSON field assertions`

**Why**

Browser checks cover user-visible UI, but many long-running app tasks also need API truth. Health endpoints, JSON responses, and mutation flows are often the fastest disconfirming signal.

**Goal**

Add a first network-backed evaluator pack for API/HTTP checks.

**Scope**

- extend `verify-pack.json` with `api` checks
- support:
  - method
  - URL
  - headers
  - request body
  - expected status
  - body includes
  - JSON field equality
- capture structured response evidence

**Non-goals**

- no broad HTTP workflow engine
- no auth-secret orchestration beyond existing config/runtime paths
- no external SaaS test runner

**Likely files**

- `src/agents/build-runs.ts`
- `src/agents/verify-pack.ts`
- `src/agents/verify-pack.test.ts`
- `src/auto-reply/reply/commands-context-report.ts`

**Deliverables**

- `api` verify-pack kind
- structured response evidence
- failing status/body/json checks through existing failure reporting

**Acceptance criteria**

- a build run can assert an API health or core endpoint contract through `verify-pack.json`
- API evaluator output records enough evidence for a builder retry
- `/context detail` shows the failing API check clearly

## Issue 4: `verify/log-artifact-evaluator-pack`

**Title**

`verify: add log-file and artifact-evidence evaluator checks for long-running apps`

**Why**

Not every important failure appears in stdout or browser output. Real app work often needs evidence from log files, exported artifacts, or machine-written reports.

**Goal**

Add richer evidence checks for log files and artifact-backed text/JSON assertions.

**Scope**

- extend `verify-pack.json` with:
  - `log-file` checks
  - `artifact-json` or `artifact-text` checks
- support:
  - file existence
  - text includes / regex
  - JSON field assertions
- keep evidence references in structured verify entries

**Non-goals**

- no full observability stack query language
- no generic DB migration verifier yet

**Likely files**

- `src/agents/build-runs.ts`
- `src/agents/verify-pack.ts`
- `src/agents/verify-pack.test.ts`
- `src/config/sessions/types.ts`

**Deliverables**

- log/artifact verify-pack kinds
- evidence path support for non-browser checks
- tests for pass/fail behavior

**Acceptance criteria**

- evaluator can fail a round based on a real log/artifact signal, not only stdout
- verify entries point to the relevant evidence path when possible
- the new checks compose with the current verify/failure path

## Issue 5: `evaluator/blocking-findings-contract`

**Title**

`evaluator: add stable blocking-finding schema and calibrated eval-report output`

**Why**

Long-running build loops need more than a pass/fail bit. Builders need a stable contract describing what blocked the round, how severe it is, and what evidence backs it.

**Goal**

Make evaluator findings first-class artifacts instead of loose prose.

**Scope**

- strengthen `eval-report.json` with:
  - `blocking_findings`
  - `severity`
  - `category`
  - `evidence_refs`
  - `retry_advice`
  - `recommended_next_role`
- define the minimum evaluator summary contract for future builder retries
- make `/context` surface the top blocking findings

**Non-goals**

- no subjective visual design rubric yet
- no automatic patch generation from findings

**Likely files**

- `src/agents/build-runs.ts`
- `src/auto-reply/reply/commands-context-report.ts`
- `src/agents/failure-report.ts`
- `src/agents/build-runs.test.ts`

**Deliverables**

- stronger `eval-report.json` schema
- structured finding rendering in `/context`
- sample artifact payloads in docs/tests

**Acceptance criteria**

- evaluator output can identify one or more blocking findings with stable ids
- builders can tell what to fix next without rereading the whole session
- blocking findings can be linked to verify evidence

## Issue 6: `docs/manual-build-round-ops`

**Title**

`docs: extend the manual build-loop walkthrough for multi-round evaluator operation`

**Why**

Phase 2 adds richer evaluator packs and round reporting. The operating recipe must explain how humans and agents should use them before more automation appears.

**Goal**

Update docs so Phase 2 is a usable operating method, not just runtime pieces.

**Scope**

- extend the walkthrough with:
  - multi-round builder/evaluator examples
  - API/log/artifact evaluator examples
  - how to inspect the latest round in `/context`
  - stop/replan criteria
- link the new docs from repo knowledge indexes

**Non-goals**

- no new command surface
- no benchmark report yet

**Likely files**

- `docs/concepts/role-scoped-build-walkthrough.md`
- `docs/zh-CN/concepts/role-scoped-build-walkthrough.md`
- `docs/concepts/docs-index.md`

**Deliverables**

- updated walkthrough
- example artifacts for richer evaluator packs
- explicit operator stop conditions for Phase 2

**Acceptance criteria**

- a human can run a two-round build/eval loop without guessing the next step
- the walkthrough points to the exact `/context` surfaces used for debugging
