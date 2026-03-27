import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveStateDir } from "../config/paths.js";
import { findGitRoot } from "../infra/git-root.js";
import { resolveUserPath } from "../utils.js";

export const BUILD_RUN_ARTIFACT_NAMES = [
  "acceptance",
  "verify-pack",
  "build-report",
  "eval-report",
] as const;

export type BuildRunArtifactName = (typeof BUILD_RUN_ARTIFACT_NAMES)[number];
export const BUILD_RUN_ROUND_ARTIFACT_NAMES = ["build-report", "eval-report"] as const;
export type BuildRunRoundArtifactName = (typeof BUILD_RUN_ROUND_ARTIFACT_NAMES)[number];

export const BUILD_RUNS_STATE_DIRNAME = "build-runs";
export const BUILD_RUNS_WORKSPACE_DIRNAME = ".openclaw";
export const BUILD_RUNS_ROUNDS_DIRNAME = "rounds";

const BUILD_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BUILD_RUN_ROUND_FILENAME_PATTERN = /^round-(\d+)\.(build-report|eval-report)\.json$/;

const AcceptanceArtifactSchema = z
  .object({
    goal: z.string().min(1),
    in_scope: z.array(z.string()).default([]),
    out_of_scope: z.array(z.string()).default([]),
    blocking_checks: z
      .array(
        z.object({
          id: z.string().min(1),
          description: z.string().min(1),
          kind: z.enum(["functional", "quality", "design", "ops"]),
        }),
      )
      .default([]),
    quality_bars: z.record(z.string(), z.enum(["required", "important", "optional"])).default({}),
  })
  .strict();

const VerifyPackExecCheckSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("exec"),
    blocking: z.boolean().optional(),
    command: z.string().min(1),
    expectExitCode: z.number().int().default(0),
  })
  .strict();

const VerifyPackLogsCheckSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("logs"),
    blocking: z.boolean().optional(),
    command: z.string().min(1).optional(),
    match: z.string().min(1),
    mode: z.enum(["includes", "regex"]).default("includes"),
  })
  .strict();

const VerifyPackArtifactNameSchema = z.enum(BUILD_RUN_ARTIFACT_NAMES);

const VerifyPackReportCheckSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("report"),
    blocking: z.boolean().optional(),
    artifact: VerifyPackArtifactNameSchema,
    requiredFields: z.array(z.string().min(1)).default([]),
    fieldEquals: z
      .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .default({}),
  })
  .strict();

const VerifyPackBrowserClickActionSchema = z
  .object({
    kind: z.literal("click"),
    ref: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    doubleClick: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.ref && !value.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "click action requires ref or selector",
        path: ["ref"],
      });
    }
  });

const VerifyPackBrowserTypeActionSchema = z
  .object({
    kind: z.literal("type"),
    ref: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    text: z.string().min(1),
    submit: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.ref && !value.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "type action requires ref or selector",
        path: ["ref"],
      });
    }
  });

const VerifyPackBrowserFillFieldSchema = z
  .object({
    ref: z.string().min(1),
    type: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .strict();

const VerifyPackBrowserFillActionSchema = z
  .object({
    kind: z.literal("fill"),
    fields: z.array(VerifyPackBrowserFillFieldSchema).min(1),
  })
  .strict();

const VerifyPackBrowserPressActionSchema = z
  .object({
    kind: z.literal("press"),
    key: z.string().min(1),
  })
  .strict();

const VerifyPackBrowserActionSchema = z.discriminatedUnion("kind", [
  VerifyPackBrowserClickActionSchema,
  VerifyPackBrowserTypeActionSchema,
  VerifyPackBrowserFillActionSchema,
  VerifyPackBrowserPressActionSchema,
]);

const VerifyPackBrowserAssertSchema = z
  .object({
    text: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    urlIncludes: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.text && !value.selector && !value.urlIncludes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "browser assert requires text, selector, or urlIncludes",
        path: ["text"],
      });
    }
  });

