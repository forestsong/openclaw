---
summary: Planner / builder / evaluator 手工 build loop 操作手册，基于 build-run artifact 和 verify-pack contract
read_when:
  - 你想在专用 loop runner 出现前，先手工跑一版 role-scoped build loop
  - 你需要 planner、builder、evaluator 之间的交接样例
  - 你想给长时间 build 任务设定清晰 stop line
owner: OpenClaw harness
freshness: monthly
last_reviewed: "2026-03-27"
title: Role-Scoped Build Walkthrough
---

# Role-Scoped Build Walkthrough

这是一份面向 OpenClaw 第一版 `planner -> builder -> evaluator` 流程的手工操作手册。

它适合在还没有专门 loop runner 的时候，先把长时间 build 工作跑成一条稳定方法。

参见：

- [Role-scoped build loop](/exec-plans/role-scoped-build-loop)
- [Role-scoped build loop Phase 1 backlog](/exec-plans/role-scoped-build-loop-phase-1-backlog)
- [上下文](/concepts/context)

## 今天已经有的底座

OpenClaw 现在已经具备：

- `planner`、`builder`、`evaluator` 角色预设
- `.openclaw/build-runs/<run-id>/` 下稳定的 artifact root
- `acceptance.json`、`verify-pack.json`、`build-report.json`、`eval-report.json` 的 schema-backed 读写能力
- 通过 `/context` 查看 verify、failure、retry、delegation 的诊断面

这份文档的作用，就是把这些现成 runtime 能力串成一条可手工执行的 loop。

## 默认 artifact root

对 repo workspace，默认目录是：

```text
<repo>/.openclaw/build-runs/<run-id>/
```

例如：

```text
/repo/.openclaw/build-runs/dashboard-v1/
```

## Step 1：先跑 planner

先为这次 build 取一个清晰的 `run-id`。

planner 的目标：

- 定清楚 scope
- 写 `acceptance.json`
- 写 `verify-pack.json`
- 明确 builder 不该做什么

推荐 prompt 形状：

```text
You are the planner for build run dashboard-v1.
Write acceptance.json and verify-pack.json under the build-run artifact root.
Keep the scope small. Prefer blocking checks that can actually be verified.
Do not edit product code.
```

planner 最低输出：

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

## Step 2：把活交给 builder

builder 的目标：

- 严格按 planner artifact 实现
- 控制 scope，不要一边做一边扩
- 写 `build-report.json`
- 在声称完成前，先跑最小相关验证命令

推荐 prompt 形状：

```text
You are the builder for build run dashboard-v1.
Read acceptance.json and verify-pack.json from the build-run root first.
Implement only the in-scope work.
Before finishing, write build-report.json with commands_run, files_changed, and known_gaps.
```

builder 最低输出：

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

## Step 3：再跑 evaluator

evaluator 的目标：

- 像 QA，而不是像礼貌总结器
- 读取 `verify-pack.json`
- 优先寻找反证
- 任一 blocking check 失败就判这轮失败
- 写 `eval-report.json`

推荐 prompt 形状：

```text
You are the evaluator for build run dashboard-v1.
Load acceptance.json, verify-pack.json, and build-report.json.
Run the verify pack.
Prefer disconfirming evidence over approval.
If a blocking check fails, write eval-report.json as failed and explain the next retry target.
Do not edit code in this pass.
```

evaluator 最低输出：

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

## 怎么观察这条 loop

每一轮之后，至少看：

- `/context list`
- `/context detail`
- `/context health`

最关键的信号是：

- `Delegation profile`
- `Verify runner`
- `Failure reason`
- `Retry budget`
- `Workspace policy files`
- `Policy slicing`

对于 browser-backed evaluator checks，`/context detail` 现在应该能显示 browser verify entry 和 evidence path。

## Step 4：多轮操作这条 loop

Phase 2 默认一个 build run 可能会经历多轮 builder/evaluator。

推荐节奏：

1. builder 写 round 1 的 `build-report.json`
2. evaluator 写 round 1 的 `eval-report.json`
3. 如果还有 blocking finding，builder 进入 round 2，并把 `parent_round` 指回失败的上一轮
4. evaluator 再检查最新 round，要么清掉这条 run，要么返回更紧的 blocking-finding contract

round 2 的 builder 例子：

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

round 2 的 evaluator 例子：

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

当一条 run 跨多轮时，`/context detail` 至少要一屏讲清楚三件事：

- 当前 build run id 和 artifact root
- 最新 builder / evaluator round 各是第几轮
- top blocking finding、evidence ref，以及建议下一步由哪个角色接手

## Stop conditions

满足下面任意一个条件就该停：

- 所有 blocking checks 都通过
- retry budget 已耗尽
- evaluator 持续在同一 blocking 条件上失败，而且 builder 没有继续缩小差距
- planner artifact 明显写错了，需要先重写 contract 再继续

## 推荐工作规则

- `acceptance.json` 和 `verify-pack.json` 保持短、小、硬。
- 优先保留一个真正代表用户路径的 blocking browser check，而不是堆很多浅层 check。
- 不要让 builder 在中途自行改 acceptance。
- 如果 evaluator 的证据和 builder 自评冲突，优先相信 evaluator 路径。
- 如果某类失败重复出现，用 `/context rule apply` 把它沉淀成 policy。

## 这份文档不是什么

这不是一个新的 orchestration DSL。

它只是建立在 OpenClaw 现有 harness 能力之上的手工 recipe：

- roles
- artifacts
- verify / failure / retry
- `/context`

这已经足够让长时间 build 任务比纯聊天编排更稳定。
