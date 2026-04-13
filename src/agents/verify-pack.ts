import fs from "node:fs/promises";
import path from "node:path";
import {
  browserAct,
  browserNavigate,
  browserScreenshotAction,
  type BrowserActRequest,
} from "../browser/client-actions.js";
import { browserSnapshot } from "../browser/client.js";
import type { SessionVerifyReport } from "../config/sessions/types.js";
import {
  buildRunArtifactFilename,
  readBuildRunArtifact,
  readBuildRunArtifactFromRunDir,
  type BuildRunArtifactName,
  type VerifyPackArtifact,
  type VerifyPackCheck,
} from "./build-runs.js";
import type { VerifyObservation } from "./verify-report.js";

type VerifyPackExecutionParams = {
  workspaceDir: string;
  buildRunId?: string | null;
  buildRunDir?: string | null;
  env?: NodeJS.ProcessEnv;
  observations: VerifyObservation[];
  browser?: {
    available?: boolean;
    baseUrl?: string;
    hostControlAllowed?: boolean;
  };
};

const verifyPackDeps = {
  browserAct,
  browserNavigate,
  browserScreenshotAction,
  browserSnapshot,
  fetch: globalThis.fetch.bind(globalThis),
};

export const __testing = {
  setDepsForTest(
    overrides: Partial<{
      browserAct: typeof browserAct;
      browserNavigate: typeof browserNavigate;
      browserScreenshotAction: typeof browserScreenshotAction;
      browserSnapshot: typeof browserSnapshot;
      fetch: typeof globalThis.fetch;
    }> | null,
  ) {
    verifyPackDeps.browserAct = overrides?.browserAct ?? browserAct;
    verifyPackDeps.browserNavigate = overrides?.browserNavigate ?? browserNavigate;
    verifyPackDeps.browserScreenshotAction =
      overrides?.browserScreenshotAction ?? browserScreenshotAction;
    verifyPackDeps.browserSnapshot = overrides?.browserSnapshot ?? browserSnapshot;
    verifyPackDeps.fetch = overrides?.fetch ?? globalThis.fetch.bind(globalThis);
  },
};

type VerifyEntry = SessionVerifyReport["entries"][number];
type VerifyEvidence = NonNullable<VerifyEntry["evidence"]>[number];

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  const causeCode =
    "cause" in (error as Record<string, unknown>) &&
    (error as { cause?: { code?: unknown } }).cause?.code;
  return code === "ENOENT" || causeCode === "ENOENT";
}

