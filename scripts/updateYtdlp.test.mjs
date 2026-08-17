import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./lib/vendor.mjs";
import { UpdateError, findShaSumsEntry, runUpdate, verifyYtdlpAsset } from "./updateYtdlp.mjs";

describe("findShaSumsEntry", () => {
  const sums = [
    "1111111111111111111111111111111111111111111111111111111111111111  yt-dlp",
    "2222222222222222222222222222222222222222222222222222222222222222  yt-dlp.exe",
    "",
  ].join("\n");

  it("returns the lowercase digest for a listed asset", () => {
    expect(findShaSumsEntry(sums, "yt-dlp.exe")).toBe(
      "2222222222222222222222222222222222222222222222222222222222222222",
    );
  });

  it("returns undefined for an asset the file does not list", () => {
    expect(findShaSumsEntry(sums, "yt-dlp_macos")).toBeUndefined();
  });
});

describe("verifyYtdlpAsset", () => {
  it("resolves with the expected digest when the buffer matches", async () => {
    const buffer = Buffer.from("real yt-dlp bytes");
    const digest = sha256Hex(buffer);
    const sums = `${digest}  yt-dlp.exe\n`;

    await expect(verifyYtdlpAsset(buffer, "yt-dlp.exe", sums)).resolves.toBe(digest);
  });

  it("throws when the buffer does not match the published sum", async () => {
    const buffer = Buffer.from("tampered or corrupted bytes");
    const wrongDigest = "0".repeat(64);
    const sums = `${wrongDigest}  yt-dlp.exe\n`;

    await expect(verifyYtdlpAsset(buffer, "yt-dlp.exe", sums)).rejects.toThrow(UpdateError);
  });

  it("throws when the asset has no entry at all in SHA2-256SUMS", async () => {
    const buffer = Buffer.from("bytes");
    await expect(verifyYtdlpAsset(buffer, "yt-dlp.exe", "")).rejects.toThrow(UpdateError);
  });
});

