import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRunRoundArtifactFilename,
  readBuildRunArtifact,
  readBuildRunRoundState,
  readBuildRunRoundStateFromRunDir,
  resolveBuildRunRoot,
  slugifyBuildRunWorkspace,
  writeBuildRunArtifact,
} from "./build-runs.js";
import { discoverWorkspacePolicyFiles } from "./workspace.js";

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

describe("build runs", () => {
  it("uses repo-local artifact roots when workspace is inside a git repo", async () => {
    const repoRoot = await makeTempDir("openclaw-build-runs-repo-");
    await fs.writeFile(path.join(repoRoot, ".git"), "gitdir: .git/modules/main\n", "utf-8");
    const workspaceDir = path.join(repoRoot, "apps", "web");
    await fs.mkdir(workspaceDir, { recursive: true });

    const resolved = resolveBuildRunRoot({
      workspaceDir,
      runId: "run-001",
    });

    expect(resolved.storage).toBe("repo-local");
    expect(resolved.repoRoot).toBe(repoRoot);
    expect(resolved.runDir).toBe(path.join(repoRoot, ".openclaw", "build-runs", "run-001"));
  });

  it("falls back to state-dir build-runs roots outside git repos", async () => {
    const stateDir = await makeTempDir("openclaw-build-runs-state-");
    const workspaceDir = await makeTempDir("openclaw-build-runs-workspace-");

    const resolved = resolveBuildRunRoot({
      workspaceDir,
      runId: "run-002",
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_TEST_FAST: "1",
      },
    });

    expect(resolved.storage).toBe("state-dir");
    expect(resolved.workspaceSlug).toBe(slugifyBuildRunWorkspace(workspaceDir));
    expect(resolved.runDir).toBe(
      path.join(stateDir, "build-runs", slugifyBuildRunWorkspace(workspaceDir), "run-002"),
    );
  });

  it("writes and reads schema-backed build artifacts", async () => {
    const repoRoot = await makeTempDir("openclaw-build-runs-write-");
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    const workspaceDir = path.join(repoRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    const written = await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-003",
      artifactName: "acceptance",
      value: {
        goal: "Ship a small dashboard",
        in_scope: ["dashboard"],
        out_of_scope: ["admin"],
        blocking_checks: [
          {
            id: "dashboard-renders",
            description: "dashboard renders",
            kind: "functional",
          },
        ],
        quality_bars: {
          functionality: "required",
        },
      },
    });

    expect(written.path).toBe(
      path.join(repoRoot, ".openclaw", "build-runs", "run-003", "acceptance.json"),
    );

    const readBack = await readBuildRunArtifact({
      workspaceDir,
      runId: "run-003",
      artifactName: "acceptance",
    });

    expect(readBack.goal).toBe("Ship a small dashboard");
    expect(readBack.blocking_checks).toHaveLength(1);
  });

  it("stores multi-round build/eval artifacts and resolves latest round summaries", async () => {
    const repoRoot = await makeTempDir("openclaw-build-runs-rounds-");
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    const workspaceDir = path.join(repoRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-rounds",
      artifactName: "build-report",
      value: {
        round: 1,
        role: "builder",
        generated_at: 1_001,
        session_key: "builder:round-1",
        summary: "Initial shell built",
        commands_run: ["pnpm test"],
        files_changed: ["src/app.tsx"],
        known_gaps: ["No evaluator pass yet"],
      },
    });
    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-rounds",
      artifactName: "eval-report",
      value: {
        round: 1,
        role: "evaluator",
        generated_at: 1_002,
        session_key: "evaluator:round-1",
        parent_round: 1,
        status: "failed",
        summary: "CTA missing",
        checks_run: 3,
        checks_passed: 2,
        checks_failed: 1,
        blocking_findings: [
          {
            id: "primary-cta-missing",
            kind: "browser",
            summary: "primary-cta missing",
            severity: "high",
            category: "verification",
            evidence_refs: ["screenshot:/tmp/cta.png"],
          },
        ],
        retry_advice: ["Builder should restore CTA render path"],
        recommended_next_role: "builder",
      },
    });
    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-rounds",
      artifactName: "build-report",
      value: {
        round: 2,
        role: "builder",
        generated_at: 2_001,
        session_key: "builder:round-2",
        parent_round: 1,
        summary: "CTA restored",
        commands_run: ["pnpm test", "pnpm dev"],
        files_changed: ["src/app.tsx", "src/components/cta.tsx"],
        known_gaps: [],
      },
    });

    const latestBuildReport = await readBuildRunArtifact({
      workspaceDir,
      runId: "run-rounds",
      artifactName: "build-report",
    });
    expect(latestBuildReport.round).toBe(2);
    expect(latestBuildReport.parent_round).toBe(1);

    const roundState = await readBuildRunRoundState({
      workspaceDir,
      runId: "run-rounds",
    });

    expect(roundState.latestRound).toBe(2);
    expect(roundState.buildReports.map((entry) => entry.round)).toEqual([1, 2]);
    expect(roundState.evalReports.map((entry) => entry.round)).toEqual([1]);
    expect(roundState.latestBuildReport).toEqual(
      expect.objectContaining({
        artifactName: "build-report",
        round: 2,
        role: "builder",
        generatedAt: 2_001,
        sessionKey: "builder:round-2",
      }),
    );
    expect(roundState.latestEvalReport).toEqual(
      expect.objectContaining({
        artifactName: "eval-report",
        round: 1,
        status: "failed",
        checksRun: 3,
        topBlockingFindingId: "primary-cta-missing",
        topBlockingFindingSummary: "primary-cta missing",
        blockingFindingCount: 1,
        recommendedNextRole: "builder",
      }),
    );

    const roundsDir = path.join(repoRoot, ".openclaw", "build-runs", "run-rounds", "rounds");
    await expect(
      fs.readFile(
        path.join(
          roundsDir,
          buildRunRoundArtifactFilename({ artifactName: "build-report", round: 1 }),
        ),
        "utf-8",
      ),
    ).resolves.toContain('"round": 1');
    await expect(
      fs.readFile(
        path.join(
          roundsDir,
          buildRunRoundArtifactFilename({ artifactName: "build-report", round: 2 }),
        ),
        "utf-8",
      ),
    ).resolves.toContain('"round": 2');
  });

  it("validates and reads verify-pack artifacts with exec/logs/report/browser checks", async () => {
    const repoRoot = await makeTempDir("openclaw-build-runs-verify-pack-");
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    const workspaceDir = path.join(repoRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-verify",
      artifactName: "verify-pack",
      value: {
        checks: [
          {
            id: "unit-tests",
            kind: "exec",
            command: "pnpm test",
            expectExitCode: 0,
          },
          {
            id: "stdout-clean",
            kind: "logs",
            command: "pnpm test",
            match: "passed",
          },
          {
            id: "report-summary",
            kind: "report",
            artifact: "build-report",
            requiredFields: ["summary"],
          },
          {
            id: "home-page-renders",
            kind: "browser",
            url: "http://127.0.0.1:3000",
            assert: {
              text: "Dashboard",
              selector: "[data-testid='hero']",
            },
            screenshot: {
              fullPage: true,
            },
          },
        ],
      },
    });

    const readBack = await readBuildRunArtifact({
      workspaceDir,
      runId: "run-verify",
      artifactName: "verify-pack",
    });

    expect(readBack.checks).toEqual([
      expect.objectContaining({ id: "unit-tests", kind: "exec" }),
      expect.objectContaining({ id: "stdout-clean", kind: "logs" }),
      expect.objectContaining({ id: "report-summary", kind: "report" }),
      expect.objectContaining({ id: "home-page-renders", kind: "browser" }),
    ]);
  });

  it("rejects malformed artifact payloads with useful errors", async () => {
    const repoRoot = await makeTempDir("openclaw-build-runs-invalid-");
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    const workspaceDir = path.join(repoRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    await expect(
      writeBuildRunArtifact({
        workspaceDir,
        runId: "run-004",
        artifactName: "build-report",
        value: {
          round: 1,
          summary: 42,
        },
      }),
    ).rejects.toThrow("Invalid build-report.json");

    await expect(
      writeBuildRunArtifact({
        workspaceDir,
        runId: "run-004",
        artifactName: "eval-report",
        value: {
          round: 0,
          status: "failed",
          summary: "Evaluator failed",
        },
      }),
    ).rejects.toThrow("Invalid eval-report.json");
  });

  it("keeps legacy single-round artifacts readable through round-state helpers", async () => {
    const repoRoot = await makeTempDir("openclaw-build-runs-legacy-");
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    const workspaceDir = path.join(repoRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    const runDir = path.join(repoRoot, ".openclaw", "build-runs", "run-legacy");
    await fs.mkdir(runDir, { recursive: true });

    await fs.writeFile(
      path.join(runDir, "build-report.json"),
      `${JSON.stringify(
        {
          round: 3,
          summary: "Legacy builder artifact",
          commands_run: ["pnpm test"],
          files_changed: ["src/app.tsx"],
          known_gaps: [],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    await fs.writeFile(
      path.join(runDir, "eval-report.json"),
      `${JSON.stringify(
        {
          status: "passed",
          summary: "Legacy evaluator artifact",
          blocking_findings: [],
          retry_advice: [],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const roundState = await readBuildRunRoundStateFromRunDir({ runDir });

    expect(roundState.latestRound).toBe(3);
    expect(roundState.latestBuildReport).toEqual(
      expect.objectContaining({
        round: 3,
        role: "builder",
        generatedAt: 0,
      }),
    );
    expect(roundState.latestEvalReport).toEqual(
      expect.objectContaining({
        round: 1,
        role: "evaluator",
        generatedAt: 0,
        status: "passed",
      }),
    );
  });

  it("keeps repo-local build-run artifacts out of workspace policy discovery", async () => {
    const repoRoot = await makeTempDir("openclaw-build-runs-policy-");
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, ".openclaw", "build-runs", "run-005"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, ".openclaw", "build-runs", "run-005", "workflow.md"),
      "build artifact note",
      "utf-8",
    );
    await fs.writeFile(path.join(repoRoot, "AGENTS.md"), "repo guidance", "utf-8");

    const discovered = discoverWorkspacePolicyFiles({
      dir: repoRoot,
      bootstrapFiles: [
        {
          name: "AGENTS.md",
          path: path.join(repoRoot, "AGENTS.md"),
          content: "repo guidance",
          missing: false,
        },
      ],
    });

    expect(discovered.map((entry) => entry.name)).toEqual(["AGENTS.md"]);
  });
});