const VerifyPackBrowserSnapshotSchema = z
  .object({
    format: z.enum(["ai", "aria"]).default("ai"),
    selector: z.string().min(1).optional(),
    maxChars: z.number().int().positive().optional(),
  })
  .strict();

const VerifyPackBrowserScreenshotSchema = z
  .object({
    fullPage: z.boolean().optional(),
    type: z.enum(["png", "jpeg"]).optional(),
  })
  .strict();

const VerifyPackBrowserCheckSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("browser"),
    blocking: z.boolean().optional(),
    url: z.string().min(1),
    profile: z.string().min(1).optional(),
    targetId: z.string().min(1).optional(),
    action: VerifyPackBrowserActionSchema.optional(),
    assert: VerifyPackBrowserAssertSchema.optional(),
    snapshot: VerifyPackBrowserSnapshotSchema.optional(),
    screenshot: VerifyPackBrowserScreenshotSchema.optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
  })
  .strict();

const VerifyPackApiCheckSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("api"),
    blocking: z.boolean().optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).default("GET"),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().min(1).optional(),
    json: z.unknown().optional(),
    expectStatus: z.number().int().min(100).max(599).default(200),
    bodyIncludes: z.array(z.string().min(1)).default([]),
    jsonFieldEquals: z
      .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .default({}),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.body && value.json !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "api check cannot set both body and json",
        path: ["body"],
      });
    }
  });

const VerifyPackFileRootSchema = z.enum(["workspace", "build-run"]);

const VerifyPackLogFileCheckSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("log-file"),
    blocking: z.boolean().optional(),
    path: z.string().min(1),
    root: VerifyPackFileRootSchema.default("workspace"),
    match: z.string().min(1),
    mode: z.enum(["includes", "regex"]).default("includes"),
  })
  .strict();

const VerifyPackArtifactTextCheckSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("artifact-text"),
    blocking: z.boolean().optional(),
    path: z.string().min(1),
    root: VerifyPackFileRootSchema.default("build-run"),
    match: z.string().min(1),
    mode: z.enum(["includes", "regex"]).default("includes"),
  })
  .strict();

const VerifyPackArtifactJsonCheckSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("artifact-json"),
    blocking: z.boolean().optional(),
    path: z.string().min(1),
    root: VerifyPackFileRootSchema.default("build-run"),
    requiredFields: z.array(z.string().min(1)).default([]),
    fieldEquals: z
      .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .default({}),
  })
  .strict();

const VerifyPackCheckSchema = z.discriminatedUnion("kind", [
  VerifyPackExecCheckSchema,
  VerifyPackLogsCheckSchema,
  VerifyPackReportCheckSchema,
  VerifyPackBrowserCheckSchema,
  VerifyPackApiCheckSchema,
  VerifyPackLogFileCheckSchema,
  VerifyPackArtifactTextCheckSchema,
  VerifyPackArtifactJsonCheckSchema,
]);

const VerifyPackArtifactSchema = z
  .object({
    checks: z.array(VerifyPackCheckSchema).default([]),
  })
  .strict();

const BuildRoundMetadataSchema = z
  .object({
    round: z.number().int().positive().default(1),
    generated_at: z.number().int().nonnegative().default(0),
    session_key: z.string().min(1).optional(),
    parent_round: z.number().int().positive().optional(),
  })
  .strict();

const BuildRunBlockingFindingKindSchema = z.enum([
  "browser",
  "api",
  "logs",
  "log-file",
  "artifact-text",
  "artifact-json",
  "report",
  "test",
  "build",
  "lint",
  "check",
  "command",
  "other",
]);

const BuildRunBlockingFindingSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
const BuildRunBlockingFindingCategorySchema = z.enum([
  "verification",
  "quality",
  "design",
  "ops",
  "runtime",
]);
const BuildRunRecommendedNextRoleSchema = z.enum(["planner", "builder", "evaluator"]);