describe("runUpdate", () => {
  let appDir;
  let versionsPath;
  let originalContent;

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), "update-ytdlp-test-"));
    await mkdir(join(appDir, "vendor"), { recursive: true });
    versionsPath = join(appDir, "vendor", "versions.json");
    originalContent = JSON.stringify(
      {
        ytdlp: {
          version: "2026.01.01",
          distributionShape: "onefile",
          platforms: {
            "win32-x64": { url: "https://example.test/old-win", sha256: "a".repeat(64) },
            "linux-x64": { url: "https://example.test/old-linux", sha256: "b".repeat(64) },
          },
        },
        potServer: {
          version: "1.0.0",
          platforms: {
            "win32-x64": { url: "https://example.test/old-server", sha256: "c".repeat(64) },
            "linux-x64": { url: "https://example.test/old-server", sha256: "c".repeat(64) },
          },
        },
        potPlugin: {
          version: "1.0.0",
          platforms: {
            "win32-x64": { url: "https://example.test/old-plugin", sha256: "d".repeat(64) },
            "linux-x64": { url: "https://example.test/old-plugin", sha256: "d".repeat(64) },
          },
        },
      },
      null,
      2,
    );
    await writeFile(versionsPath, originalContent);
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  it("aborts and leaves the previous pin unchanged when an asset mismatches upstream SHA2-256SUMS", async () => {
    const newYtdlpBuffer = Buffer.from("new yt-dlp release bytes");
    const wrongSums = `${"f".repeat(64)}  yt-dlp.exe\n${"f".repeat(64)}  yt-dlp\n`;

    const deps = {
      resolveYtdlpRelease: async () => ({
        version: "2026.02.01",
        assets: {
          "win32-x64": { name: "yt-dlp.exe", url: "https://example.test/new-win" },
          "linux-x64": { name: "yt-dlp", url: "https://example.test/new-linux" },
        },
        sha2SumsUrl: "https://example.test/SHA2-256SUMS",
      }),
      fetchText: async () => wrongSums,
      downloadBuffer: async () => newYtdlpBuffer,
      resolvePotServerRelease: async () => {
        throw new Error("should not be reached — yt-dlp verification fails first");
      },
      resolvePotPluginRelease: async () => {
        throw new Error("should not be reached — yt-dlp verification fails first");
      },
      smokeCheck: async () => {
        throw new Error("should not be reached — yt-dlp verification fails first");
      },
    };

    await expect(runUpdate({ appDir, deps })).rejects.toThrow(UpdateError);
    await expect(readFile(versionsPath, "utf8")).resolves.toBe(originalContent);
  });

  it("rolls back to the previous pin when the post-update smoke check fails", async () => {
    const newYtdlpBuffer = Buffer.from("new yt-dlp release bytes");
    const digest = sha256Hex(newYtdlpBuffer);
    const goodSums = `${digest}  yt-dlp.exe\n${digest}  yt-dlp\n`;
    const tofuBuffer = Buffer.from("tofu bytes");

    const deps = {
      resolveYtdlpRelease: async () => ({
        version: "2026.02.01",
        assets: {
          "win32-x64": { name: "yt-dlp.exe", url: "https://example.test/new-win" },
          "linux-x64": { name: "yt-dlp", url: "https://example.test/new-linux" },
        },
        sha2SumsUrl: "https://example.test/SHA2-256SUMS",
      }),
      fetchText: async () => goodSums,
      downloadBuffer: async () => newYtdlpBuffer,
      resolvePotServerRelease: async () => ({
        version: "1.1.0",
        assets: {
          "win32-x64": { url: "https://example.test/new-server" },
          "linux-x64": { url: "https://example.test/new-server" },
        },
      }),
      resolvePotPluginRelease: async () => ({
        version: "1.1.0",
        assets: {
          "win32-x64": { url: "https://example.test/new-plugin" },
          "linux-x64": { url: "https://example.test/new-plugin" },
        },
      }),
      downloadTofuBuffer: async () => tofuBuffer,
      smokeCheck: async () => {
        throw new Error("simulated: yt-dlp --version failed after update");
      },
    };

    await expect(runUpdate({ appDir, deps })).rejects.toThrow(/simulated/);
    await expect(readFile(versionsPath, "utf8")).resolves.toBe(originalContent);
  });

  it("writes the new pin and TOFU-records the POT legs when everything succeeds", async () => {
    const newYtdlpBuffer = Buffer.from("new yt-dlp release bytes");
    const digest = sha256Hex(newYtdlpBuffer);
    const goodSums = `${digest}  yt-dlp.exe\n${digest}  yt-dlp\n`;
    const tofuBuffer = Buffer.from("tofu bytes");

    let smokeChecked = false;
    const deps = {
      resolveYtdlpRelease: async () => ({
        version: "2026.02.01",
        assets: {
          "win32-x64": { name: "yt-dlp.exe", url: "https://example.test/new-win" },
          "linux-x64": { name: "yt-dlp", url: "https://example.test/new-linux" },
        },
        sha2SumsUrl: "https://example.test/SHA2-256SUMS",
      }),
      fetchText: async () => goodSums,
      downloadBuffer: async () => newYtdlpBuffer,
      resolvePotServerRelease: async () => ({
        version: "1.1.0",
        assets: {
          "win32-x64": { url: "https://example.test/new-server" },
          "linux-x64": { url: "https://example.test/new-server" },
        },
      }),
      resolvePotPluginRelease: async () => ({
        version: "1.1.0",
        assets: {
          "win32-x64": { url: "https://example.test/new-plugin" },
          "linux-x64": { url: "https://example.test/new-plugin" },
        },
      }),
      downloadTofuBuffer: async () => tofuBuffer,
      smokeCheck: async () => {
        smokeChecked = true;
      },
    };

    const result = await runUpdate({ appDir, deps });

    expect(smokeChecked).toBe(true);
    expect(result.ytdlp.version).toBe("2026.02.01");
    expect(result.potServer.version).toBe("1.1.0");
    expect(result.potPlugin.version).toBe("1.1.0");

    const onDisk = JSON.parse(await readFile(versionsPath, "utf8"));
    expect(onDisk.ytdlp.platforms["win32-x64"].sha256).toBe(digest);
    expect(onDisk.potServer.platforms["win32-x64"].sha256).toBe(sha256Hex(tofuBuffer));
  });
});