function getValueAtPath(value: unknown, fieldPath: string): unknown {
  if (!fieldPath.trim()) {
    return value;
  }
  const parts = fieldPath.split(".").filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (
      !current ||
      typeof current !== "object" ||
      !(part in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function buildVerifyPackEntry(params: {
  checkId: string;
  kind: SessionVerifyReport["entries"][number]["kind"];
  command: string;
  status: "passed" | "failed";
  exitCode?: number | null;
  message?: string;
  evidence?: VerifyEntry["evidence"];
}): SessionVerifyReport["entries"][number] {
  return {
    toolName: "verify-pack",
    checkId: params.checkId,
    command: params.command,
    kind: params.kind,
    status: params.status,
    exitCode: params.exitCode ?? null,
    source: "verify-pack",
    ...(params.message ? { message: params.message } : {}),
    ...(params.evidence?.length ? { evidence: params.evidence } : {}),
  };
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function truncateDetail(value: string, max = 240): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}...`;
}

function evaluateTextMatch(params: {
  text: string;
  match: string;
  mode: "includes" | "regex";
  errorPrefix: string;
}): { passed: boolean; message?: string } {
  if (params.mode === "regex") {
    let matcher: RegExp;
    try {
      matcher = new RegExp(params.match, "m");
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid regex";
      throw new Error(`${params.errorPrefix}: invalid regex: ${message}`, { cause: error });
    }
    return {
      passed: matcher.test(params.text),
      message: `expected content to match /${params.match}/`,
    };
  }
  return {
    passed: params.text.includes(params.match),
    message: `expected content to include "${params.match}"`,
  };
}

function resolveFileCheckPath(params: {
  workspaceDir: string;
  buildRunDir?: string | null;
  root: "workspace" | "build-run";
  filePath: string;
}): { path?: string; error?: string } {
  const rawPath = params.filePath.trim();
  if (!rawPath) {
    return { error: "file path is empty" };
  }
  if (path.isAbsolute(rawPath)) {
    return { path: rawPath };
  }
  if (params.root === "workspace") {
    return { path: path.join(params.workspaceDir, rawPath) };
  }
  const buildRunDir = trimToUndefined(params.buildRunDir ?? undefined);
  if (!buildRunDir) {
    return { error: "build-run rooted file checks require buildRunDir" };
  }
  return { path: path.join(buildRunDir, rawPath) };
}

async function loadArtifactFromBuildRun<TName extends BuildRunArtifactName>(params: {
  workspaceDir: string;
  buildRunId?: string | null;
  buildRunDir?: string | null;
  artifactName: TName;
  env?: NodeJS.ProcessEnv;
}) {
  const buildRunDir =
    typeof params.buildRunDir === "string" && params.buildRunDir.trim()
      ? params.buildRunDir.trim()
      : undefined;
  if (buildRunDir) {
    return readBuildRunArtifactFromRunDir({
      runDir: buildRunDir,
      artifactName: params.artifactName,
    });
  }
  const buildRunId =
    typeof params.buildRunId === "string" && params.buildRunId.trim()
      ? params.buildRunId.trim()
      : undefined;
  if (!buildRunId) {
    return null;
  }
  return readBuildRunArtifact({
    workspaceDir: params.workspaceDir,
    runId: buildRunId,
    artifactName: params.artifactName,
    env: params.env,
  });
}

function evaluateExecCheck(params: {
  check: Extract<VerifyPackCheck, { kind: "exec" }>;
  observations: VerifyObservation[];
}): SessionVerifyReport["entries"][number] {
  const expectedCommand = normalizeCommand(params.check.command);
  const matching = params.observations.filter(
    (observation) => normalizeCommand(observation.command) === expectedCommand,
  );
  if (matching.length === 0) {
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "command",
      command: params.check.command,
      status: "failed",
      message: "expected exec check command was not observed in this run",
    });
  }
  const passing = matching.find(
    (observation) =>
      observation.status === "passed" &&
      (observation.exitCode ?? 0) === params.check.expectExitCode,
  );
  if (passing) {
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: passing.kind === "command" ? "command" : passing.kind,
      command: params.check.command,
      status: "passed",
      exitCode: passing.exitCode,
    });
  }
  const last = matching[matching.length - 1];
  return buildVerifyPackEntry({
    checkId: params.check.id,
    kind: last.kind === "command" ? "command" : last.kind,
    command: params.check.command,
    status: "failed",
    exitCode: last.exitCode,
    message: `expected exit ${params.check.expectExitCode}, observed ${last.exitCode ?? "null"}`,
  });
}

function evaluateLogsCheck(params: {
  check: Extract<VerifyPackCheck, { kind: "logs" }>;
  observations: VerifyObservation[];
}): SessionVerifyReport["entries"][number] {
  const expectedCommand = params.check.command ? normalizeCommand(params.check.command) : undefined;
  const matching = params.observations.filter((observation) => {
    if (!observation.output?.trim()) {
      return false;
    }
    if (!expectedCommand) {
      return true;
    }
    return normalizeCommand(observation.command) === expectedCommand;
  });
  if (matching.length === 0) {
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "logs",
      command: params.check.command
        ? `logs for ${params.check.command}`
        : "logs across observed exec commands",
      status: "failed",
      message: params.check.command
        ? "no matching command output found for logs check"
        : "no command output found for logs check",
    });
  }
  const combined = matching
    .map((observation) => observation.output?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
  let passed = false;
  if (params.check.mode === "regex") {
    let matcher: RegExp;
    try {
      matcher = new RegExp(params.check.match, "m");
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid regex";
      throw new Error(
        `Invalid ${buildRunArtifactFilename("verify-pack")}: check "${params.check.id}" has invalid regex: ${message}`,
        { cause: error },
      );
    }
    passed = matcher.test(combined);
  } else {
    passed = combined.includes(params.check.match);
  }
  return buildVerifyPackEntry({
    checkId: params.check.id,
    kind: "logs",
    command: params.check.command
      ? `logs for ${params.check.command}`
      : "logs across observed exec commands",
    status: passed ? "passed" : "failed",
    message: passed
      ? undefined
      : params.check.mode === "regex"
        ? `expected logs to match /${params.check.match}/`
        : `expected logs to include "${params.check.match}"`,
  });
}

async function evaluateApiCheck(params: {
  check: Extract<VerifyPackCheck, { kind: "api" }>;
}): Promise<VerifyEntry> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.check.timeoutMs ?? 30_000);
  try {
    const response = await verifyPackDeps.fetch(params.check.url, {
      method: params.check.method,
      headers: {
        ...(params.check.json !== undefined ? { "content-type": "application/json" } : {}),
        ...params.check.headers,
      },
      body:
        params.check.body ??
        (params.check.json !== undefined ? JSON.stringify(params.check.json) : undefined),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    const responseUrl = trimToUndefined(response.url) ?? params.check.url;
    const evidence: VerifyEntry["evidence"] = [
      {
        kind: "response",
        url: responseUrl,
        detail: `status=${response.status} body=${truncateDetail(bodyText) || "(empty)"}`,
      },
    ];
    const failures: string[] = [];
    if (response.status !== params.check.expectStatus) {
      failures.push(`expected status ${params.check.expectStatus}, got ${response.status}`);
    }
    for (const needle of params.check.bodyIncludes) {
      if (!bodyText.includes(needle)) {
        failures.push(`response body missing ${JSON.stringify(needle)}`);
      }
    }
    if (Object.keys(params.check.jsonFieldEquals).length > 0) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(bodyText);
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid json";
        failures.push(`response body is not valid JSON: ${message}`);
        parsedJson = undefined;
      }
      if (parsedJson !== undefined) {
        for (const [fieldPath, expected] of Object.entries(params.check.jsonFieldEquals)) {
          const actual = getValueAtPath(parsedJson, fieldPath);
          if (actual !== expected) {
            failures.push(
              `${fieldPath} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
            );
          }
        }
      }
    }
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "api",
      command: `api ${params.check.method} ${params.check.url}`,
      status: failures.length > 0 ? "failed" : "passed",
      message: failures.length > 0 ? failures.join(" | ") : undefined,
      evidence,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "api evaluator check failed";
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "api",
      command: `api ${params.check.method} ${params.check.url}`,
      status: "failed",
      message,
      evidence: [
        {
          kind: "response",
          url: params.check.url,
          detail: message,
        },
      ],
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluateLogFileCheck(params: {
  check: Extract<VerifyPackCheck, { kind: "log-file" }>;
  workspaceDir: string;
  buildRunDir?: string | null;
}): Promise<VerifyEntry> {
  const resolved = resolveFileCheckPath({
    workspaceDir: params.workspaceDir,
    buildRunDir: params.buildRunDir,
    root: params.check.root,
    filePath: params.check.path,
  });
  if (!resolved.path) {
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "log-file",
      command: `log-file ${params.check.path}`,
      status: "failed",
      message: resolved.error,
    });
  }
  try {
    const content = await fs.readFile(resolved.path, "utf-8");
    const result = evaluateTextMatch({
      text: content,
      match: params.check.match,
      mode: params.check.mode,
      errorPrefix: `Invalid ${buildRunArtifactFilename("verify-pack")}: check "${params.check.id}"`,
    });
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "log-file",
      command: `log-file ${params.check.path}`,
      status: result.passed ? "passed" : "failed",
      message: result.passed ? undefined : result.message,
      evidence: [
        {
          kind: "file",
          path: resolved.path,
          detail: "log file inspected",
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unable to read log file";
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "log-file",
      command: `log-file ${params.check.path}`,
      status: "failed",
      message,
      evidence: [
        {
          kind: "file",
          path: resolved.path,
          detail: "log file read failed",
        },
      ],
    });
  }
}

