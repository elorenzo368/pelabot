import { describe, expect, it } from "vitest";
import { ALLOWED_YTDLP_EXTRA_FLAGS, parseYtdlpArgsExtra, tokenize } from "./argv.js";

describe("tokenize", () => {
  it("returns an empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(tokenize("   \t  ")).toEqual([]);
  });

  it("splits unquoted input on whitespace", () => {
    expect(tokenize("--geo-bypass --force-ipv4")).toEqual(["--geo-bypass", "--force-ipv4"]);
  });

  it("groups a double-quoted run into one token", () => {
    expect(tokenize('--user-agent "Mozilla/5.0 Some Agent"')).toEqual([
      "--user-agent",
      "Mozilla/5.0 Some Agent",
    ]);
  });

  it("groups a single-quoted run into one token", () => {
    expect(tokenize("--proxy 'socks5://host:1080'")).toEqual(["--proxy", "socks5://host:1080"]);
  });

  it("keeps backslashes literal — Windows paths must survive intact", () => {
    expect(tokenize('--proxy "socks5://h" C:\\tmp\\x')).toEqual([
      "--proxy",
      "socks5://h",
      "C:\\tmp\\x",
    ]);
  });
});

describe("parseYtdlpArgsExtra allow-list (C-27)", () => {
  it("returns an empty array for empty input", () => {
    expect(parseYtdlpArgsExtra("")).toEqual([]);
  });

  it.each(ALLOWED_YTDLP_EXTRA_FLAGS)("lets the allow-listed flag %s survive", (flag) => {
    expect(parseYtdlpArgsExtra(`${flag} value`)).toEqual([flag, "value"]);
  });

  it.each([
    "--config-locations",
    "--exec-before-download",
    "--downloader",
    "--external-downloader",
    "-a",
    "--batch-file",
    "--print-to-file",
    "--exec",
    "--paths",
    "-f",
    "-o",
  ])("rejects %s with the named boot error", (flag) => {
    expect(() => parseYtdlpArgsExtra(`${flag} value`)).toThrowError(
      `YTDLP_ARGS_EXTRA contains a flag that is not allow-listed: ${flag}`,
    );
  });

  it("does not reject non-flag values", () => {
    expect(parseYtdlpArgsExtra("--proxy socks5://host:1080")).toEqual([
      "--proxy",
      "socks5://host:1080",
    ]);
  });
});
