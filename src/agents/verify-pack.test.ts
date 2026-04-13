import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeBuildRunArtifact } from "./build-runs.js";
import { __testing, executeVerifyPack } from "./verify-pack.js";
import type { VerifyObservation } from "./verify-report.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  __testing.setDepsForTest(null);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function makeObservation(overrides: Partial<VerifyObservation> = {}): VerifyObservation {
  return {
    toolName: "exec",
    command: "pnpm test",
    kind: "test",
    status: "passed",
    exitCode: 0,
    source: "tool-result",
    ...overrides,
  };
}

async function makeRepoWorkspace(prefix: string) {
  const repoRoot = await makeTempDir(prefix);
  await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
  const workspaceDir = path.join(repoRoot, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });
  return { repoRoot, workspaceDir };
}

describe("executeVerifyPack", () => {
  it("returns no extra entries when no verify-pack artifact exists", async () => {
    const { workspaceDir } = await makeRepoWorkspace("openclaw-verify-pack-missing-");

    const result = await executeVerifyPack({
      workspaceDir,
      buildRunId: "run-001",
      observations: [],
    });

    expect(result).toEqual([]);
  });

  it("evaluates exec, logs, and report checks from the build-run root", async () => {
    const { workspaceDir } = await makeRepoWorkspace("openclaw-verify-pack-pass-");

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-002",
      artifactName: "build-report",
      value: {
        round: 1,
        summary: "Implemented dashboard shell",
        commands_run: ["pnpm test"],
        files_changed: ["src/app.ts"],
        known_gaps: [],
      },
    });
    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-002",
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
            id: "logs-ok",
            kind: "logs",
            command: "pnpm test",
            match: "All tests passed",
          },
          {
            id: "build-report-summary",
            kind: "report",
            artifact: "build-report",
            requiredFields: ["summary", "round"],
            fieldEquals: { round: 1 },
          },
        ],
      },
    });

    const result = await executeVerifyPack({
      workspaceDir,
      buildRunId: "run-002",
      observations: [
        makeObservation({
          command: "pnpm test",
          output: "All tests passed\nDone in 2.1s",
        }),
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({ checkId: "unit-tests", kind: "test", status: "passed" }),
      expect.objectContaining({ checkId: "logs-ok", kind: "logs", status: "passed" }),
      expect.objectContaining({
        checkId: "build-report-summary",
        kind: "report",
        status: "passed",
      }),
    ]);
  });

  it("returns structured failures for missing commands and bad report fields", async () => {
    const { workspaceDir } = await makeRepoWorkspace("openclaw-verify-pack-fail-");

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-003",
      artifactName: "build-report",
      value: {
        round: 2,
        summary: "Implemented shell",
        commands_run: [],
        files_changed: [],
        known_gaps: [],
      },
    });
    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-003",
      artifactName: "verify-pack",
      value: {
        checks: [
          {
            id: "missing-build",
            kind: "exec",
            command: "pnpm build",
            expectExitCode: 0,
          },
          {
            id: "bad-round",
            kind: "report",
            artifact: "build-report",
            fieldEquals: { round: 1 },
          },
        ],
      },
    });

    const result = await executeVerifyPack({
      workspaceDir,
      buildRunId: "run-003",
      observations: [makeObservation()],
    });

    expect(result).toEqual([
      expect.objectContaining({
        checkId: "missing-build",
        status: "failed",
        message: "expected exec check command was not observed in this run",
      }),
      expect.objectContaining({
        checkId: "bad-round",
        status: "failed",
      }),
    ]);
  });

  it("fails clearly when verify-pack is malformed", async () => {
    const { repoRoot, workspaceDir } = await makeRepoWorkspace("openclaw-verify-pack-invalid-");
    const runDir = path.join(repoRoot, ".openclaw", "build-runs", "run-004");
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, "verify-pack.json"),
      JSON.stringify({
        checks: [
          {
            id: "bad-regex",
            kind: "logs",
            match: "(",
            mode: "regex",
          },
        ],
      }),
      "utf-8",
    );

    const result = await executeVerifyPack({
      workspaceDir,
      buildRunId: "run-004",
      observations: [makeObservation({ output: "hello" })],
    });

    expect(result).toEqual([
      expect.objectContaining({
        checkId: "verify-pack-load",
        kind: "report",
        status: "failed",
        command: "load verify-pack.json",
      }),
    ]);
  });

  it("evaluates browser checks with action, assertion, and screenshot evidence", async () => {
    const { workspaceDir } = await makeRepoWorkspace("openclaw-verify-pack-browser-pass-");

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-005",
      artifactName: "verify-pack",
      value: {
        checks: [
          {
            id: "browser-home",
            kind: "browser",
            url: "http://127.0.0.1:3000",
            action: {
              kind: "click",
              selector: "[data-testid='launch']",
            },
            assert: {
              text: "Workspace dashboard",
              selector: "[data-testid='hero']",
              urlIncludes: "/dashboard",
            },
            screenshot: {
              fullPage: true,
            },
          },
        ],
      },
    });

    const browserNavigateMock = vi.fn(async () => ({
      ok: true as const,
      targetId: "tab-1",
      url: "http://127.0.0.1:3000/dashboard",
    }));
    const browserActMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        targetId: "tab-1",
        url: "http://127.0.0.1:3000/dashboard",
      })
      .mockResolvedValueOnce({
        ok: true as const,
        targetId: "tab-1",
        url: "http://127.0.0.1:3000/dashboard",
      });
    const browserSnapshotMock = vi.fn(async () => ({
      ok: true as const,
      format: "ai" as const,
      targetId: "tab-1",
      url: "http://127.0.0.1:3000/dashboard",
      snapshot: "Workspace dashboard\nPrimary CTA",
    }));
    const browserScreenshotActionMock = vi.fn(async () => ({
      ok: true as const,
      path: "/tmp/browser-home.png",
      targetId: "tab-1",
      url: "http://127.0.0.1:3000/dashboard",
    }));

    __testing.setDepsForTest({
      browserNavigate: browserNavigateMock,
      browserAct: browserActMock,
      browserSnapshot: browserSnapshotMock,
      browserScreenshotAction: browserScreenshotActionMock,
    });

    const result = await executeVerifyPack({
      workspaceDir,
      buildRunId: "run-005",
      observations: [],
      browser: {
        available: true,
        hostControlAllowed: true,
      },
    });

    expect(browserNavigateMock).toHaveBeenCalledWith(undefined, {
      url: "http://127.0.0.1:3000",
      targetId: undefined,
      profile: undefined,
    });
    expect(browserActMock).toHaveBeenCalledTimes(2);
    expect(browserSnapshotMock).toHaveBeenCalledOnce();
    expect(browserScreenshotActionMock).toHaveBeenCalledOnce();
    expect(result).toEqual([
      expect.objectContaining({
        checkId: "browser-home",
        kind: "browser",
        status: "passed",
        message: 'verified "http://127.0.0.1:3000/dashboard"',
        evidence: expect.arrayContaining([
          expect.objectContaining({
            kind: "snapshot",
            url: "http://127.0.0.1:3000/dashboard",
          }),
          expect.objectContaining({
            kind: "screenshot",
            path: "/tmp/browser-home.png",
          }),
        ]),
      }),
    ]);
  });

  it("evaluates api checks with structured response evidence", async () => {
    const { workspaceDir } = await makeRepoWorkspace("openclaw-verify-pack-api-");

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-006",
      artifactName: "verify-pack",
      value: {
        checks: [
          {
            id: "api-health",
            kind: "api",
            method: "GET",
            url: "http://127.0.0.1:8000/health",
            expectStatus: 200,
            bodyIncludes: ["ok"],
            jsonFieldEquals: {
              status: "ok",
            },
          },
        ],
      },
    });

    const fetchMock = vi.fn(async () => ({
      status: 200,
      url: "http://127.0.0.1:8000/health",
      text: async () => JSON.stringify({ status: "ok", version: 1 }),
    }));
    __testing.setDepsForTest({
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const result = await executeVerifyPack({
      workspaceDir,
      buildRunId: "run-006",
      observations: [],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual([
      expect.objectContaining({
        checkId: "api-health",
        kind: "api",
        status: "passed",
        evidence: [
          expect.objectContaining({
            kind: "response",
            url: "http://127.0.0.1:8000/health",
          }),
        ],
      }),
    ]);
  });

  it("evaluates log-file and artifact-backed checks with file evidence", async () => {
    const { repoRoot, workspaceDir } = await makeRepoWorkspace("openclaw-verify-pack-files-");
    const logsDir = path.join(workspaceDir, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path.join(logsDir, "app.log"), "server ready\nhealth ok\n", "utf-8");

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-007",
      artifactName: "build-report",
      value: {
        round: 1,
        summary: "Built dashboard shell",
        commands_run: ["pnpm test"],
        files_changed: ["src/app.tsx"],
        known_gaps: [],
      },
    });
    const runDir = path.join(repoRoot, ".openclaw", "build-runs", "run-007");
    await fs.writeFile(
      path.join(runDir, "notes.txt"),
      "dashboard ready\nprimary cta visible\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(runDir, "summary.json"),
      JSON.stringify({ deployment: { status: "green" } }),
      "utf-8",
    );
    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-007",
      artifactName: "verify-pack",
      value: {
        checks: [
          {
            id: "log-ready",
            kind: "log-file",
            path: "logs/app.log",
            root: "workspace",
            match: "health ok",
          },
          {
            id: "artifact-note",
            kind: "artifact-text",
            path: "notes.txt",
            root: "build-run",
            match: "primary cta visible",
          },
          {
            id: "artifact-json",
            kind: "artifact-json",
            path: "summary.json",
            root: "build-run",
            requiredFields: ["deployment.status"],
            fieldEquals: {
              "deployment.status": "green",
            },
          },
        ],
      },
    });

    const result = await executeVerifyPack({
      workspaceDir,
      buildRunId: "run-007",
      buildRunDir: runDir,
      observations: [],
    });

    expect(result).toEqual([
      expect.objectContaining({
        checkId: "log-ready",
        kind: "log-file",
        status: "passed",
        evidence: [expect.objectContaining({ kind: "file", path: path.join(logsDir, "app.log") })],
      }),
      expect.objectContaining({
        checkId: "artifact-note",
        kind: "artifact-text",
        status: "passed",
        evidence: [expect.objectContaining({ kind: "file", path: path.join(runDir, "notes.txt") })],
      }),
      expect.objectContaining({
        checkId: "artifact-json",
        kind: "artifact-json",
        status: "passed",
        evidence: [
          expect.objectContaining({ kind: "file", path: path.join(runDir, "summary.json") }),
        ],
      }),
    ]);
  });

  it("fails browser checks clearly when browser use is blocked by policy", async () => {
    const { workspaceDir } = await makeRepoWorkspace("openclaw-verify-pack-browser-blocked-");

    await writeBuildRunArtifact({
      workspaceDir,
      runId: "run-008",
      artifactName: "verify-pack",
      value: {
        checks: [
          {
            id: "browser-home",
            kind: "browser",
            url: "http://127.0.0.1:3000",
            assert: {
              text: "Dashboard",
            },
          },
        ],
      },
    });

    const result = await executeVerifyPack({
      workspaceDir,
      buildRunId: "run-008",
      observations: [],
      browser: {
        available: false,
        hostControlAllowed: false,
      },
    });

    expect(result).toEqual([
      expect.objectContaining({
        checkId: "browser-home",
        kind: "browser",
        status: "failed",
        message:
          "browser evaluator check blocked because the browser tool is unavailable in the current run policy",
      }),
    ]);
  });
});