async function evaluateArtifactTextCheck(params: {
  check: Extract<VerifyPackCheck, { kind: "artifact-text" }>;
  workspaceDir: string;
  buildRunDir?: string | null;
}): Promise<VerifyEntry> {
  const resolved = resolveFileCheckPath({
    workspaceDir: params.workspaceDir,
    buildRunDir: params.buildRunDir,
    root: params.check.root,
    filePath: params.check.path,
  });
  if (!resolved.path) {
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "artifact-text",
      command: `artifact-text ${params.check.path}`,
      status: "failed",
      message: resolved.error,
    });
  }
  try {
    const content = await fs.readFile(resolved.path, "utf-8");
    const result = evaluateTextMatch({
      text: content,
      match: params.check.match,
      mode: params.check.mode,
      errorPrefix: `Invalid ${buildRunArtifactFilename("verify-pack")}: check "${params.check.id}"`,
    });
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "artifact-text",
      command: `artifact-text ${params.check.path}`,
      status: result.passed ? "passed" : "failed",
      message: result.passed ? undefined : result.message,
      evidence: [
        {
          kind: "file",
          path: resolved.path,
          detail: "artifact text inspected",
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unable to read artifact text";
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "artifact-text",
      command: `artifact-text ${params.check.path}`,
      status: "failed",
      message,
      evidence: [
        {
          kind: "file",
          path: resolved.path,
          detail: "artifact text read failed",
        },
      ],
    });
  }
}

