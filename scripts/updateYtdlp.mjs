#!/usr/bin/env node
/**
 * Updates all three vendored legs together (never one alone — a
 * version-coupled triple, Part 5 §K): the yt-dlp binary, the POT Node
 * server, and the POT plugin. Rewrites `vendor/versions.json`, then
 * smoke-checks the new pin and rolls back to the previous one on any
 * failure (`withRollback` from `lib/vendor.mjs`).
 *
 * Trust posture, stated plainly rather than implied (C-26, D-31):
 *   - yt-dlp is verified against upstream's published `SHA2-256SUMS` —
 *     TLS trust, not signature trust, since that file is itself fetched
 *     unsigned over the same channel.
 *   - the POT server and POT plugin publish no checksums at all. Their
 *     pin is trust-on-first-use: whatever this run downloads becomes the
 *     committed pin, reviewed by a human in the diff before it merges.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { downloadBuffer, sha256Hex, withRollback } from "./lib/vendor.mjs";

export class UpdateError extends Error {
  constructor(message) {
    super(message);
    this.name = "UpdateError";
  }
}

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORM_KEYS = ["win32-x64", "linux-x64"];

const YTDLP_RELEASE_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const POT_RELEASE_API =
  "https://api.github.com/repos/Brainicism/bgutil-ytdlp-pot-provider/releases/latest";

/** yt-dlp's long-standing onefile release asset names (Part 1 §K's distribution shape default). */
const YTDLP_ASSET_NAMES = { "win32-x64": "yt-dlp.exe", "linux-x64": "yt-dlp" };

/**
 * Parses a `SHA2-256SUMS` file (`<hex>  <filename>` per line, optionally
 * with a leading `*` before the filename for binary mode) and returns the
 * lowercase hex digest for `assetName`, or `undefined` when unlisted.
 */
export function findShaSumsEntry(sha2SumsText, assetName) {
  for (const rawLine of sha2SumsText.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (match && match[2] === assetName) {
      return match[1].toLowerCase();
    }
  }
  return undefined;
}

/**
 * Downloads `assetName` and verifies it against the upstream SHA2-256SUMS
 * text BEFORE returning it. Throws {@link UpdateError} on any mismatch or
 * a missing entry — a failed verification here must abort the whole
 * update, never fall back to trusting the bytes anyway.
 */
