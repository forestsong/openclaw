import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeBuildRunArtifact } from "../../agents/build-runs.js";
import { buildContextReply } from "./commands-context-report.js";
import type { HandleCommandsParams } from "./commands-types.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function makeParams(
  commandBodyNormalized: string,
  truncated: boolean,
  options?: {
    omitBootstrapLimits?: boolean;
    omitPromptBudget?: boolean;
    omitTaskProfile?: boolean;
    sessionStore?: Record<string, unknown>;
  },
): HandleCommandsParams {
  return {
    command: {
      commandBodyNormalized,
      channel: "telegram",
      senderIsOwner: true,
    },
    sessionKey: "agent:default:main",
    workspaceDir: "/tmp/workspace",
    contextTokens: null,
    provider: "openai",
    model: "gpt-5",
    elevated: { allowed: false },
    resolvedThinkLevel: "off",
    resolvedReasoningLevel: "off",
    sessionEntry: {
      totalTokens: 123,
      inputTokens: 100,
      outputTokens: 23,
      retryReport: {
        status: "used",
        generatedAt: Date.now(),
        maxAttempts: 8,
        attemptsUsed: 3,
        retriesUsed: 2,
        remainingRetries: 5,
        entries: [
          {
            attempt: 1,
            reason: "auth_refresh",
            detail: "prompt auth error triggered runtime auth refresh",
          },
          {
            attempt: 2,
            reason: "thinking_fallback",
            detail: "assistant-stage fallback to minimal",
          },
        ],
      },
      failureReport: {
        status: "failed",
        generatedAt: Date.now(),
        category: "verification",
        source: "verify-runner",
        code: "verify_failed",
        summary: "1/2 verification checks failed",
        verifyChecksRun: 2,
        verifyChecksFailed: 1,
      },
      verifyReport: {
        status: "failed",
        strategy: "command-tool",
        generatedAt: Date.now(),
        checksRun: 2,
        checksPassed: 1,
        checksFailed: 1,
        entries: [
          {
            toolName: "exec",
            command: "pnpm test",
            kind: "test",
            status: "passed",
            exitCode: 0,
            source: "tool-result",
          },
          {
            toolName: "bash",
            command: "npm run build",
            kind: "build",
            status: "failed",
            exitCode: 1,
            source: "tool-result",
            evidence: [
              {
                kind: "screenshot",
                path: "/tmp/build-evidence.png",
              },
            ],
          },
        ],
      },
      systemPromptReport: {
        source: "run",
        generatedAt: Date.now(),
        workspaceDir: "/tmp/workspace",
        bootstrapMaxChars: options?.omitBootstrapLimits ? undefined : 20_000,
        bootstrapTotalMaxChars: options?.omitBootstrapLimits ? undefined : 150_000,
        sandbox: { mode: "off", sandboxed: false },
        ...(options?.omitTaskProfile
          ? {}
          : {
              taskProfile: {
                id: "coding",
                source: "tool-surface",
                signal: "read",
              },
            }),
        delegationProfile: {
          role: "main",
          rolePreset: "planner",
          promptMode: "plan",
          toolBias: "read-heavy",
          verificationPosture: "acceptance-first",
          artifactWriteScope: "planner-artifacts",
          controlScope: "children",
          depth: 0,
          canSpawn: true,
          canControlChildren: true,
          workspaceSource: "primary",
          workspaceDir: "/tmp/workspace",
          buildRunId: "run-42",
          buildRunDir: "/tmp/workspace/.openclaw/build-runs/run-42",
          delegationToolsAllowed: ["agents_list", "sessions_spawn", "subagents"],
          delegationToolsBlocked: ["sessions_list", "sessions_history", "sessions_send"],
        },
        workspacePolicyDiscovery: {
          totalDiscovered: 3,
          injectedCount: 2,
          candidateCount: 1,
          mergeOrder: ["AGENTS.md", "OPENCLAW.md"],
          conflictCount: 1,
          entries: [
            {
              name: "AGENTS.md",
              path: "/tmp/workspace/AGENTS.md",
              kind: "bootstrap",
              autoInjected: true,
              matchedBy: "bootstrap-name",
              policyRole: "global-guidance",
              mergePriority: 100,
              mergeTier: "primary",
              source: "workspace-root",
              conflictSummary: "shares global-guidance role with CLAUDE.md",
              conflictWith: ["CLAUDE.md"],
            },
            {
              name: "OPENCLAW.md",
              path: "/tmp/workspace/OPENCLAW.md",
              kind: "bootstrap",
              autoInjected: true,
              matchedBy: "bootstrap-name",
              policyRole: "repo-focus",
              mergePriority: 90,
              mergeTier: "primary",
              source: "workspace-root",
            },
            {
              name: "standing-orders.md",
              path: "/tmp/workspace/standing-orders.md",
              kind: "candidate",
              autoInjected: false,
              matchedBy: "policy-filename",
              policyRole: "candidate",
              mergePriority: 0,
              mergeTier: "candidate",
              source: "policy-scan",
            },
          ],
        },
        policySlicing: {
          totalSlicedChars: 543,
          slicedFileCount: 1,
          entries: [
            {
              name: "HEARTBEAT.md",
              path: "/tmp/workspace/HEARTBEAT.md",
              slicedChars: 543,
              reasons: ["heartbeat-only file excluded outside heartbeat runs"],
            },
          ],
        },
        toolPruning: {
          prunedCount: 2,
          prunedSummaryChars: 25,
          prunedSchemaChars: 120,
          entries: [
            {
              name: "browser",
              reason: "no explicit web or browser signal in prompt",
              summaryChars: 10,
              schemaChars: 80,
            },
            {
              name: "message",
              reason: "no explicit messaging or reply signal in prompt",
              summaryChars: 15,
              schemaChars: 40,
            },
          ],
        },
        skillPruning: {
          prunedCount: 2,
          prunedBlockChars: 240,
          entries: [
            {
              name: "healthcheck",
              reason: "no runtime ops signal in prompt",
              blockChars: 120,
            },
            {
              name: "skill-creator",
              reason: "no skill-authoring signal in prompt",
              blockChars: 120,
            },
          ],
        },
        systemPrompt: {
          chars: 1_000,
          projectContextChars: 500,
          nonProjectContextChars: 500,
        },
        ...(options?.omitPromptBudget
          ? {}
          : {
              promptBudget: {
                totalTrackedChars: 1_020,
                workspaceInjectedChars: truncated ? 20_000 : 10_000,
                skillsPromptChars: 10,
                toolListChars: 10,
                otherSystemPromptChars: truncated ? 0 : 980,
                toolSchemaChars: 20,
              },
            }),
        injectedWorkspaceFiles: [
          {
            name: "AGENTS.md",
            path: "/tmp/workspace/AGENTS.md",
            missing: false,
            rawChars: truncated ? 200_000 : 10_000,
            injectedChars: truncated ? 20_000 : 10_000,
            truncated,
          },
          {
            name: "HEARTBEAT.md",
            path: "/tmp/workspace/HEARTBEAT.md",
            missing: false,
            rawChars: 543,
            injectedChars: 0,
            truncated: false,
            sliced: true,
            slicedChars: 543,
            sliceReasons: ["heartbeat-only file excluded outside heartbeat runs"],
          },
        ],
        skills: {
          promptChars: 10,
          entries: [{ name: "checks", blockChars: 10 }],
        },
        tools: {
          listChars: 10,
          schemaChars: 20,
          entries: [{ name: "read", summaryChars: 10, schemaChars: 20, propertiesCount: 1 }],
        },
      },
    },
    sessionStore: options?.sessionStore as never,
    cfg: {},
    ctx: {},
    commandBody: "",
    commandArgs: [],
    resolvedElevatedLevel: "off",
  } as unknown as HandleCommandsParams;
}