function slugifyFindingId(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "finding";
}

const EvalReportBlockingFindingSchema = z
  .union([
    z.string().min(1),
    z
      .object({
        id: z.string().min(1).optional(),
        kind: BuildRunBlockingFindingKindSchema.default("other"),
        summary: z.string().min(1),
        severity: BuildRunBlockingFindingSeveritySchema.default("high"),
        category: BuildRunBlockingFindingCategorySchema.default("verification"),
        evidence_refs: z.array(z.string().min(1)).default([]),
      })
      .strict(),
  ])
  .transform((value) => {
    if (typeof value === "string") {
      return {
        id: slugifyFindingId(value),
        kind: "other" as const,
        summary: value,
        severity: "high" as const,
        category: "verification" as const,
        evidence_refs: [],
      };
    }
    return {
      id: value.id ?? slugifyFindingId(value.summary),
      kind: value.kind,
      summary: value.summary,
      severity: value.severity,
      category: value.category,
      evidence_refs: value.evidence_refs,
    };
  });

const BuildReportArtifactSchema = z
  .object({
    role: z.enum(["planner", "builder"]).default("builder"),
    summary: z.string().min(1),
    commands_run: z.array(z.string()).default([]),
    files_changed: z.array(z.string()).default([]),
    known_gaps: z.array(z.string()).default([]),
  })
  .merge(BuildRoundMetadataSchema)
  .strict();

const EvalReportArtifactSchema = z
  .object({
    role: z.literal("evaluator").default("evaluator"),
    status: z.enum(["passed", "failed", "incomplete"]),
    summary: z.string().min(1),
    checks_run: z.number().int().nonnegative().default(0),
    checks_passed: z.number().int().nonnegative().default(0),
    checks_failed: z.number().int().nonnegative().default(0),
    blocking_findings: z.array(EvalReportBlockingFindingSchema).default([]),
    retry_advice: z.array(z.string()).default([]),
    recommended_next_role: BuildRunRecommendedNextRoleSchema.optional(),
  })
  .merge(BuildRoundMetadataSchema)
  .strict();

const BUILD_RUN_ARTIFACT_SCHEMAS = {
  acceptance: AcceptanceArtifactSchema,
  "verify-pack": VerifyPackArtifactSchema,
  "build-report": BuildReportArtifactSchema,
  "eval-report": EvalReportArtifactSchema,
} as const;

export type AcceptanceArtifact = z.infer<typeof AcceptanceArtifactSchema>;
export type VerifyPackArtifact = z.infer<typeof VerifyPackArtifactSchema>;
export type VerifyPackCheck = VerifyPackArtifact["checks"][number];
export type BuildReportArtifact = z.infer<typeof BuildReportArtifactSchema>;
export type EvalReportArtifact = z.infer<typeof EvalReportArtifactSchema>;
export type EvalReportBlockingFinding = EvalReportArtifact["blocking_findings"][number];
export type BuildRunRoundSummary =
  | {
      artifactName: "build-report";
      path: string;
      round: number;
      role: BuildReportArtifact["role"];
      generatedAt: number;
      sessionKey?: string;
      parentRound?: number;
      summary: string;
      commandsRunCount: number;
      filesChangedCount: number;
      knownGapCount: number;
    }
  | {
      artifactName: "eval-report";
      path: string;
      round: number;
      role: EvalReportArtifact["role"];
      generatedAt: number;
      sessionKey?: string;
      parentRound?: number;
      status: EvalReportArtifact["status"];
      summary: string;
      checksRun: number;
      checksPassed: number;
      checksFailed: number;
      topBlockingFindingId?: string;
      topBlockingFindingSummary?: string;
      blockingFindingCount: number;
      retryAdviceCount: number;
      recommendedNextRole?: EvalReportArtifact["recommended_next_role"];
    };
