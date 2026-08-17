import { describe, expect, it } from "vitest";
import { ConfigError, parseEnv } from "./env.js";

// POT_PROVIDER_MODE defaults to "managed", which requires POT_PROVIDER_PATH
// to exist on disk (C-28) — point it at a file every checkout already has.
const validEnv: NodeJS.ProcessEnv = {
  DISCORD_TOKEN: "token-123",
  DISCORD_CLIENT_ID: "client-456",
  POT_PROVIDER_PATH: "package.json",
};

function captureConfigError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    parseEnv(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected parseEnv to throw a ConfigError, but it did not");
}

describe("parseEnv", () => {
  it("throws ConfigError with the exact message when DISCORD_TOKEN is missing", () => {
    const { DISCORD_TOKEN: _omit, ...rest } = validEnv;
    const error = captureConfigError(rest);
    expect(error.message).toBe("Missing environment variable: DISCORD_TOKEN");
  });

  it("reports every missing required variable in one pass, not just the first", () => {
    const error = captureConfigError({});
    expect(error.message).toContain("Missing environment variable: DISCORD_TOKEN");
    expect(error.message).toContain("Missing environment variable: DISCORD_CLIENT_ID");
    expect(error.message).toContain("POT_PROVIDER_PATH");
  });

  it("parses a minimally valid env into a Config with defaults applied", () => {
    const config = parseEnv(validEnv);
    expect(config.discordToken).toBe("token-123");
    expect(config.discordClientId).toBe("client-456");
    expect(config.nodeEnv).toBe("production");
    expect(config.maxPlaylistSize).toBe(500);
    expect(config.voiceIdleTimeoutMs).toBe(300_000);
    expect(config.audioProviderChain).toEqual(["ytdlp"]);
    expect(config.potProviderMode).toBe("managed");
    expect(config.port).toBeUndefined();
  });

  describe("POT_PROVIDER_PATH (C-28)", () => {
    it("is required when POT_PROVIDER_MODE=managed", () => {
      const { POT_PROVIDER_PATH: _omit, ...rest } = validEnv;
      const error = captureConfigError(rest);
      expect(error.message).toContain(
        "Missing environment variable: POT_PROVIDER_PATH (required when POT_PROVIDER_MODE=managed)",
      );
    });

    it("must exist on disk when POT_PROVIDER_MODE=managed", () => {
      const error = captureConfigError({ ...validEnv, POT_PROVIDER_PATH: "does-not-exist.bin" });
      expect(error.message).toContain("POT_PROVIDER_PATH does not exist: does-not-exist.bin");
    });

    it("is not required when POT_PROVIDER_MODE is not managed", () => {
      const { POT_PROVIDER_PATH: _omit, ...rest } = validEnv;
      const config = parseEnv({ ...rest, POT_PROVIDER_MODE: "off" });
      expect(config.potProviderMode).toBe("off");
      expect(config.potProviderPath).toBeUndefined();
    });
  });

  describe("AUDIO_PROVIDER_CHAIN allow-list", () => {
    it("rejects an unknown provider entry", () => {
      const error = captureConfigError({
        ...validEnv,
        AUDIO_PROVIDER_CHAIN: "ytdlp,not-a-real-provider",
      });
      expect(error.message).toContain(
        "Unknown audio provider in AUDIO_PROVIDER_CHAIN: not-a-real-provider",
      );
    });

    it("accepts every known provider", () => {
      const config = parseEnv({ ...validEnv, AUDIO_PROVIDER_CHAIN: "ytdlp,youtubei" });
      expect(config.audioProviderChain).toEqual(["ytdlp", "youtubei"]);
    });
  });

  it("rejects the legacy VOICE_IDLE_TIMEOUT variable with the rename error", () => {
    const error = captureConfigError({ ...validEnv, VOICE_IDLE_TIMEOUT: "300" });
    expect(error.message).toContain(
      "VOICE_IDLE_TIMEOUT was renamed to VOICE_IDLE_TIMEOUT_MS (milliseconds)",
    );
  });

  describe("YOUTUBE_COOKIES_PATH", () => {
    it("fails boot when set but not readable", () => {
      const error = captureConfigError({
        ...validEnv,
        YOUTUBE_COOKIES_PATH: "does-not-exist-cookies.txt",
      });
      expect(error.message).toContain(
        "YOUTUBE_COOKIES_PATH is not readable: does-not-exist-cookies.txt",
      );
    });

    it("is accepted when readable", () => {
      const config = parseEnv({ ...validEnv, YOUTUBE_COOKIES_PATH: "package.json" });
      expect(config.youtubeCookiesPath).toBe("package.json");
    });

    it("is optional and absent by default", () => {
      const config = parseEnv(validEnv);
      expect(config.youtubeCookiesPath).toBeUndefined();
    });
  });

  describe("YTDLP_ARGS_EXTRA allow-list (C-27)", () => {
    it("fails boot on a flag that is not allow-listed", () => {
      const error = captureConfigError({
        ...validEnv,
        YTDLP_ARGS_EXTRA: "--exec-before-download evil",
      });
      expect(error.message).toContain(
        "YTDLP_ARGS_EXTRA contains a flag that is not allow-listed: --exec-before-download",
      );
    });

    it("accepts allow-listed flags", () => {
      const config = parseEnv({ ...validEnv, YTDLP_ARGS_EXTRA: "--proxy socks5://h" });
      expect(config.ytdlpArgsExtra).toBe("--proxy socks5://h");
    });
  });

  it("passes YTDLP_PATH and FFMPEG_PATH through unresolved (C-19 lands in Phase 2b)", () => {
    const config = parseEnv({
      ...validEnv,
      YTDLP_PATH: "/some/unresolved/path/yt-dlp",
      FFMPEG_PATH: "/some/unresolved/path/ffmpeg",
    });
    expect(config.ytdlpPath).toBe("/some/unresolved/path/yt-dlp");
    expect(config.ffmpegPath).toBe("/some/unresolved/path/ffmpeg");
  });
});