async function evaluateArtifactJsonCheck(params: {
  check: Extract<VerifyPackCheck, { kind: "artifact-json" }>;
  workspaceDir: string;
  buildRunDir?: string | null;
}): Promise<VerifyEntry> {
  const resolved = resolveFileCheckPath({
    workspaceDir: params.workspaceDir,
    buildRunDir: params.buildRunDir,
    root: params.check.root,
    filePath: params.check.path,
  });
  if (!resolved.path) {
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "artifact-json",
      command: `artifact-json ${params.check.path}`,
      status: "failed",
      message: resolved.error,
    });
  }
  try {
    const raw = await fs.readFile(resolved.path, "utf-8");
    const parsed = JSON.parse(raw);
    const missingFields = params.check.requiredFields.filter(
      (fieldPath) => getValueAtPath(parsed, fieldPath) === undefined,
    );
    const mismatchedFields = Object.entries(params.check.fieldEquals).filter(
      ([fieldPath, expected]) => getValueAtPath(parsed, fieldPath) !== expected,
    );
    const failures: string[] = [];
    if (missingFields.length > 0) {
      failures.push(`missing fields: ${missingFields.join(", ")}`);
    }
    if (mismatchedFields.length > 0) {
      failures.push(
        `field mismatch: ${mismatchedFields
          .map(
            ([fieldPath, expected]) =>
              `${fieldPath} expected ${JSON.stringify(expected)} got ${JSON.stringify(getValueAtPath(parsed, fieldPath))}`,
          )
          .join("; ")}`,
      );
    }
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "artifact-json",
      command: `artifact-json ${params.check.path}`,
      status: failures.length > 0 ? "failed" : "passed",
      message: failures.length > 0 ? failures.join(" | ") : undefined,
      evidence: [
        {
          kind: "file",
          path: resolved.path,
          detail: "artifact json inspected",
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unable to read artifact json";
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "artifact-json",
      command: `artifact-json ${params.check.path}`,
      status: "failed",
      message,
      evidence: [
        {
          kind: "file",
          path: resolved.path,
          detail: "artifact json read failed",
        },
      ],
    });
  }
}