export async function verifyYtdlpAsset(buffer, assetName, sha2SumsText) {
  const expected = findShaSumsEntry(sha2SumsText, assetName);
  if (expected === undefined) {
    throw new UpdateError(`Upstream SHA2-256SUMS has no entry for ${assetName}`);
  }
  const actual = sha256Hex(buffer).toLowerCase();
  if (actual !== expected) {
    throw new UpdateError(
      `yt-dlp asset ${assetName} does not match upstream SHA2-256SUMS: expected ${expected}, got ${actual}`,
    );
  }
  return expected;
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
      else reject(new UpdateError(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

/**
 * Discovers the current yt-dlp release: version, the two onefile asset
 * URLs this project pins, and the `SHA2-256SUMS` asset URL.
 */
async function defaultResolveYtdlpRelease() {
  const response = await fetch(YTDLP_RELEASE_API);
  if (!response.ok) {
    throw new UpdateError(`Failed to fetch yt-dlp release metadata (${response.status})`);
  }
  const release = await response.json();
  const assets = {};
  for (const key of PLATFORM_KEYS) {
    const assetName = YTDLP_ASSET_NAMES[key];
    const asset = release.assets?.find((a) => a.name === assetName);
    if (!asset) {
      throw new UpdateError(`yt-dlp release ${release.tag_name} has no asset named ${assetName}`);
    }
    assets[key] = { name: assetName, url: asset.browser_download_url };
  }
  const sumsAsset = release.assets?.find((a) => a.name === "SHA2-256SUMS");
  if (!sumsAsset) {
    throw new UpdateError(`yt-dlp release ${release.tag_name} has no SHA2-256SUMS asset`);
  }
  return { version: release.tag_name, assets, sha2SumsUrl: sumsAsset.browser_download_url };
}

/**
 * Deliberately UNRESOLVED. An earlier draft of this default guessed the POT
 * server/plugin asset apart by filename pattern; checked against the real
 * `bgutil-ytdlp-pot-provider` release (verified during this change), that
 * guess is wrong — the release currently publishes exactly one asset,
 * `bgutil-ytdlp-pot-provider.zip`, whose name contains neither "server"
 * nor "plugin", and it unzips to the **plugin**'s `yt_dlp_plugins/`
 * package (three `.py` files), not a server build at all. Where the
 * server build actually comes from (repo source tarball? a separate
 * package?) is unconfirmed and is exactly what Phase 2a-i's spike exists
 * to nail down against a real host.
 *
 * Shipping a confident-looking heuristic that is empirically wrong is
 * worse than refusing to guess: this throws every time, naming what a
 * maintainer needs to resolve by hand for the first pin (D-31 already
 * expects that first acquisition to be human-reviewed in the diff).
 * Replace this with a real resolver once Phase 2a-i confirms the actual
 * distribution shape for both legs.
 */
function unresolvedTofuRelease(legName) {
  return async function resolveTofuRelease() {
    throw new UpdateError(
      `Automatic release discovery for the POT ${legName} is not implemented — its real ` +
        "distribution shape is unconfirmed (see the comment above this function). Check " +
        `${POT_RELEASE_API} by hand, resolve the URL, verify it by hand, and record the ` +
        "pin directly in vendor/versions.json, reviewed in the diff (D-31).",
    );
  };
}

async function defaultSmokeCheck({ appDir }) {
  const ytdlpBin = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  await runCommand(path.join(appDir, "bin", ytdlpBin), ["--version"]);
  // POT `/ping` and one real extraction need the audio provider runtime
  // (Phase 2b) — stubbed here the same way `C-19`'s binary resolution is
  // stubbed in `config/env.ts` until then. Not silently skipped: logged.
  console.warn(
    "smoke check: yt-dlp --version passed. POT /ping and a real extraction are stubbed " +
      "until Phase 2b's audio provider runtime exists.",
  );
}

function defaultDeps() {
  return {
    resolveYtdlpRelease: defaultResolveYtdlpRelease,
    fetchText: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new UpdateError(`Fetch failed (${response.status}): ${url}`);
      return response.text();
    },
    downloadBuffer,
    resolvePotServerRelease: unresolvedTofuRelease("server"),
    resolvePotPluginRelease: unresolvedTofuRelease("plugin"),
    downloadTofuBuffer: downloadBuffer,
    smokeCheck: defaultSmokeCheck,
  };
}

async function pinYtdlp(deps) {
  const release = await deps.resolveYtdlpRelease();
  const sha2SumsText = await deps.fetchText(release.sha2SumsUrl);

  const platforms = {};
  for (const key of PLATFORM_KEYS) {
    const asset = release.assets[key];
    const buffer = await deps.downloadBuffer(asset.url);
    const sha256 = await verifyYtdlpAsset(buffer, asset.name, sha2SumsText);
    platforms[key] = { url: asset.url, sha256 };
  }

  return { version: release.version, distributionShape: "onefile", platforms };
}

async function pinTofuLeg(deps, resolveRelease) {
  const release = await resolveRelease();
  const platforms = {};
  for (const key of PLATFORM_KEYS) {
    const asset = release.assets[key];
    const buffer = await deps.downloadTofuBuffer(asset.url);
    platforms[key] = { url: asset.url, sha256: sha256Hex(buffer) };
  }
  return { version: release.version, platforms };
}

/**
 * Re-pins all three legs, smoke-checks the result, and rolls back to the
 * previous `vendor/versions.json` if the smoke check (or any earlier
 * step) fails. Never touches `bin/`/`vendor/bgutil-pot-provider/` — run
 * `npm run setup` afterward to materialize the newly pinned bytes.
 */
export async function runUpdate(options = {}) {
  const appDir = options.appDir ?? APP_DIR;
  const versionsPath = path.join(appDir, "vendor", "versions.json");
  const deps = { ...defaultDeps(), ...(options.deps ?? {}) };

  return withRollback(versionsPath, async () => {
    const ytdlp = await pinYtdlp(deps);
    const potServer = await pinTofuLeg(deps, deps.resolvePotServerRelease);
    const potPlugin = await pinTofuLeg(deps, deps.resolvePotPluginRelease);

    const next = { ytdlp, potServer, potPlugin };
    await writeFile(versionsPath, JSON.stringify(next, null, 2) + "\n");

    await deps.smokeCheck({ appDir });

    return next;
  });
}

async function main() {
  const result = await runUpdate();
  console.log(
    `update:ytdlp complete — yt-dlp ${result.ytdlp.version}, POT server ${result.potServer.version}, ` +
      `POT plugin ${result.potPlugin.version}. Review vendor/versions.json in the diff before committing.`,
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
