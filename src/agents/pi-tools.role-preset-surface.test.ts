import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawCodingTools } from "./pi-tools.js";

function writeSessionStoreSeed(
  storePath: string,
  sessions: Record<string, Record<string, unknown>>,
) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(sessions, null, 2));
}

function createRolePresetConfig(storePath: string): OpenClawConfig {
  return {
    session: { store: storePath },
    agents: {
      defaults: {
        subagents: { maxSpawnDepth: 2 },
      },
    },
  } as OpenClawConfig;
}

describe("createOpenClawCodingTools role preset surfaces", () => {
  it("preserves planner write/browser tools even when the prompt looks lightweight", () => {
    const storePath = path.join(
      os.tmpdir(),
      `openclaw-role-preset-surface-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    writeSessionStoreSeed(storePath, {
      "agent:main:subagent:planner": {
        sessionId: "planner-session",
        updatedAt: Date.now(),
        spawnDepth: 1,
        subagentRole: "orchestrator",
        subagentControlScope: "children",
        subagentRolePreset: "planner",
      },
    });

    const tools = createOpenClawCodingTools({
      config: createRolePresetConfig(storePath),
      sessionKey: "agent:main:subagent:planner",
      workspaceDir: os.tmpdir(),
      taskPrompt: "Reply with exactly OK.",
      modelProvider: "omlx",
      modelId: "Qwen3.5-122B-A10B-4bit",
      senderIsOwner: true,
    });

    const names = tools.map((tool) => tool.name);
    expect(names).toContain("read");
    expect(names).toContain("edit");
    expect(names).toContain("write");
    expect(names).toContain("browser");
    expect(names).not.toContain("exec");
  });
});
