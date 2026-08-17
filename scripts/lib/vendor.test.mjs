import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VendorError,
  resolvePlatformEntry,
  sha256Hex,
  verifyAndWrite,
  withRollback,
} from "./vendor.mjs";

describe("sha256Hex", () => {
  it("hashes a known buffer to the expected digest", () => {
    // echo -n "hello" | sha256sum
    expect(sha256Hex(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("resolvePlatformEntry", () => {
  const leg = {
    version: "1.2.3",
    platforms: {
      "linux-x64": { url: "https://example.test/linux", sha256: "a".repeat(64) },
    },
  };

  it("returns the entry for the requested platform-arch key", () => {
    expect(resolvePlatformEntry(leg, "ytdlp", "linux", "x64")).toEqual({
      url: "https://example.test/linux",
      sha256: "a".repeat(64),
    });
  });

  it("throws a named VendorError when the platform key is missing", () => {
    expect(() => resolvePlatformEntry(leg, "ytdlp", "win32", "x64")).toThrow(VendorError);
    expect(() => resolvePlatformEntry(leg, "ytdlp", "win32", "x64")).toThrow(
      "No pinned platform entry for ytdlp: win32-x64",
    );
  });
});

describe("verifyAndWrite", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vendor-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the buffer to disk when the checksum matches", async () => {
    const buffer = Buffer.from("correct bytes");
    const dest = join(dir, "nested", "artifact.bin");

    await verifyAndWrite(buffer, sha256Hex(buffer), dest);

    await expect(readFile(dest)).resolves.toEqual(buffer);
  });

  it("rejects a corrupted buffer and writes nothing", async () => {
    const buffer = Buffer.from("corrupted bytes");
    const dest = join(dir, "artifact.bin");
    const wrongSha256 = "0".repeat(64);

    await expect(verifyAndWrite(buffer, wrongSha256, dest)).rejects.toThrow(VendorError);
    await expect(readFile(dest)).rejects.toThrow();
  });
});

describe("withRollback", () => {
  let dir;
  let filePath;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vendor-rollback-"));
    filePath = join(dir, "versions.json");
    await writeFile(filePath, "original");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps the change when fn succeeds", async () => {
    const result = await withRollback(filePath, async () => {
      await writeFile(filePath, "updated");
      return "ok";
    });

    expect(result).toBe("ok");
    await expect(readFile(filePath, "utf8")).resolves.toBe("updated");
  });

  it("restores the original file when fn throws", async () => {
    await expect(
      withRollback(filePath, async () => {
        await writeFile(filePath, "half-written");
        throw new Error("smoke check failed");
      }),
    ).rejects.toThrow("smoke check failed");

    await expect(readFile(filePath, "utf8")).resolves.toBe("original");
  });
});
