---
summary: "Manual walkthrough for planner / builder / evaluator runs using build-run artifacts and verify-pack contracts"
read_when:
  - You want to run the first role-scoped build loop manually before a dedicated loop runner exists
  - You need concrete examples for planner, builder, and evaluator handoff artifacts
  - You want a repeatable stop line for long-running build work
owner: "OpenClaw harness"
freshness: "monthly"
last_reviewed: "2026-03-27"
title: "Role-Scoped Build Walkthrough"
---

# Role-Scoped Build Walkthrough

This is the manual recipe for the first `planner -> builder -> evaluator` loop in OpenClaw.

Use it when you want the long-running build workflow without introducing a new orchestration command surface yet.

See also:

- [Role-scoped build loop](/exec-plans/role-scoped-build-loop)
- [Role-scoped build loop Phase 1 backlog](/exec-plans/role-scoped-build-loop-phase-1-backlog)
- [Context](/concepts/context)

## What exists today

OpenClaw already gives you:

- role presets: `planner`, `builder`, `evaluator`
- stable artifact roots under `.openclaw/build-runs/<run-id>/`
- schema-backed artifact helpers for `acceptance.json`, `verify-pack.json`, `build-report.json`, and `eval-report.json`
- verify, failure, retry, and delegation reporting through `/context`

This walkthrough turns those runtime pieces into a repeatable manual loop.

## Default artifact root

For a repo workspace:

```text
<repo>/.openclaw/build-runs/<run-id>/
```

Example:

```text
/repo/.openclaw/build-runs/dashboard-v1/
```

## Step 1: Start with a planner run

Create or choose a `run-id` that names the build target.

Planner objective:

- clarify scope
- write `acceptance.json`
- write `verify-pack.json`
- state what the builder should not do

Good planner prompt shape:

```text
You are the planner for build run dashboard-v1.
Write acceptance.json and verify-pack.json under the build-run artifact root.
Keep the scope small. Prefer blocking checks that can actually be verified.
Do not edit product code.
```

Minimum planner outputs:

### `acceptance.json`

```json
{
  "goal": "Ship a small dashboard shell",
  "in_scope": ["Landing shell", "Primary CTA", "Status card"],
  "out_of_scope": ["Settings", "Auth redesign"],
  "blocking_checks": [
    {
      "id": "dashboard-renders",
      "description": "Dashboard shell renders and primary CTA is visible",
      "kind": "functional"
    }
  ],
  "quality_bars": {
    "functionality": "required",
    "code_quality": "important"
  }
}
```

### `verify-pack.json`

```json
{
  "checks": [
    {
      "id": "typecheck",
      "kind": "exec",
      "blocking": true,
      "command": "pnpm typecheck",
      "expectExitCode": 0
    },
    {
      "id": "home-renders",
      "kind": "browser",
      "blocking": true,
      "url": "http://127.0.0.1:3000",
      "assert": {
        "text": "Dashboard",
        "selector": "[data-testid='primary-cta']"
      },
      "screenshot": {
        "fullPage": true
      }
    }
  ]
}
```

## Step 2: Hand off to the builder

Builder objective:

- implement only against planner artifacts
- keep scope bounded
- write `build-report.json`
- run the smallest relevant verification commands before claiming success

Good builder prompt shape:

```text
You are the builder for build run dashboard-v1.
Read acceptance.json and verify-pack.json from the build-run root first.
Implement only the in-scope work.
Before finishing, write build-report.json with commands_run, files_changed, and known_gaps.
```

Minimum builder output:

### `build-report.json`

```json
{
  "round": 1,
  "role": "builder",
  "generated_at": 1760000000000,
  "session_key": "builder:dashboard-v1:round-1",
  "summary": "Built dashboard shell and wired primary CTA",
  "commands_run": ["pnpm typecheck", "pnpm test"],
  "files_changed": ["src/app.tsx", "src/components/dashboard-card.tsx"],
  "known_gaps": ["No evaluator pass on settings route"]
}
```

## Step 3: Run the evaluator

Evaluator objective:

- behave like QA, not like a polite summary
- load `verify-pack.json`
- prefer disconfirming evidence
- fail the round if any blocking check fails
- write `eval-report.json`