async function evaluateReportCheck(params: {
  check: Extract<VerifyPackCheck, { kind: "report" }>;
  workspaceDir: string;
  buildRunId?: string | null;
  buildRunDir?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<SessionVerifyReport["entries"][number]> {
  let artifactValue: unknown;
  try {
    artifactValue = await loadArtifactFromBuildRun({
      workspaceDir: params.workspaceDir,
      buildRunId: params.buildRunId,
      buildRunDir: params.buildRunDir,
      artifactName: params.check.artifact,
      env: params.env,
    });
  } catch (error) {
    if (!isMissingFileError(error)) {
      const message = error instanceof Error ? error.message : "unable to read artifact";
      return buildVerifyPackEntry({
        checkId: params.check.id,
        kind: "report",
        command: `report ${buildRunArtifactFilename(params.check.artifact)}`,
        status: "failed",
        message,
      });
    }
    artifactValue = null;
  }
  if (artifactValue == null) {
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "report",
      command: `report ${buildRunArtifactFilename(params.check.artifact)}`,
      status: "failed",
      message: `missing ${buildRunArtifactFilename(params.check.artifact)}`,
    });
  }

  const missingFields = params.check.requiredFields.filter(
    (fieldPath) => getValueAtPath(artifactValue, fieldPath) === undefined,
  );
  const mismatchedFields = Object.entries(params.check.fieldEquals).filter(
    ([fieldPath, expected]) => getValueAtPath(artifactValue, fieldPath) !== expected,
  );

  if (missingFields.length > 0 || mismatchedFields.length > 0) {
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`missing fields: ${missingFields.join(", ")}`);
    }
    if (mismatchedFields.length > 0) {
      parts.push(
        `field mismatch: ${mismatchedFields
          .map(
            ([fieldPath, expected]) =>
              `${fieldPath} expected ${JSON.stringify(expected)} got ${JSON.stringify(getValueAtPath(artifactValue, fieldPath))}`,
          )
          .join("; ")}`,
      );
    }
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "report",
      command: `report ${buildRunArtifactFilename(params.check.artifact)}`,
      status: "failed",
      message: parts.join(" | "),
    });
  }

  return buildVerifyPackEntry({
    checkId: params.check.id,
    kind: "report",
    command: `report ${buildRunArtifactFilename(params.check.artifact)}`,
    status: "passed",
  });
}

function describeBrowserCheck(check: Extract<VerifyPackCheck, { kind: "browser" }>): string {
  const segments = [`browser navigate ${check.url}`];
  if (check.action) {
    segments.push(`action ${check.action.kind}`);
  }
  if (check.assert?.selector) {
    segments.push(`assert selector ${check.assert.selector}`);
  }
  if (check.assert?.text) {
    segments.push(`assert text ${JSON.stringify(check.assert.text)}`);
  }
  if (check.assert?.urlIncludes) {
    segments.push(`assert url includes ${JSON.stringify(check.assert.urlIncludes)}`);
  }
  if (check.screenshot) {
    segments.push("capture screenshot");
  }
  return segments.join(" | ");
}

function toBrowserActRequest(params: {
  action: Extract<VerifyPackCheck, { kind: "browser" }>["action"];
  targetId?: string;
  timeoutMs?: number;
}): BrowserActRequest | undefined {
  const { action } = params;
  if (!action) {
    return undefined;
  }
  if (action.kind === "click") {
    return {
      kind: "click",
      ref: action.ref,
      selector: action.selector,
      doubleClick: action.doubleClick,
      targetId: params.targetId,
      timeoutMs: params.timeoutMs,
    };
  }
  if (action.kind === "type") {
    return {
      kind: "type",
      ref: action.ref,
      selector: action.selector,
      text: action.text,
      submit: action.submit,
      targetId: params.targetId,
      timeoutMs: params.timeoutMs,
    };
  }
  if (action.kind === "fill") {
    return {
      kind: "fill",
      fields: action.fields,
      targetId: params.targetId,
      timeoutMs: params.timeoutMs,
    };
  }
  return {
    kind: "press",
    key: action.key,
    targetId: params.targetId,
    delayMs: undefined,
  };
}

function buildBrowserBlockedEntry(params: {
  check: Extract<VerifyPackCheck, { kind: "browser" }>;
  message: string;
}): VerifyEntry {
  return buildVerifyPackEntry({
    checkId: params.check.id,
    kind: "browser",
    command: describeBrowserCheck(params.check),
    status: "failed",
    message: params.message,
  });
}

