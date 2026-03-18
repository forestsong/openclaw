#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  listFastChannelExtensions,
  resolveFastChannelTestFiles,
} from "./extension-fast-channel-smoke.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  let extension = "";
  let multipassDir = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--extension") {
      extension = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--multipass-dir") {
      multipassDir = argv[index + 1] ?? "";
      index += 1;
    }
  }
  return { extension, multipassDir };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function usage(message) {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.stderr.write(
    "Usage: node scripts/e2e/run-multipass-extension-fast.mjs --extension <discord|imessage|line|signal|slack|telegram> --multipass-dir <path>\n",
  );
  process.exit(1);
}

function buildManifest(params) {
  const { extension, stateDir } = params;
  const fixtureId = `${extension}-openclaw-fast-roundtrip`;
  const bridgeScript = path.join(repoRoot, "scripts", "e2e", "multipass-openclaw-bridge.mjs");
  const providerId = `${extension}-openclaw-fast`;

  const bridgeBase = `node ${shellQuote(bridgeScript)}`;
  const commands = {
    probe: `${bridgeBase} probe ${shellQuote(extension)} ${shellQuote(stateDir)}`,
    send: `${bridgeBase} send ${shellQuote(extension)} ${shellQuote(stateDir)}`,
    waitForInbound: `${bridgeBase} wait ${shellQuote(extension)} ${shellQuote(stateDir)}`,
  };

  return {
    fixtureId,
    manifest: {
      configVersion: 1,
      userName: "openclaw-ci",
      providers: {
        [providerId]: {
          adapter: "script",
          platform: extension,
          capabilities: ["probe", "send", "roundtrip", "agent"],
          env: [],
          script: {
            commands,
            cwd: repoRoot,
          },
          status: "active",
        },
      },
      fixtures: [
        {
          id: fixtureId,
          provider: providerId,
          mode: "roundtrip",
          target: {
            id: `${extension}:ci-fast-target`,
            metadata: {},
          },
          inboundMatch: {
            author: "assistant",
            strategy: "contains",
            nonce: "contains",
          },
          timeoutMs: 20_000,
          retries: 0,
          tags: ["ci", "fast", extension],
        },
      ],
    },
  };
}

function run() {
  const { extension, multipassDir } = parseArgs(process.argv.slice(2));
  if (!extension) {
    usage("Missing required --extension argument.");
  }
  if (!multipassDir) {
    usage("Missing required --multipass-dir argument.");
  }
  if (!resolveFastChannelTestFiles(extension)) {
    usage(
      `Unsupported extension "${extension}". Supported extensions: ${listFastChannelExtensions().join(", ")}`,
    );
  }

  const scratchDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-multipass-fast-"));
  const stateDir = path.join(scratchDir, "state");
  mkdirSync(stateDir, { recursive: true });
  const manifestPath = path.join(scratchDir, "multipass-fast.manifest.json");
  const { fixtureId, manifest } = buildManifest({ extension, stateDir });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const cmd = [
    "--dir",
    path.resolve(multipassDir),
    "dev",
    "roundtrip",
    fixtureId,
    "--config",
    manifestPath,
    "--json",
  ];

  const child = spawnSync("pnpm", cmd, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (typeof child.status === "number") {
    process.exit(child.status);
  }
  process.exit(1);
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryHref) {
  run();
}
