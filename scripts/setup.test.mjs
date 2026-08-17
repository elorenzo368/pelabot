import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex, verifyAndWrite } from "./lib/vendor.mjs";
import { SetupError, runSetup } from "./setup.mjs";

function perPlatform(buffer) {
  const url = "https://example.test/artifact";
  return {
    "win32-x64": { url, sha256: sha256Hex(buffer) },
    "linux-x64": { url, sha256: sha256Hex(buffer) },
  };
}

function makeVersions({ ytdlpBuf, pluginBuf, serverBuf }) {
  return {
    ytdlp: { version: "1.0.0", distributionShape: "onefile", platforms: perPlatform(ytdlpBuf) },
    potPlugin: { version: "1.0.0", platforms: perPlatform(pluginBuf) },
    potServer: { version: "1.0.0", platforms: perPlatform(serverBuf) },
  };
}

function makeDeps(overrides = {}) {
  return {
    downloadBuffer: async (url) => {
      throw new Error(`test did not stub a download for: ${url}`);
    },
    verifyAndWrite,
    extractPotServer: async (_buffer, destDir) => {
      await mkdir(destDir, { recursive: true });
    },
    pathExists: async (p) => existsSync(p),
    copyLockfile: async (from, to) => {
      await copyFile(from, to);
    },
    runNpmCi: async () => {},
    ...overrides,
  };
}

describe("runSetup", () => {
  let appDir;

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), "setup-test-"));
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  it("warns and does nothing when vendor/versions.json is absent (Docker layer without vendor/ yet)", async () => {
    const result = await runSetup({ appDir, deps: makeDeps() });

    expect(result.skipped).toBe(true);
  });

  it("warns and does nothing when the committed vendor/versions.json still carries empty placeholder pins — this is exactly what ships in this repo until a maintainer runs update:ytdlp for real, and it must never crash a fresh `npm ci`", async () => {
    const committed = await readFile(new URL("../vendor/versions.json", import.meta.url), "utf8");
    await mkdir(join(appDir, "vendor"), { recursive: true });
    await writeFile(join(appDir, "vendor", "versions.json"), committed);

    const result = await runSetup({ appDir, deps: makeDeps() });

    expect(result.skipped).toBe(true);
  });

  it("installs all three legs, verifies the destinations, and runs npm ci against a lockfile", async () => {
    const ytdlpBuf = Buffer.from("yt-dlp binary bytes");
    const pluginBuf = Buffer.from("pot plugin bytes");
    const serverBuf = Buffer.from("pot server archive bytes");
    await mkdir(join(appDir, "vendor"), { recursive: true });
    await writeFile(
      join(appDir, "vendor", "versions.json"),
      JSON.stringify(makeVersions({ ytdlpBuf, pluginBuf, serverBuf })),
    );

    const npmCiCalls = [];
    let call = 0;
    const deps = makeDeps({
      // Legs are installed in a fixed order (ytdlp, potPlugin, potServer).
      downloadBuffer: async () => {
        call += 1;
        return call === 1 ? ytdlpBuf : call === 2 ? pluginBuf : serverBuf;
      },
      extractPotServer: async (_buffer, destDir) => {
        await mkdir(destDir, { recursive: true });
        await writeFile(join(destDir, "package-lock.json"), "{}");
        await writeFile(join(destDir, "package.json"), "{}");
      },
      runNpmCi: async (cwd) => {
        npmCiCalls.push(cwd);
      },
    });

    await runSetup({ appDir, deps });

    const ytdlpBin = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    await expect(readFile(join(appDir, "bin", ytdlpBin))).resolves.toEqual(ytdlpBuf);
    await expect(
      readFile(join(appDir, "bin", "yt-dlp-plugins", "bgutil-ytdlp-pot-provider.py")),
    ).resolves.toEqual(pluginBuf);
    expect(existsSync(join(appDir, "vendor", "bgutil-pot-provider"))).toBe(true);
    expect(npmCiCalls).toEqual([join(appDir, "vendor", "bgutil-pot-provider")]);
  });

  it("fails loudly when a destination is missing after install (server dir never materialized)", async () => {
    const ytdlpBuf = Buffer.from("yt-dlp binary bytes");
    const pluginBuf = Buffer.from("pot plugin bytes");
    const serverBuf = Buffer.from("pot server archive bytes");
    await mkdir(join(appDir, "vendor"), { recursive: true });
    await writeFile(
      join(appDir, "vendor", "versions.json"),
      JSON.stringify(makeVersions({ ytdlpBuf, pluginBuf, serverBuf })),
    );

    let call = 0;
    const deps = makeDeps({
      downloadBuffer: async () => {
        call += 1;
        return call === 1 ? ytdlpBuf : call === 2 ? pluginBuf : serverBuf;
      },
      // Simulates a broken extraction that silently does not create the dir.
      extractPotServer: async () => {},
    });

    let caught;
    try {
      await runSetup({ appDir, deps });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SetupError);
    expect(caught?.message).toMatch(/did not materialize/);
  });

  it("fails loudly when no lockfile exists anywhere for the POT server", async () => {
    const ytdlpBuf = Buffer.from("yt-dlp binary bytes");
    const pluginBuf = Buffer.from("pot plugin bytes");
    const serverBuf = Buffer.from("pot server archive bytes");
    await mkdir(join(appDir, "vendor"), { recursive: true });
    await writeFile(
      join(appDir, "vendor", "versions.json"),
      JSON.stringify(makeVersions({ ytdlpBuf, pluginBuf, serverBuf })),
    );

    let call = 0;
    const deps = makeDeps({
      downloadBuffer: async () => {
        call += 1;
        return call === 1 ? ytdlpBuf : call === 2 ? pluginBuf : serverBuf;
      },
      // Extraction succeeds but ships no package-lock.json, and no vendored
      // fallback exists in this temp app dir either.
      extractPotServer: async (_buffer, destDir) => {
        await mkdir(destDir, { recursive: true });
        await writeFile(join(destDir, "package.json"), "{}");
      },
    });

    let caught;
    try {
      await runSetup({ appDir, deps });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SetupError);
    expect(caught?.message).toMatch(/package-lock\.json/i);
  });

  it("falls back to the vendored lockfile when the release ships none", async () => {
    const ytdlpBuf = Buffer.from("yt-dlp binary bytes");
    const pluginBuf = Buffer.from("pot plugin bytes");
    const serverBuf = Buffer.from("pot server archive bytes");
    await mkdir(join(appDir, "vendor"), { recursive: true });
    await writeFile(
      join(appDir, "vendor", "versions.json"),
      JSON.stringify(makeVersions({ ytdlpBuf, pluginBuf, serverBuf })),
    );
    await writeFile(join(appDir, "vendor", "bgutil-pot-provider.package-lock.json"), "{}");

    let call = 0;
    const npmCiCalls = [];
    const deps = makeDeps({
      downloadBuffer: async () => {
        call += 1;
        return call === 1 ? ytdlpBuf : call === 2 ? pluginBuf : serverBuf;
      },
      extractPotServer: async (_buffer, destDir) => {
        await mkdir(destDir, { recursive: true });
        await writeFile(join(destDir, "package.json"), "{}");
      },
      runNpmCi: async (cwd) => {
        npmCiCalls.push(cwd);
      },
    });

    await runSetup({ appDir, deps });

    expect(npmCiCalls).toHaveLength(1);
    expect(existsSync(join(appDir, "vendor", "bgutil-pot-provider", "package-lock.json"))).toBe(
      true,
    );
  });
});