async function evaluateBrowserCheck(params: {
  check: Extract<VerifyPackCheck, { kind: "browser" }>;
  browser?: VerifyPackExecutionParams["browser"];
}): Promise<VerifyEntry> {
  if (params.browser?.available === false) {
    return buildBrowserBlockedEntry({
      check: params.check,
      message:
        "browser evaluator check blocked because the browser tool is unavailable in the current run policy",
    });
  }

  const baseUrl = trimToUndefined(params.browser?.baseUrl);
  if (!baseUrl && params.browser?.hostControlAllowed === false) {
    return buildBrowserBlockedEntry({
      check: params.check,
      message:
        "browser evaluator check blocked because host browser control is disabled and no sandbox browser bridge is available",
    });
  }

  const profile = trimToUndefined(params.check.profile);
  const timeoutMs = params.check.timeoutMs;
  const evidence: VerifyEvidence[] = [];
  let targetId = trimToUndefined(params.check.targetId);
  let currentUrl = params.check.url;

  try {
    const navigateResult = await verifyPackDeps.browserNavigate(baseUrl, {
      url: params.check.url,
      targetId,
      profile,
    });
    targetId = trimToUndefined(navigateResult.targetId) ?? targetId;
    currentUrl = trimToUndefined(navigateResult.url) ?? currentUrl;

    const actionRequest = toBrowserActRequest({
      action: params.check.action,
      targetId,
      timeoutMs,
    });
    if (actionRequest) {
      const actionResult = await verifyPackDeps.browserAct(baseUrl, actionRequest, {
        profile,
      });
      targetId = trimToUndefined(actionResult.targetId) ?? targetId;
      currentUrl = trimToUndefined(actionResult.url) ?? currentUrl;
    }

    if (params.check.assert?.selector) {
      const waitSelectorResult = await verifyPackDeps.browserAct(
        baseUrl,
        {
          kind: "wait",
          selector: params.check.assert.selector,
          targetId,
          timeoutMs,
        },
        { profile },
      );
      targetId = trimToUndefined(waitSelectorResult.targetId) ?? targetId;
      currentUrl = trimToUndefined(waitSelectorResult.url) ?? currentUrl;
    }

    const needsSnapshot = Boolean(
      params.check.assert?.text || params.check.assert?.urlIncludes || params.check.snapshot,
    );
    const snapshot = needsSnapshot
      ? await verifyPackDeps.browserSnapshot(baseUrl, {
          format: params.check.snapshot?.format ?? "ai",
          targetId,
          selector: params.check.snapshot?.selector,
          maxChars: params.check.snapshot?.maxChars,
          profile,
        })
      : null;

    if (snapshot) {
      targetId = trimToUndefined(snapshot.targetId) ?? targetId;
      currentUrl = trimToUndefined(snapshot.url) ?? currentUrl;
      evidence.push({
        kind: "snapshot",
        url: currentUrl,
        ...(snapshot.format === "ai" && trimToUndefined(snapshot.imagePath)
          ? { path: trimToUndefined(snapshot.imagePath) }
          : {}),
        detail: snapshot.format === "ai" ? "ai snapshot captured" : "aria snapshot captured",
      });
    }

    if (params.check.assert?.text) {
      if (!snapshot || snapshot.format !== "ai") {
        return buildVerifyPackEntry({
          checkId: params.check.id,
          kind: "browser",
          command: describeBrowserCheck(params.check),
          status: "failed",
          message: "browser text assertions require an ai snapshot result",
          evidence,
        });
      }
      if (!snapshot.snapshot.includes(params.check.assert.text)) {
        return buildVerifyPackEntry({
          checkId: params.check.id,
          kind: "browser",
          command: describeBrowserCheck(params.check),
          status: "failed",
          message: `expected page snapshot to include ${JSON.stringify(params.check.assert.text)}`,
          evidence,
        });
      }
    }

    if (
      params.check.assert?.urlIncludes &&
      !currentUrl.toLowerCase().includes(params.check.assert.urlIncludes.toLowerCase())
    ) {
      return buildVerifyPackEntry({
        checkId: params.check.id,
        kind: "browser",
        command: describeBrowserCheck(params.check),
        status: "failed",
        message: `expected url to include ${JSON.stringify(params.check.assert.urlIncludes)}, got ${JSON.stringify(currentUrl)}`,
        evidence,
      });
    }

    if (params.check.screenshot) {
      const screenshot = await verifyPackDeps.browserScreenshotAction(baseUrl, {
        targetId,
        fullPage: params.check.screenshot.fullPage,
        type: params.check.screenshot.type,
        profile,
      });
      targetId = trimToUndefined(screenshot.targetId) ?? targetId;
      currentUrl = trimToUndefined(screenshot.url) ?? currentUrl;
      evidence.push({
        kind: "screenshot",
        path: screenshot.path,
        url: currentUrl,
        detail: "browser evaluator screenshot",
      });
    }

    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "browser",
      command: describeBrowserCheck(params.check),
      status: "passed",
      message: `verified ${JSON.stringify(currentUrl)}`,
      evidence,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "browser evaluator check failed";
    return buildVerifyPackEntry({
      checkId: params.check.id,
      kind: "browser",
      command: describeBrowserCheck(params.check),
      status: "failed",
      message,
      evidence,
    });
  }
}