Good evaluator prompt shape:

```text
You are the evaluator for build run dashboard-v1.
Load acceptance.json, verify-pack.json, and build-report.json.
Run the verify pack.
Prefer disconfirming evidence over approval.
If a blocking check fails, write eval-report.json as failed and explain the next retry target.
Do not edit code in this pass.
```

Minimum evaluator output:

### `eval-report.json`

```json
{
  "round": 1,
  "role": "evaluator",
  "generated_at": 1760000005000,
  "session_key": "evaluator:dashboard-v1:round-1",
  "parent_round": 1,
  "status": "failed",
  "checks_run": 3,
  "checks_passed": 2,
  "checks_failed": 1,
  "summary": "Typecheck passed, but the primary CTA was not visible after navigation",
  "blocking_findings": ["home-renders failed"],
  "retry_advice": [
    "Builder should restore the primary CTA render path before another evaluator run"
  ]
}
```

## How to inspect the loop

After each round, use:

- `/context list`
- `/context detail`
- `/context health`

The most useful signals are:

- `Delegation profile`
- `Verify runner`
- `Failure reason`
- `Retry budget`
- `Workspace policy files`
- `Policy slicing`

For browser-backed evaluator checks, `/context detail` should show the browser verify entry and any evidence path captured during the run.

## Step 4: Operate multiple rounds

Phase 2 assumes one build run may span several builder/evaluator passes.

Recommended loop:

1. Builder writes `build-report.json` for round 1.
2. Evaluator writes `eval-report.json` for round 1.
3. If blocking findings remain, builder starts round 2 and sets `parent_round` to the failed evaluator round.
4. Evaluator inspects the new round and either clears the run or returns a tighter blocking-finding contract.

Round 2 builder example:

```json
{
  "round": 2,
  "role": "builder",
  "generated_at": 1760000010000,
  "session_key": "builder:dashboard-v1:round-2",
  "parent_round": 1,
  "summary": "Restored CTA render path and tightened dashboard layout",
  "commands_run": ["pnpm test", "pnpm build"],
  "files_changed": ["src/app.tsx", "src/components/cta.tsx"],
  "known_gaps": []
}
```

Round 2 evaluator example:

```json
{
  "round": 2,
  "role": "evaluator",
  "generated_at": 1760000015000,
  "session_key": "evaluator:dashboard-v1:round-2",
  "parent_round": 2,
  "status": "failed",
  "checks_run": 4,
  "checks_passed": 3,
  "checks_failed": 1,
  "summary": "CTA renders, but save API still returns 500",
  "blocking_findings": [
    {
      "id": "save-api-500",
      "kind": "api",
      "summary": "Save API still returns 500 on valid form submission",
      "severity": "high",
      "category": "verification",
      "evidence_refs": ["response:http://127.0.0.1:8000/api/save"]
    }
  ],
  "retry_advice": [
    "Builder should inspect the save handler and retry after restoring 200 responses"
  ],
  "recommended_next_role": "builder"
}
```

When a run spans multiple rounds, `/context detail` should make three things obvious in one screen:

- current build run id and artifact root
- latest builder and evaluator round numbers
- top blocking findings, evidence refs, and the recommended next role

## Stop conditions

Stop the loop when any of these becomes true:

- all blocking checks pass
- retry budget is exhausted
- evaluator keeps failing on the same blocking condition and the builder is no longer reducing the gap
- the planner artifacts are clearly wrong and need to be rewritten before more coding

## Recommended operating rules

- Keep `acceptance.json` and `verify-pack.json` intentionally small.
- Prefer one blocking browser check that reflects a real user path over many shallow checks.
- Do not let the builder redefine acceptance mid-run.
- If evaluator evidence contradicts builder self-report, trust the evaluator path.
- If a failure repeats, turn it into a policy candidate with `/context rule apply`.

## What this walkthrough is not

This is not a new orchestration DSL.

It is a manual operating recipe built on top of the existing OpenClaw harness:

- roles
- artifacts
- verify/failure/retry
- `/context`

That is enough to make long-running build work more stable before a dedicated loop runner exists.
