import { describe, expect, it } from "vitest";
import {
  buildVerifyEntryFromObservation,
  buildVerifyObservationFromToolResult,
  buildVerifyReport,
} from "./verify-report.js";

describe("verify-report observations", () => {
  it("captures generic exec commands as command observations without surfacing them as default verify entries", () => {
    const observation = buildVerifyObservationFromToolResult({
      toolName: "exec",
      args: { command: "git status --short" },
      result: {
        details: {
          status: "completed",
          exitCode: 0,
          durationMs: 50,
          aggregated: "M src/app.ts",
        },
      },
      isToolError: false,
    });

    expect(observation).toEqual(
      expect.objectContaining({
        kind: "command",
        status: "passed",
        output: "M src/app.ts",
      }),
    );
    expect(observation && buildVerifyEntryFromObservation(observation)).toBeUndefined();
  });

  it("marks mixed tool-result and verify-pack entries as hybrid strategy", () => {
    const report = buildVerifyReport({
      generatedAt: Date.now(),
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
          toolName: "verify-pack",
          checkId: "build-report-present",
          command: "report build-report.json",
          kind: "report",
          status: "passed",
          exitCode: null,
          source: "verify-pack",
        },
      ],
    });

    expect(report.strategy).toBe("hybrid");
    expect(report.status).toBe("passed");
    expect(report.checksRun).toBe(2);
  });
});