export async function executeVerifyPack(
  params: VerifyPackExecutionParams,
): Promise<SessionVerifyReport["entries"]> {
  let verifyPack: VerifyPackArtifact | null;
  try {
    verifyPack = await loadArtifactFromBuildRun({
      workspaceDir: params.workspaceDir,
      buildRunId: params.buildRunId,
      buildRunDir: params.buildRunDir,
      artifactName: "verify-pack",
      env: params.env,
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    const message = error instanceof Error ? error.message : "unable to load verify-pack.json";
    return [
      buildVerifyPackEntry({
        checkId: "verify-pack-load",
        kind: "report",
        command: `load ${buildRunArtifactFilename("verify-pack")}`,
        status: "failed",
        message,
      }),
    ];
  }

  if (!verifyPack) {
    return [];
  }

  const entries: SessionVerifyReport["entries"] = [];
  try {
    for (const check of verifyPack.checks) {
      if (check.kind === "exec") {
        entries.push(
          evaluateExecCheck({
            check,
            observations: params.observations,
          }),
        );
        continue;
      }
      if (check.kind === "logs") {
        entries.push(
          evaluateLogsCheck({
            check,
            observations: params.observations,
          }),
        );
        continue;
      }
      if (check.kind === "browser") {
        entries.push(
          await evaluateBrowserCheck({
            check,
            browser: params.browser,
          }),
        );
        continue;
      }
      if (check.kind === "api") {
        entries.push(await evaluateApiCheck({ check }));
        continue;
      }
      if (check.kind === "log-file") {
        entries.push(
          await evaluateLogFileCheck({
            check,
            workspaceDir: params.workspaceDir,
            buildRunDir: params.buildRunDir,
          }),
        );
        continue;
      }
      if (check.kind === "artifact-text") {
        entries.push(
          await evaluateArtifactTextCheck({
            check,
            workspaceDir: params.workspaceDir,
            buildRunDir: params.buildRunDir,
          }),
        );
        continue;
      }
      if (check.kind === "artifact-json") {
        entries.push(
          await evaluateArtifactJsonCheck({
            check,
            workspaceDir: params.workspaceDir,
            buildRunDir: params.buildRunDir,
          }),
        );
        continue;
      }
      entries.push(
        await evaluateReportCheck({
          check,
          workspaceDir: params.workspaceDir,
          buildRunId: params.buildRunId,
          buildRunDir: params.buildRunDir,
          env: params.env,
        }),
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Invalid ${buildRunArtifactFilename("verify-pack")}`;
    return [
      buildVerifyPackEntry({
        checkId: "verify-pack-load",
        kind: "report",
        command: `load ${buildRunArtifactFilename("verify-pack")}`,
        status: "failed",
        message,
      }),
    ];
  }
  return entries;
}

export function describeVerifyPackTarget(params: {
  buildRunId?: string | null;
  buildRunDir?: string | null;
}): string | undefined {
  if (typeof params.buildRunDir === "string" && params.buildRunDir.trim()) {
    return path.join(params.buildRunDir.trim(), buildRunArtifactFilename("verify-pack"));
  }
  if (typeof params.buildRunId === "string" && params.buildRunId.trim()) {
    return `build run ${params.buildRunId.trim()} / ${buildRunArtifactFilename("verify-pack")}`;
  }
  return undefined;
}
