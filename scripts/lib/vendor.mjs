/**
 * Shared download + checksum + rollback helper for the vendored supply
 * chain (C-13, C-26): the yt-dlp binary, the POT Node server, and the POT
 * plugin. Used by both `scripts/setup.mjs` (materialize the pinned triple
 * on a clean host) and `scripts/updateYtdlp.mjs` (re-pin all three legs).
 *
 * Every write goes through `verifyAndWrite`, which checks the downloaded
 * bytes against the committed `sha256` BEFORE touching disk — a mismatch
 * aborts and leaves whatever was already there untouched. That is what
 * "the previous triple stays in place on a failed update" means in
 * practice: nothing here ever partially writes bad bytes.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class VendorError extends Error {
  constructor(message) {
    super(message);
    this.name = "VendorError";
  }
}

/** SHA-256 of `buffer`, lowercase hex — the same encoding `vendor/versions.json` pins. */
export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** `${platform}-${arch}` — the key shape `vendor/versions.json` uses per leg (C-13). */
export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/**
 * Looks up `leg.platforms[platformKey]`. A single `{ url, sha256 }` pair
 * cannot express a win32 dev machine and a linux production host pinned at
 * one version, which is this project's setup — every leg carries one entry
 * per platform-arch key (C-13). Throws a named {@link VendorError} when the
 * current platform has no pin, rather than silently falling back to
 * anything.
 */
export function resolvePlatformEntry(
  leg,
  legName,
  platform = process.platform,
  arch = process.arch,
) {
  const key = platformKey(platform, arch);
  const entry = leg?.platforms?.[key];
  if (!entry) {
    throw new VendorError(`No pinned platform entry for ${legName}: ${key}`);
  }
  return entry;
}

/**
 * Verifies `buffer` against `expectedSha256` and writes it to `destPath`
 * ONLY on a match. A mismatch throws a {@link VendorError} and never
 * touches `destPath` — the file that was there before (if any) is left
 * exactly as it was.
 */
export async function verifyAndWrite(buffer, expectedSha256, destPath, options = {}) {
  const actual = sha256Hex(buffer);
  if (actual.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    throw new VendorError(
      `Checksum mismatch for ${destPath}: expected ${expectedSha256}, got ${actual}`,
    );
  }
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(
    destPath,
    buffer,
    options.mode !== undefined ? { mode: options.mode } : undefined,
  );
}

/** Downloads `url` into a `Buffer`. Throws a named {@link VendorError} on a non-2xx response. */
export async function downloadBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new VendorError(`Download failed (${response.status} ${response.statusText}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Runs `fn` with `filePath` backed up first. If `fn` throws — the smoke
 * check after an `update:ytdlp` run failing, for example — `filePath` is
 * restored to its pre-`fn` content before the error propagates, so a
 * failed update leaves the previously pinned set in place rather than a
 * half-written one.
 */
export async function withRollback(filePath, fn) {
  const backupPath = `${filePath}.bak`;
  await copyFile(filePath, backupPath);
  try {
    return await fn();
  } catch (error) {
    await copyFile(backupPath, filePath);
    throw error;
  } finally {
    await unlink(backupPath).catch(() => {});
  }
}
