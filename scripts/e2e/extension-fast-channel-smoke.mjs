#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const CHANNEL_FAST_TEST_FILES = Object.freeze({
  discord: ["extensions/discord/src/channel.test.ts"],
  imessage: ["extensions/imessage/src/channel.outbound.test.ts"],
  line: ["src/line/webhook-node.test.ts"],
  signal: ["extensions/signal/src/channel.test.ts"],
  slack: ["extensions/slack/src/channel.test.ts"],
  telegram: ["extensions/telegram/src/channel.test.ts"],
});

export function listFastChannelExtensions() {
  return Object.keys(CHANNEL_FAST_TEST_FILES).toSorted((left, right) => left.localeCompare(right));
}

export function resolveFastChannelTestFiles(extension) {
  return CHANNEL_FAST_TEST_FILES[extension] ?? null;
}

function parseArgs(argv) {
  let extension = "";
  let probeOnly = false;
  let listOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--extension") {
      extension = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--probe") {
      probeOnly = true;
      continue;
    }
    if (arg === "--list") {
      listOnly = true;
      continue;
    }
  }
  return { extension, probeOnly, listOnly };
}

function printUsageAndExit(message) {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.stderr.write(
    "Usage: node scripts/e2e/extension-fast-channel-smoke.mjs --extension <discord|imessage|line|signal|slack|telegram> [--probe]\n",
  );
  process.stderr.write("       node scripts/e2e/extension-fast-channel-smoke.mjs --list\n");
  process.exit(1);
}

function assertFilesExist(files) {
  for (const relativeFile of files) {
    const absoluteFile = path.resolve(repoRoot, relativeFile);
    if (!existsSync(absoluteFile)) {
      throw new Error(`Missing fast smoke file: ${relativeFile}`);
    }
  }
}

export function runFastChannelSmoke(extension) {
  const files = resolveFastChannelTestFiles(extension);
  if (!files) {
    throw new Error(
      `Unsupported fast extension "${extension}". Expected one of: ${listFastChannelExtensions().join(", ")}`,
    );
  }
  assertFilesExist(files);

  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", "--config", "vitest.channels.config.ts", ...files],
    {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    },
  );
  if (typeof result.status === "number") {
    return result.status;
  }
  return 1;
}

function main() {
  const { extension, probeOnly, listOnly } = parseArgs(process.argv.slice(2));

  if (listOnly) {
    process.stdout.write(`${listFastChannelExtensions().join("\n")}\n`);
    return;
  }

  if (!extension) {
    printUsageAndExit("Missing required --extension argument.");
  }

  const files = resolveFastChannelTestFiles(extension);
  if (!files) {
    printUsageAndExit(
      `Unsupported extension "${extension}". Expected one of: ${listFastChannelExtensions().join(", ")}`,
    );
  }

  assertFilesExist(files);

  if (probeOnly) {
    process.stdout.write(`${JSON.stringify({ extension, files, ok: true }, null, 2)}\n`);
    return;
  }

  process.exit(runFastChannelSmoke(extension));
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";

if (import.meta.url === entryHref) {
  main();
}
