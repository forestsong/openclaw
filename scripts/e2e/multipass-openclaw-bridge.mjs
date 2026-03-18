#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveFastChannelTestFiles } from "./extension-fast-channel-smoke.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      resolve(raw);
    });
    process.stdin.on("error", reject);
  });
}

function parseInput(raw) {
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function stateFilePath(stateDir, providerId) {
  mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, `${safeFileName(providerId)}.json`);
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function runFastSmoke(extension) {
  if (!resolveFastChannelTestFiles(extension)) {
    throw new Error(`Unsupported extension "${extension}" for multipass fast bridge.`);
  }
  const result = spawnSync(
    "node",
    ["scripts/e2e/extension-fast-channel-smoke.mjs", "--extension", extension],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      encoding: "utf8",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(
      `Fast smoke failed for extension "${extension}" (exit ${String(result.status)}).`,
    );
  }
}

function resolveThreadId(payload, fallbackId) {
  const target = payload?.outbound?.target;
  if (target && typeof target === "object") {
    const typedTarget = target;
    if (typeof typedTarget.threadId === "string" && typedTarget.threadId.trim()) {
      return typedTarget.threadId.trim();
    }
    if (typeof typedTarget.channelId === "string" && typedTarget.channelId.trim()) {
      return typedTarget.channelId.trim();
    }
    if (typeof typedTarget.id === "string" && typedTarget.id.trim()) {
      return typedTarget.id.trim();
    }
  }
  return fallbackId;
}

function renderUsage() {
  process.stderr.write(
    "Usage: node scripts/e2e/multipass-openclaw-bridge.mjs <probe|send|wait> <extension> <state-dir>\n",
  );
}

async function main() {
  const mode = process.argv[2] ?? "";
  const extension = process.argv[3] ?? "";
  const stateDir = process.argv[4] ?? "";
  if (!mode || !extension || !stateDir) {
    renderUsage();
    process.exit(1);
  }

  const rawInput = await readStdin();
  const payload = parseInput(rawInput);
  const providerId =
    (typeof payload?.provider?.id === "string" && payload.provider.id) ||
    `${extension}-multipass-fast`;
  const statePath = stateFilePath(stateDir, providerId);

  if (mode === "probe") {
    process.stdout.write(
      `${JSON.stringify(
        {
          healthy: true,
          details: [`extension=${extension}`, `repo=${repoRoot}`, `state=${statePath}`],
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (mode === "send") {
    runFastSmoke(extension);
    const threadId = resolveThreadId(payload, `${extension}:ci-fast-target`);
    const messageId = `${extension}-fast-${Date.now()}`;
    writeJson(statePath, {
      extension,
      messageId,
      providerId,
      sentAt: new Date().toISOString(),
      text: typeof payload?.outbound?.text === "string" ? payload.outbound.text : "",
      threadId,
    });
    process.stdout.write(`${JSON.stringify({ accepted: true, messageId, threadId }, null, 2)}\n`);
    return;
  }

  if (mode === "wait") {
    const currentState = readJson(statePath) ?? {};
    const waitNonce = typeof payload?.wait?.nonce === "string" ? payload.wait.nonce.trim() : "";
    const targetThreadId = resolveThreadId(payload, `${extension}:ci-fast-target`);
    process.stdout.write(
      `${JSON.stringify(
        {
          message: {
            author: "assistant",
            id: `${extension}-inbound-${Date.now()}`,
            sentAt: new Date().toISOString(),
            text: `ACK ${waitNonce || currentState.text || "nonce-missing"}`,
            threadId:
              typeof currentState.threadId === "string" && currentState.threadId.trim()
                ? currentState.threadId
                : targetThreadId,
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  throw new Error(`Unknown mode "${mode}". Expected probe, send, or wait.`);
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryHref) {
  await main();
}
