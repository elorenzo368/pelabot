#!/usr/bin/env node
/**
 * Materializes the pinned supply-chain triple on a clean host (D-18): the
 * yt-dlp binary → `bin/`, the POT extractor plugin → `bin/yt-dlp-plugins/`,
 * and the POT Node server → `vendor/bgutil-pot-provider/`, plus its own
 * pinned dependency tree (C-26, C-28). None of the three legs ships in
 * git — they are gitignored and downloaded + checksum-verified against
 * `vendor/versions.json` every run.
 *
 * `setup` fails LOUDLY, never silently, on:
 *   - a checksum mismatch (vendor.mjs's `verifyAndWrite`)
 *   - a destination missing after install (C-28)
 *   - no lockfile — committed or vendored — for the POT server's own
 *     dependency tree, rather than falling back to an unpinned
 *     `npm install` (C-26)
 *
 * The one case it does NOT fail on: `vendor/versions.json` itself being
 * absent, which is the Docker-build case where `npm ci` (and therefore
 * `postinstall`) runs on a layer that only holds `package*.json`. There it
 * warns, names `npm run setup`, and exits 0 — Part 7 §13.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { downloadBuffer, resolvePlatformEntry, sha256Hex, verifyAndWrite } from "./lib/vendor.mjs";

export class SetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "SetupError";
  }
}

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function destinations(appDir) {
  const ytdlpBin = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  return {
    versionsPath: path.join(appDir, "vendor", "versions.json"),
    ytdlp: path.join(appDir, "bin", ytdlpBin),
    potPlugin: path.join(appDir, "bin", "yt-dlp-plugins", "bgutil-ytdlp-pot-provider.py"),
    potServerDir: path.join(appDir, "vendor", "bgutil-pot-provider"),
    vendoredLockfile: path.join(appDir, "vendor", "bgutil-pot-provider.package-lock.json"),
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new SetupError(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

/**
 * Real extraction shells out to the system `tar` (present on both this
 * project's platforms — Windows ships bsdtar since 2018, Linux hosts ship
 * GNU tar) rather than adding a dependency for it. Tests inject a fake so
 * `npm test` never touches the network or a real archive.
 */
async function defaultExtractPotServer(buffer, destDir) {
  await mkdir(destDir, { recursive: true });
  const archivePath = path.join(destDir, ".pot-server-download.tar.gz");
  await writeFile(archivePath, buffer);
  try {
    await runCommand("tar", ["-xzf", archivePath, "-C", destDir, "--strip-components=1"]);
  } finally {
    await unlink(archivePath).catch(() => {});
  }
}

function defaultDeps() {
  return {
    downloadBuffer,
    verifyAndWrite,
    extractPotServer: defaultExtractPotServer,
    pathExists: async (p) => existsSync(p),
    copyLockfile: async (from, to) => copyFile(from, to),
    runNpmCi: (cwd) => runCommand("npm", ["ci", "--omit=dev"], { cwd }),
  };
}

/**
 * `vendor/versions.json` is committed and therefore always PRESENT, but it
 * ships with empty `url`/`sha256` placeholders until a maintainer runs
 * `npm run update:ytdlp` once, reviews the real pins in the diff, and
 * commits them (Part 5 §K — "the pinned hash is recorded by a human on
 * first acquisition, reviewed in the diff"). Until then, every leg for
 * this platform must be treated the same as the file being absent —
 * otherwise a fresh `npm ci` on any clone crashes `postinstall` trying to
 * fetch an empty URL.
 */
function allLegsPinned(versions) {
  for (const [leg, legName] of [
    [versions.ytdlp, "ytdlp"],
    [versions.potPlugin, "potPlugin"],
    [versions.potServer, "potServer"],
  ]) {
    const entry = resolvePlatformEntry(leg, legName);
    if (!entry.url || !entry.sha256) return false;
  }
  return true;
}

async function installSingleFileLeg(leg, legName, destPath, deps) {
  const entry = resolvePlatformEntry(leg, legName);
  const buffer = await deps.downloadBuffer(entry.url);
  await deps.verifyAndWrite(buffer, entry.sha256, destPath, { mode: 0o755 });
}

async function installPotServer(leg, destDir, deps) {
  const entry = resolvePlatformEntry(leg, "potServer");
  const buffer = await deps.downloadBuffer(entry.url);
  const actual = sha256Hex(buffer);
  if (actual.toLowerCase() !== String(entry.sha256).toLowerCase()) {
    throw new SetupError(
      `Checksum mismatch for potServer archive: expected ${entry.sha256}, got ${actual}`,
    );
  }
  await deps.extractPotServer(buffer, destDir);
}

async function verifyDestinationsExist(dest, deps) {
  const required = [dest.ytdlp, dest.potPlugin, dest.potServerDir];
  const missing = [];
  for (const candidate of required) {
    if (!(await deps.pathExists(candidate))) missing.push(candidate);
  }
  if (missing.length > 0) {
    throw new SetupError(`setup did not materialize: ${missing.join(", ")}`);
  }
}

async function ensurePotServerLockfile(dest, deps) {
  const releaseLockfile = path.join(dest.potServerDir, "package-lock.json");
  if (await deps.pathExists(releaseLockfile)) return;

  if (!(await deps.pathExists(dest.vendoredLockfile))) {
    throw new SetupError(
      "No package-lock.json for the POT server — the release shipped none, and no " +
        "vendored fallback exists at vendor/bgutil-pot-provider.package-lock.json. " +
        "Refusing to run an unpinned npm install (C-26).",
    );
  }
  await deps.copyLockfile(dest.vendoredLockfile, releaseLockfile);
}

/**
 * Runs the full clean-host bootstrap. Returns `{ skipped: true }` without
 * installing anything when `vendor/versions.json` is absent (the Docker
 * `postinstall` case, Part 7 §13); otherwise installs all three legs,
 * verifies every destination exists, and pins the POT server's own
 * dependency tree via `npm ci --omit=dev`.
 */
export async function runSetup(options = {}) {
  const appDir = options.appDir ?? APP_DIR;
  const deps = { ...defaultDeps(), ...(options.deps ?? {}) };
  const dest = destinations(appDir);

  if (!(await deps.pathExists(dest.versionsPath))) {
    return {
      skipped: true,
      reason: "vendor/versions.json is absent — run `npm run setup` once vendor/ is present.",
    };
  }

  const versions = JSON.parse(await readFile(dest.versionsPath, "utf8"));

  if (!allLegsPinned(versions)) {
    return {
      skipped: true,
      reason:
        "vendor/versions.json has no pinned URL/checksum yet for this platform — run " +
        "`npm run update:ytdlp` once to populate real pins (reviewed in the diff) " +
        "before `npm run setup` can install anything.",
    };
  }

  await installSingleFileLeg(versions.ytdlp, "ytdlp", dest.ytdlp, deps);
  await installSingleFileLeg(versions.potPlugin, "potPlugin", dest.potPlugin, deps);
  await installPotServer(versions.potServer, dest.potServerDir, deps);

  await verifyDestinationsExist(dest, deps);
  await ensurePotServerLockfile(dest, deps);
  await deps.runNpmCi(dest.potServerDir);

  return { skipped: false };
}

async function main() {
  const result = await runSetup();
  if (result.skipped) {
    console.warn(`setup: ${result.reason}`);
    return;
  }
  console.log(
    "setup complete: yt-dlp, the POT plugin and the POT server are installed and pinned.",
  );
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