export type BuildRunRoundState = {
  runDir: string;
  latestRound: number | null;
  buildReports: Array<Extract<BuildRunRoundSummary, { artifactName: "build-report" }>>;
  evalReports: Array<Extract<BuildRunRoundSummary, { artifactName: "eval-report" }>>;
  latestBuildReport?: Extract<BuildRunRoundSummary, { artifactName: "build-report" }>;
  latestEvalReport?: Extract<BuildRunRoundSummary, { artifactName: "eval-report" }>;
};

export type BuildRunArtifactMap = {
  acceptance: AcceptanceArtifact;
  "verify-pack": VerifyPackArtifact;
  "build-report": BuildReportArtifact;
  "eval-report": EvalReportArtifact;
};

export type ResolvedBuildRunRoot = {
  workspaceDir: string;
  runId: string;
  storage: "repo-local" | "state-dir";
  repoRoot?: string;
  workspaceSlug?: string;
  buildRunsRoot: string;
  runDir: string;
};

function isMissingFileError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isBuildRunRoundArtifactName(
  name: BuildRunArtifactName,
): name is BuildRunRoundArtifactName {
  return (BUILD_RUN_ROUND_ARTIFACT_NAMES as readonly string[]).includes(name);
}

function summarizeRoundArtifact(
  artifactName: "build-report",
  artifact: BuildReportArtifact,
  artifactPath: string,
): Extract<BuildRunRoundSummary, { artifactName: "build-report" }>;
function summarizeRoundArtifact(
  artifactName: "eval-report",
  artifact: EvalReportArtifact,
  artifactPath: string,
): Extract<BuildRunRoundSummary, { artifactName: "eval-report" }>;
function summarizeRoundArtifact(
  artifactName: BuildRunRoundArtifactName,
  artifact: BuildReportArtifact | EvalReportArtifact,
  artifactPath: string,
): BuildRunRoundSummary {
  if (artifactName === "build-report") {
    const buildArtifact = artifact as BuildReportArtifact;
    return {
      artifactName,
      path: artifactPath,
      round: buildArtifact.round,
      role: buildArtifact.role,
      generatedAt: buildArtifact.generated_at,
      ...(buildArtifact.session_key ? { sessionKey: buildArtifact.session_key } : {}),
      ...(buildArtifact.parent_round ? { parentRound: buildArtifact.parent_round } : {}),
      summary: buildArtifact.summary,
      commandsRunCount: buildArtifact.commands_run.length,
      filesChangedCount: buildArtifact.files_changed.length,
      knownGapCount: buildArtifact.known_gaps.length,
    };
  }
  const evalArtifact = artifact as EvalReportArtifact;
  return {
    artifactName,
    path: artifactPath,
    round: evalArtifact.round,
    role: evalArtifact.role,
    generatedAt: evalArtifact.generated_at,
    ...(evalArtifact.session_key ? { sessionKey: evalArtifact.session_key } : {}),
    ...(evalArtifact.parent_round ? { parentRound: evalArtifact.parent_round } : {}),
    status: evalArtifact.status,
    summary: evalArtifact.summary,
    checksRun: evalArtifact.checks_run,
    checksPassed: evalArtifact.checks_passed,
    checksFailed: evalArtifact.checks_failed,
    ...(evalArtifact.blocking_findings[0]
      ? {
          topBlockingFindingId: evalArtifact.blocking_findings[0].id,
          topBlockingFindingSummary: evalArtifact.blocking_findings[0].summary,
        }
      : {}),
    blockingFindingCount: evalArtifact.blocking_findings.length,
    retryAdviceCount: evalArtifact.retry_advice.length,
    ...(evalArtifact.recommended_next_role
      ? { recommendedNextRole: evalArtifact.recommended_next_role }
      : {}),
  };
}