describe("buildContextReply", () => {
  it("shows bootstrap truncation warning in list output when context exceeds configured limits", async () => {
    const result = await buildContextReply(makeParams("/context list", true));
    expect(result.text).toContain("Task profile: coding (tool-surface) | signal=read");
    expect(result.text).toContain(
      "Delegation profile: main | preset=planner | mode=plan | depth=0 | spawn=yes | children=yes | 3 delegation tools",
    );
    expect(result.text).toContain(
      "Workspace policy files: 3 discovered (2 injected, 1 candidate-only)",
    );
    expect(result.text).toContain("Workspace policy merge: AGENTS.md > OPENCLAW.md | overlaps=1");
    expect(result.text).toContain("Policy slicing: 1 file(s), 543 chars");
    expect(result.text).toContain("Dynamic tool pruning: 2 tool(s), 120 chars");
    expect(result.text).toContain("Dynamic skill pruning: 2 skill(s), 240 chars");
    expect(result.text).toContain("Verify runner: failed (1/2 checks passed)");
    expect(result.text).toContain(
      "Failure reason: verification (verify_failed) | 1/2 verification checks failed",
    );
    expect(result.text).toContain("Retry budget: used (3/8 attempts used, 5 retries left)");
    expect(result.text).toContain(
      "Failure-to-rule suggestions: 3 candidate rule(s) | top=Verify before final reply",
    );
    expect(result.text).toContain(
      "Cron health checks: daily isolated check suggested (0 9 * * *) | focus=verification failures, repeat retries",
    );
    expect(result.text).toContain(
      "Doc gardening: daily isolated check suggested (15 9 * * *) | stale=0 missing=3 metadata=0",
    );
    expect(result.text).toContain("Highlights:");
    expect(result.text).toContain("Largest prompt component: workspace files (20,000 chars");
    expect(result.text).toContain("Largest injected workspace file: AGENTS.md (20,000 chars");
    expect(result.text).toContain("Attention: verification (verify_failed)");
    expect(result.text).toContain(
      "Next leverage: fix or rerun the failing verification check before expanding the task.",
    );
    expect(result.text).toContain("Bootstrap max/total: 150,000 chars");
    expect(result.text).toContain("Prompt budget (tracked):");
    expect(result.text).toContain("- workspace files:");
    expect(result.text).toContain("- tool schemas:");
    expect(result.text).toContain("⚠ Bootstrap context is over configured limits");
    expect(result.text).toContain("Causes: 1 file(s) exceeded max/file.");
  });

  it("does not show bootstrap truncation warning when there is no truncation", async () => {
    const result = await buildContextReply(makeParams("/context list", false));
    expect(result.text).not.toContain("Bootstrap context is over configured limits");
  });

  it("falls back to config defaults when legacy reports are missing bootstrap limits", async () => {
    const result = await buildContextReply(
      makeParams("/context list", false, {
        omitBootstrapLimits: true,
      }),
    );
    expect(result.text).toContain("Bootstrap max/file: 20,000 chars");
    expect(result.text).toContain("Bootstrap max/total: 150,000 chars");
    expect(result.text).not.toContain("Bootstrap max/file: ? chars");
  });

  it("derives prompt budget lines when legacy reports are missing promptBudget", async () => {
    const result = await buildContextReply(
      makeParams("/context list", false, {
        omitPromptBudget: true,
      }),
    );
    expect(result.text).toContain("Task profile: coding (tool-surface) | signal=read");
    expect(result.text).toContain("Prompt budget (tracked):");
    expect(result.text).toContain("- workspace files: 10,000 chars");
    expect(result.text).toContain("- tool schemas: 20 chars");
  });

  it("derives task profile lines when legacy reports are missing taskProfile", async () => {
    const result = await buildContextReply(
      makeParams("/context list", false, {
        omitTaskProfile: true,
      }),
    );
    expect(result.text).toContain("Task profile: coding (tool-surface) | signal=read");
  });

  it("includes highlights in json output", async () => {
    const result = await buildContextReply(makeParams("/context json", false));
    expect(result.text).toContain('"highlights":');
    expect(result.text).toContain('"failureRuleSuggestions":');
    expect(result.text).toContain('"cronHealthCheckSuggestion":');
    expect(result.text).toContain('"docGardeningSuggestion":');
    expect(result.text).toContain('"workspaceHealthDashboard":');
    expect(result.text).toContain("Largest prompt component: workspace files (10,000 chars");
    expect(result.text).toContain("Attention: verification (verify_failed)");
  });

  it("shows a workspace health dashboard with profile and trend lines", async () => {
    const now = Date.now();
    const result = await buildContextReply(
      makeParams("/context health", false, {
        sessionStore: {
          "agent:default:previous": {
            sessionId: "previous",
            updatedAt: now - 9 * 24 * 60 * 60 * 1000,
            runtimeMs: 90_000,
            totalTokens: 30_000,
            estimatedCostUsd: 0.08,
            systemPromptReport: {
              source: "run",
              generatedAt: now - 9 * 24 * 60 * 60 * 1000,
              workspaceDir: "/tmp/workspace",
              taskProfile: {
                id: "research",
                source: "explicit",
              },
              systemPrompt: {
                chars: 1_000,
                projectContextChars: 500,
                nonProjectContextChars: 500,
              },
              promptBudget: {
                totalTrackedChars: 24_000,
                workspaceInjectedChars: 4_000,
                skillsPromptChars: 2_000,
                toolListChars: 1_000,
                otherSystemPromptChars: 7_000,
                toolSchemaChars: 10_000,
              },
              injectedWorkspaceFiles: [],
              skills: { promptChars: 10, entries: [] },
              tools: { listChars: 10, schemaChars: 10_000, entries: [] },
            },
            verifyReport: {
              status: "passed",
              strategy: "command-tool",
              generatedAt: now - 9 * 24 * 60 * 60 * 1000,
              checksRun: 1,
              checksPassed: 1,
              checksFailed: 0,
              entries: [],
            },
            failureReport: {
              status: "none",
              generatedAt: now - 9 * 24 * 60 * 60 * 1000,
              category: "none",
              source: "none",
              code: "none",
              summary: "none",
            },
            retryReport: {
              status: "unused",
              generatedAt: now - 9 * 24 * 60 * 60 * 1000,
              maxAttempts: 8,
              attemptsUsed: 1,
              retriesUsed: 0,
              remainingRetries: 7,
              entries: [],
            },
          },
        },
      }),
    );
    expect(result.text).toContain("🩺 Workspace health dashboard");
    expect(result.text).toContain("Matched sessions: 2");
    expect(result.text).toContain("Profiles:");
    expect(result.text).toContain("- coding:");
    expect(result.text).toContain("- research:");
    expect(result.text).toContain("Trends (7d vs previous 7d):");
    expect(result.text).toContain("- Current:");
    expect(result.text).toContain("- Previous:");
    expect(result.text).toContain("Attention:");
  });

  it("returns machine-readable dashboard data for /context health json", async () => {
    const result = await buildContextReply(makeParams("/context health json", false));
    expect(result.text).toContain('"workspaceDir": "/tmp/workspace"');
    expect(result.text).toContain('"profiles":');
    expect(result.text).toContain('"overall":');
    expect(result.text).toContain('"trends":');
  });

  it("shows discovered workspace policy files in detail output", async () => {
    const result = await buildContextReply(makeParams("/context detail", false));
    expect(result.text).toContain("Discovered workspace policy files:");
    expect(result.text).toContain(
      "- standing-orders.md: candidate | candidate-only | role=candidate | tier=candidate | priority=0 | source=policy-scan | match=policy-filename",
    );
    expect(result.text).toContain("conflict=shares global-guidance role with CLAUDE.md");
    expect(result.text).toContain("Policy slicing:");
    expect(result.text).toContain("- HEARTBEAT.md: sliced 543 chars");
    expect(result.text).toContain("Verify checks:");
    expect(result.text).toContain(
      "- build: failed | exit=1 | npm run build | evidence=screenshot:/tmp/build-evidence.png",
    );
    expect(result.text).toContain("Failure details:");
    expect(result.text).toContain("- source=verify-runner");
    expect(result.text).toContain("Retry entries:");
    expect(result.text).toContain("- rolePreset=planner");
    expect(result.text).toContain("- promptMode=plan");
    expect(result.text).toContain("- toolBias=read-heavy");
    expect(result.text).toContain("- verificationPosture=acceptance-first");
    expect(result.text).toContain("- artifactWriteScope=planner-artifacts");
    expect(result.text).toContain("- buildRunId=run-42");
    expect(result.text).toContain("- buildRunDir=/tmp/workspace/.openclaw/build-runs/run-42");
    expect(result.text).toContain(
      "- attempt 2: thinking_fallback | assistant-stage fallback to minimal",
    );
    expect(result.text).toContain("Failure-to-rule suggestions:");
    expect(result.text).toContain(
      "- Verify before final reply: After code or runtime changes, run the smallest relevant verification command before claiming success. | evidence=1/2 verification checks failed | apply=/context rule apply verify-before-final",
    );
    expect(result.text).toContain("Cron health check suggestion:");
    expect(result.text).toContain("- cadence=daily");
    expect(result.text).toContain("- schedule=cron 0 9 * * *");
    expect(result.text).toContain("- sessionTarget=isolated");
    expect(result.text).toContain("- install=/context cron install");
    expect(result.text).toContain("Doc gardening suggestion:");
    expect(result.text).toContain("- cadence=daily");
    expect(result.text).toContain("- schedule=cron 15 9 * * *");
    expect(result.text).toContain("- install=/context docs install");
    expect(result.text).toContain(
      "- issue=missing | docs/concepts/docs-index.md | required repo-knowledge entry is missing",
    );
    expect(result.text).toContain("Highlights:");
    expect(result.text).toContain("Largest prompt component: workspace files (10,000 chars");
  });

  it("shows build-run round summaries and blocking findings in detail/json output", async () => {
    const repoRoot = await makeTempDir("openclaw-context-build-run-");
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    const workspaceDir = path.join(repoRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-42",
      artifactName: "build-report",
      value: {
        round: 1,
        role: "builder",
        generated_at: 1_001,
        session_key: "builder:r1",
        summary: "Initial dashboard shell",
        commands_run: ["pnpm test"],
        files_changed: ["src/app.tsx"],
        known_gaps: ["CTA still hidden"],
      },
    });
    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-42",
      artifactName: "eval-report",
      value: {
        round: 1,
        role: "evaluator",
        generated_at: 1_010,
        session_key: "evaluator:r1",
        parent_round: 1,
        status: "failed",
        summary: "CTA missing on dashboard",
        checks_run: 3,
        checks_passed: 2,
        checks_failed: 1,
        blocking_findings: [
          {
            id: "cta-missing",
            kind: "browser",
            summary: "Primary CTA is still missing",
            severity: "high",
            category: "verification",
            evidence_refs: ["screenshot:/tmp/cta-missing.png"],
          },
        ],
        retry_advice: ["Builder should restore the primary CTA before another evaluator round"],
        recommended_next_role: "builder",
      },
    });
    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-42",
      artifactName: "build-report",
      value: {
        round: 2,
        role: "builder",
        generated_at: 2_001,
        session_key: "builder:r2",
        parent_round: 1,
        summary: "CTA render path updated",
        commands_run: ["pnpm test", "pnpm build"],
        files_changed: ["src/app.tsx", "src/components/cta.tsx"],
        known_gaps: [],
      },
    });

    const params = makeParams("/context detail", false);
    params.workspaceDir = workspaceDir;
    if (params.sessionEntry?.systemPromptReport) {
      params.sessionEntry.systemPromptReport.workspaceDir = workspaceDir;
      if (params.sessionEntry.systemPromptReport.delegationProfile) {
        params.sessionEntry.systemPromptReport.delegationProfile.workspaceDir = workspaceDir;
        params.sessionEntry.systemPromptReport.delegationProfile.buildRunDir = path.join(
          repoRoot,
          ".openclaw",
          "build-runs",
          "run-42",
        );
      }
    }

    const detail = await buildContextReply(params);
    expect(detail.text).toContain("Build run: run-42 | latest=2 | builder=2 | evaluator=1 failed");
    expect(detail.text).toContain("Build run:");
    expect(detail.text).toContain("- latestRound=2");
    expect(detail.text).toContain("- latestBuildRound=2");
    expect(detail.text).toContain("- latestEvalRound=1");
    expect(detail.text).toContain("- latestEvalStatus=failed");
    expect(detail.text).toContain("- recommendedNextRole=builder");
    expect(detail.text).toContain(
      "- finding=cta-missing | high | verification | Primary CTA is still missing | evidence=screenshot:/tmp/cta-missing.png",
    );
    expect(detail.text).toContain(
      "- retry=Builder should restore the primary CTA before another evaluator round",
    );

    const jsonParams = makeParams("/context json", false);
    jsonParams.workspaceDir = workspaceDir;
    if (jsonParams.sessionEntry?.systemPromptReport?.delegationProfile) {
      jsonParams.sessionEntry.systemPromptReport.workspaceDir = workspaceDir;
      jsonParams.sessionEntry.systemPromptReport.delegationProfile.workspaceDir = workspaceDir;
      jsonParams.sessionEntry.systemPromptReport.delegationProfile.buildRunDir = path.join(
        repoRoot,
        ".openclaw",
        "build-runs",
        "run-42",
      );
    }
    const json = await buildContextReply(jsonParams);
    expect(json.text).toContain('"buildRunSummary"');
    expect(json.text).toContain('"latestRound": 2');
    expect(json.text).toContain('"recommended_next_role": "builder"');
  });
});