function pickLatestRoundSummary<TSummary extends BuildRunRoundSummary>(
  entries: TSummary[],
): TSummary | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  return entries.toSorted((left, right) => {
    if (left.round !== right.round) {
      return right.round - left.round;
    }
    if (left.generatedAt !== right.generatedAt) {
      return right.generatedAt - left.generatedAt;
    }
    const leftIsCanonical =
      path.basename(left.path) === buildRunArtifactFilename(left.artifactName);
    const rightIsCanonical =
      path.basename(right.path) === buildRunArtifactFilename(right.artifactName);
    if (leftIsCanonical !== rightIsCanonical) {
      return leftIsCanonical ? -1 : 1;
    }
    return right.path.localeCompare(left.path);
  })[0];
}

async function readBuildRunArtifactAtPath<TName extends BuildRunArtifactName>(
  artifactName: TName,
  artifactPath: string,
): Promise<BuildRunArtifactMap[TName]> {
  let raw: string;
  try {
    raw = await fs.readFile(artifactPath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unable to read file";
    throw new Error(`Unable to read ${buildRunArtifactFilename(artifactName)}: ${message}`, {
      cause: error,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid json";
    throw new Error(`Invalid ${buildRunArtifactFilename(artifactName)} JSON: ${message}`, {
      cause: error,
    });
  }
  return validateBuildRunArtifact(artifactName, parsed);
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

export function normalizeBuildRunId(runId: string): string {
  const trimmed = runId.trim();
  if (!BUILD_RUN_ID_PATTERN.test(trimmed)) {
    throw new Error(`Invalid build-run id "${runId}". Use [A-Za-z0-9][A-Za-z0-9._-]{0,127}.`);
  }
  return trimmed;
}

export function buildRunArtifactFilename(name: BuildRunArtifactName): string {
  return `${name}.json`;
}

export function buildRunRoundArtifactFilename(params: {
  artifactName: BuildRunRoundArtifactName;
  round: number;
}): string {
  const round = params.round;
  if (!Number.isInteger(round) || round <= 0) {
    throw new Error(`Invalid build-run round "${params.round}". Use an integer >= 1.`);
  }
  return `round-${String(round).padStart(4, "0")}.${params.artifactName}.json`;
}

export function slugifyBuildRunWorkspace(workspaceDir: string): string {
  const resolved = path.resolve(resolveUserPath(workspaceDir));
  const base = path
    .basename(resolved)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = base || "workspace";
  const digest = crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  return `${name}-${digest}`;
}

export function resolveBuildRunRoot(params: {
  workspaceDir: string;
  runId: string;
  env?: NodeJS.ProcessEnv;
}): ResolvedBuildRunRoot {
  const workspaceDir = path.resolve(resolveUserPath(params.workspaceDir));
  const runId = normalizeBuildRunId(params.runId);
  const repoRoot = findGitRoot(workspaceDir);
  if (repoRoot) {
    const buildRunsRoot = path.join(
      repoRoot,
      BUILD_RUNS_WORKSPACE_DIRNAME,
      BUILD_RUNS_STATE_DIRNAME,
    );
    return {
      workspaceDir,
      runId,
      storage: "repo-local",
      repoRoot,
      buildRunsRoot,
      runDir: path.join(buildRunsRoot, runId),
    };
  }
  const workspaceSlug = slugifyBuildRunWorkspace(workspaceDir);
  const buildRunsRoot = path.join(
    resolveStateDir(params.env),
    BUILD_RUNS_STATE_DIRNAME,
    workspaceSlug,
  );
  return {
    workspaceDir,
    runId,
    storage: "state-dir",
    workspaceSlug,
    buildRunsRoot,
    runDir: path.join(buildRunsRoot, runId),
  };
}

export function resolveBuildRunArtifactPath(params: {
  workspaceDir: string;
  runId: string;
  artifactName: BuildRunArtifactName;
  env?: NodeJS.ProcessEnv;
}): string {
  const root = resolveBuildRunRoot(params);
  return path.join(root.runDir, buildRunArtifactFilename(params.artifactName));
}

export function resolveBuildRunArtifactPathFromRunDir(params: {
  runDir: string;
  artifactName: BuildRunArtifactName;
}): string {
  return path.join(
    path.resolve(resolveUserPath(params.runDir)),
    buildRunArtifactFilename(params.artifactName),
  );
}

export function resolveBuildRunRoundsDirFromRunDir(runDir: string): string {
  return path.join(path.resolve(resolveUserPath(runDir)), BUILD_RUNS_ROUNDS_DIRNAME);
}

export function resolveBuildRunRoundArtifactPathFromRunDir(params: {
  runDir: string;
  artifactName: BuildRunRoundArtifactName;
  round: number;
}): string {
  return path.join(
    resolveBuildRunRoundsDirFromRunDir(params.runDir),
    buildRunRoundArtifactFilename({
      artifactName: params.artifactName,
      round: params.round,
    }),
  );
}

export async function ensureBuildRunRoot(params: {
  workspaceDir: string;
  runId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ResolvedBuildRunRoot> {
  const root = resolveBuildRunRoot(params);
  await fs.mkdir(root.runDir, { recursive: true });
  return root;
}

export function validateBuildRunArtifact<TName extends BuildRunArtifactName>(
  artifactName: TName,
  value: unknown,
): BuildRunArtifactMap[TName] {
  const schema = BUILD_RUN_ARTIFACT_SCHEMAS[artifactName];
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid ${buildRunArtifactFilename(artifactName)}: ${formatZodIssues(parsed.error)}`,
    );
  }
  return parsed.data as BuildRunArtifactMap[TName];
}

export async function writeBuildRunArtifact<TName extends BuildRunArtifactName>(params: {
  workspaceDir: string;
  runId: string;
  artifactName: TName;
  value: unknown;
  env?: NodeJS.ProcessEnv;
}): Promise<{ path: string; value: BuildRunArtifactMap[TName] }> {
  const root = await ensureBuildRunRoot(params);
  const value = validateBuildRunArtifact(params.artifactName, params.value);
  const artifactPath = path.join(root.runDir, buildRunArtifactFilename(params.artifactName));
  await fs.writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  if (isBuildRunRoundArtifactName(params.artifactName)) {
    const roundAwareValue = value as BuildReportArtifact | EvalReportArtifact;
    const roundsDir = resolveBuildRunRoundsDirFromRunDir(root.runDir);
    await fs.mkdir(roundsDir, { recursive: true });
    const roundArtifactPath = resolveBuildRunRoundArtifactPathFromRunDir({
      runDir: root.runDir,
      artifactName: params.artifactName,
      round: roundAwareValue.round,
    });
    await fs.writeFile(roundArtifactPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  }
  return { path: artifactPath, value };
}

export async function readBuildRunArtifact<TName extends BuildRunArtifactName>(params: {
  workspaceDir: string;
  runId: string;
  artifactName: TName;
  env?: NodeJS.ProcessEnv;
}): Promise<BuildRunArtifactMap[TName]> {
  const artifactPath = resolveBuildRunArtifactPath(params);
  return readBuildRunArtifactAtPath(params.artifactName, artifactPath);
}

export async function readBuildRunArtifactFromRunDir<TName extends BuildRunArtifactName>(params: {
  runDir: string;
  artifactName: TName;
}): Promise<BuildRunArtifactMap[TName]> {
  const artifactPath = resolveBuildRunArtifactPathFromRunDir(params);
  return readBuildRunArtifactAtPath(params.artifactName, artifactPath);
}

async function readCanonicalRoundSummary(
  runDir: string,
  artifactName: "build-report",
): Promise<Extract<BuildRunRoundSummary, { artifactName: "build-report" }> | undefined>;
async function readCanonicalRoundSummary(
  runDir: string,
  artifactName: "eval-report",
): Promise<Extract<BuildRunRoundSummary, { artifactName: "eval-report" }> | undefined>;
async function readCanonicalRoundSummary(
  runDir: string,
  artifactName: BuildRunRoundArtifactName,
): Promise<BuildRunRoundSummary | undefined> {
  const artifactPath = resolveBuildRunArtifactPathFromRunDir({ runDir, artifactName });
  try {
    if (artifactName === "build-report") {
      const artifact = await readBuildRunArtifactAtPath("build-report", artifactPath);
      return summarizeRoundArtifact("build-report", artifact, artifactPath);
    }
    const artifact = await readBuildRunArtifactAtPath("eval-report", artifactPath);
    return summarizeRoundArtifact("eval-report", artifact, artifactPath);
  } catch (error) {
    if (isMissingFileError(error instanceof Error ? error.cause : undefined)) {
      return undefined;
    }
    throw error;
  }
}

export async function readBuildRunRoundStateFromRunDir(params: {
  runDir: string;
}): Promise<BuildRunRoundState> {
  const runDir = path.resolve(resolveUserPath(params.runDir));
  const roundsDir = resolveBuildRunRoundsDirFromRunDir(runDir);
  const buildReports: Array<Extract<BuildRunRoundSummary, { artifactName: "build-report" }>> = [];
  const evalReports: Array<Extract<BuildRunRoundSummary, { artifactName: "eval-report" }>> = [];

  let roundEntries: string[] = [];
  try {
    roundEntries = await fs.readdir(roundsDir);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  for (const entryName of roundEntries) {
    const match = BUILD_RUN_ROUND_FILENAME_PATTERN.exec(entryName);
    if (!match) {
      continue;
    }
    const artifactName = match[2] as BuildRunRoundArtifactName;
    const artifactPath = path.join(roundsDir, entryName);
    if (artifactName === "build-report") {
      const artifact = await readBuildRunArtifactAtPath("build-report", artifactPath);
      const summary = summarizeRoundArtifact("build-report", artifact, artifactPath);
      buildReports.push(summary);
    } else {
      const artifact = await readBuildRunArtifactAtPath("eval-report", artifactPath);
      const summary = summarizeRoundArtifact("eval-report", artifact, artifactPath);
      evalReports.push(summary);
    }
  }

  const canonicalBuild = await readCanonicalRoundSummary(runDir, "build-report");
  if (
    canonicalBuild &&
    !buildReports.some(
      (entry) =>
        entry.round === canonicalBuild.round && entry.generatedAt === canonicalBuild.generatedAt,
    )
  ) {
    buildReports.push(canonicalBuild);
  }

  const canonicalEval = await readCanonicalRoundSummary(runDir, "eval-report");
  if (
    canonicalEval &&
    !evalReports.some(
      (entry) =>
        entry.round === canonicalEval.round && entry.generatedAt === canonicalEval.generatedAt,
    )
  ) {
    evalReports.push(canonicalEval);
  }

  const latestBuildReport = pickLatestRoundSummary(buildReports);
  const latestEvalReport = pickLatestRoundSummary(evalReports);
  const latestRound = Math.max(latestBuildReport?.round ?? 0, latestEvalReport?.round ?? 0);

  return {
    runDir,
    latestRound: latestRound > 0 ? latestRound : null,
    buildReports: buildReports.toSorted((left, right) => left.round - right.round),
    evalReports: evalReports.toSorted((left, right) => left.round - right.round),
    ...(latestBuildReport ? { latestBuildReport } : {}),
    ...(latestEvalReport ? { latestEvalReport } : {}),
  };
}

export async function readBuildRunRoundState(params: {
  workspaceDir: string;
  runId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<BuildRunRoundState> {
  const root = resolveBuildRunRoot(params);
  return readBuildRunRoundStateFromRunDir({ runDir: root.runDir });
}

export function isReservedBuildRunWorkspacePath(rootDir: string, candidatePath: string): boolean {
  const relative = path.relative(rootDir, candidatePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const parts = relative.split(path.sep).filter(Boolean);
  return parts[0] === BUILD_RUNS_WORKSPACE_DIRNAME && parts[1] === BUILD_RUNS_STATE_DIRNAME;
}
