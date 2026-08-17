import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { z } from "zod";
import { parseYtdlpArgsExtra } from "../utils/argv.js";

/**
 * Thrown by {@link parseEnv} when one or more environment variables are
 * missing or invalid. `message` may contain multiple lines — one per
 * problem found — because `parseEnv` reports every failure in one pass
 * rather than making the operator fix issues one at a time.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type AudioProviderName = "ytdlp" | "youtubei";
const KNOWN_AUDIO_PROVIDERS: readonly AudioProviderName[] = ["ytdlp", "youtubei"];

export type PotProviderMode = "managed" | "external" | "off";
const POT_PROVIDER_MODES: readonly PotProviderMode[] = ["managed", "external", "off"];

export interface Config {
  discordToken: string;
  discordClientId: string;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  healthDetailToken?: string;

  nodeEnv: string;
  /** Raw config values only — the SERVER_PORT -> SERVER_ALLOCATION_PORT ->
   * PORT -> 3000 resolution chain is `runtime/healthServer.ts`'s job. */
  port?: number;
  serverPort?: number;
  serverAllocationPort?: number;
  serverIp: string;
  logLevel: string;

  maxPlaylistSize: number;
  maxQueueSize: number;
  maxSearchResults: number;
  queuePageSize: number;

  voiceIdleTimeoutMs: number;
  voiceJoinTimeoutMs: number;
  voiceReconnectAttempts: number;

  prefetchTracks: number;

  searchTimeoutMs: number;
  resolveTimeoutMs: number;
  streamOpenTimeoutMs: number;
  playStartTimeoutMs: number;
  trackStartDeadlineMs: number;
  trackStartSloMs: number;
  slowStartThreshold: number;

  playbackStartThreshold: number;
  toolFailureThreshold: number;

  rateLimitPlayMax: number;
  rateLimitPlayWindowMs: number;

  matchLowConfidenceThreshold: number;

  audioProviderChain: readonly AudioProviderName[];
  audioFailureThreshold: number;
  audioFailureWindowMs: number;
  audioDegradedCooldownMs: number;

  /** Informational only (2a item 11 pass condition) — not read by the bot. */
  memoryBudgetMb: number;

  /** Raw config value only — full resolution (C-19) lands in Phase 2b. */
  ytdlpPath?: string;
  ytdlpArgsExtra: string;
  /** Raw config value only — full resolution (C-19) lands in Phase 2b. */
  ffmpegPath: string;

  potProviderMode: PotProviderMode;
  potProviderPath?: string;
  potProviderUrl: string;
  potSupervisorRearmMs: number;
  potPingFailures: number;

  youtubeCookiesPath?: string;
}

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

function isReadableFile(path: string): boolean {
  try {
    accessSync(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function parseProviderChain(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

interface RequiredCheckResult {
  issues: string[];
  potProviderMode: PotProviderMode;
}

/**
 * Every check below runs unconditionally and independently — none of them
 * short-circuits the others — so `parseEnv` reports every problem found in
 * a single pass, never just the first one.
 */
function collectRequiredIssues(env: NodeJS.ProcessEnv): RequiredCheckResult {
  const issues: string[] = [];

  if (readString(env, "DISCORD_TOKEN") === undefined) {
    issues.push("Missing environment variable: DISCORD_TOKEN");
  }
  if (readString(env, "DISCORD_CLIENT_ID") === undefined) {
    issues.push("Missing environment variable: DISCORD_CLIENT_ID");
  }

  const rawPotMode = readString(env, "POT_PROVIDER_MODE") ?? "managed";
  const potProviderMode = POT_PROVIDER_MODES.includes(rawPotMode as PotProviderMode)
    ? (rawPotMode as PotProviderMode)
    : "managed";
  if (rawPotMode !== potProviderMode) {
    issues.push(
      `POT_PROVIDER_MODE must be one of ${POT_PROVIDER_MODES.join(", ")} — got: ${rawPotMode}`,
    );
  }

  const potProviderPath = readString(env, "POT_PROVIDER_PATH");
  if (potProviderMode === "managed") {
    if (potProviderPath === undefined) {
      issues.push(
        "Missing environment variable: POT_PROVIDER_PATH (required when POT_PROVIDER_MODE=managed)",
      );
    } else if (!existsSync(potProviderPath)) {
      issues.push(`POT_PROVIDER_PATH does not exist: ${potProviderPath}`);
    }
  }

  // Legacy name (PRD §20 used seconds); kept only so the rename is detected.
  if (readString(env, "VOICE_IDLE_TIMEOUT") !== undefined) {
    issues.push("VOICE_IDLE_TIMEOUT was renamed to VOICE_IDLE_TIMEOUT_MS (milliseconds)");
  }

  const youtubeCookiesPath = readString(env, "YOUTUBE_COOKIES_PATH");
  if (youtubeCookiesPath !== undefined && !isReadableFile(youtubeCookiesPath)) {
    issues.push(`YOUTUBE_COOKIES_PATH is not readable: ${youtubeCookiesPath}`);
  }

  const audioProviderChain = readString(env, "AUDIO_PROVIDER_CHAIN") ?? "ytdlp";
  for (const name of parseProviderChain(audioProviderChain)) {
    if (!KNOWN_AUDIO_PROVIDERS.includes(name as AudioProviderName)) {
      issues.push(`Unknown audio provider in AUDIO_PROVIDER_CHAIN: ${name}`);
    }
  }

  try {
    parseYtdlpArgsExtra(readString(env, "YTDLP_ARGS_EXTRA") ?? "");
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return { issues, potProviderMode };
}

// --- Everything below is plain optional coercion with defaults — none of
// it participates in required-ness, so it cannot suppress the checks above.

function optionalString() {
  return z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());
}

function stringWithDefault(defaultValue: string) {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().default(defaultValue),
  );
}

function optionalInt(name: string) {
  return z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : value),
    z.coerce
      .number({ invalid_type_error: `${name} must be a number` })
      .int(`${name} must be an integer`)
      .optional(),
  );
}

function numberWithDefault(name: string, defaultValue: number, opts: { int?: boolean } = {}) {
  const base = z.coerce.number({ invalid_type_error: `${name} must be a number` });
  const withIntCheck = opts.int ? base.int(`${name} must be an integer`) : base;
  return z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : value),
    withIntCheck.default(defaultValue),
  );
}

const optionalDefaultedSchema = z.object({
  SPOTIFY_CLIENT_ID: optionalString(),
  SPOTIFY_CLIENT_SECRET: optionalString(),
  HEALTH_DETAIL_TOKEN: optionalString(),

  NODE_ENV: stringWithDefault("production"),
  PORT: optionalInt("PORT"),
  SERVER_PORT: optionalInt("SERVER_PORT"),
  SERVER_ALLOCATION_PORT: optionalInt("SERVER_ALLOCATION_PORT"),
  SERVER_IP: stringWithDefault("0.0.0.0"),
  LOG_LEVEL: stringWithDefault("info"),

  MAX_PLAYLIST_SIZE: numberWithDefault("MAX_PLAYLIST_SIZE", 500, { int: true }),
  MAX_QUEUE_SIZE: numberWithDefault("MAX_QUEUE_SIZE", 1000, { int: true }),
  MAX_SEARCH_RESULTS: numberWithDefault("MAX_SEARCH_RESULTS", 5, { int: true }),
  QUEUE_PAGE_SIZE: numberWithDefault("QUEUE_PAGE_SIZE", 10, { int: true }),

  VOICE_IDLE_TIMEOUT_MS: numberWithDefault("VOICE_IDLE_TIMEOUT_MS", 300_000, { int: true }),
  VOICE_JOIN_TIMEOUT_MS: numberWithDefault("VOICE_JOIN_TIMEOUT_MS", 20_000, { int: true }),
  VOICE_RECONNECT_ATTEMPTS: numberWithDefault("VOICE_RECONNECT_ATTEMPTS", 5, { int: true }),

  PREFETCH_TRACKS: numberWithDefault("PREFETCH_TRACKS", 1, { int: true }),

  SEARCH_TIMEOUT_MS: numberWithDefault("SEARCH_TIMEOUT_MS", 8_000, { int: true }),
  RESOLVE_TIMEOUT_MS: numberWithDefault("RESOLVE_TIMEOUT_MS", 10_000, { int: true }),
  STREAM_OPEN_TIMEOUT_MS: numberWithDefault("STREAM_OPEN_TIMEOUT_MS", 10_000, { int: true }),
  PLAY_START_TIMEOUT_MS: numberWithDefault("PLAY_START_TIMEOUT_MS", 5_000, { int: true }),
  TRACK_START_DEADLINE_MS: numberWithDefault("TRACK_START_DEADLINE_MS", 15_000, { int: true }),
  TRACK_START_SLO_MS: numberWithDefault("TRACK_START_SLO_MS", 5_000, { int: true }),
  SLOW_START_THRESHOLD: numberWithDefault("SLOW_START_THRESHOLD", 5, { int: true }),

  PLAYBACK_START_THRESHOLD: numberWithDefault("PLAYBACK_START_THRESHOLD", 3, { int: true }),
  TOOL_FAILURE_THRESHOLD: numberWithDefault("TOOL_FAILURE_THRESHOLD", 5, { int: true }),

  RATE_LIMIT_PLAY_MAX: numberWithDefault("RATE_LIMIT_PLAY_MAX", 5, { int: true }),
  RATE_LIMIT_PLAY_WINDOW_MS: numberWithDefault("RATE_LIMIT_PLAY_WINDOW_MS", 10_000, { int: true }),

  MATCH_LOW_CONFIDENCE_THRESHOLD: numberWithDefault("MATCH_LOW_CONFIDENCE_THRESHOLD", 0.35),

  AUDIO_PROVIDER_CHAIN: stringWithDefault("ytdlp"),
  AUDIO_FAILURE_THRESHOLD: numberWithDefault("AUDIO_FAILURE_THRESHOLD", 3, { int: true }),
  AUDIO_FAILURE_WINDOW_MS: numberWithDefault("AUDIO_FAILURE_WINDOW_MS", 120_000, { int: true }),
  AUDIO_DEGRADED_COOLDOWN_MS: numberWithDefault("AUDIO_DEGRADED_COOLDOWN_MS", 300_000, {
    int: true,
  }),

  MEMORY_BUDGET_MB: numberWithDefault("MEMORY_BUDGET_MB", 700, { int: true }),

  // Resolution order (C-19) is stubbed until Phase 2b — raw pass-through only.
  YTDLP_PATH: optionalString(),
  YTDLP_ARGS_EXTRA: stringWithDefault(""),
  FFMPEG_PATH: stringWithDefault("ffmpeg"),

  POT_PROVIDER_URL: stringWithDefault("http://127.0.0.1:4416"),
  POT_SUPERVISOR_REARM_MS: numberWithDefault("POT_SUPERVISOR_REARM_MS", 1_800_000, { int: true }),
  POT_PING_FAILURES: numberWithDefault("POT_PING_FAILURES", 3, { int: true }),

  YOUTUBE_COOKIES_PATH: optionalString(),
});

type OptionalDefaulted = z.infer<typeof optionalDefaultedSchema>;

function toConfig(
  discordToken: string,
  discordClientId: string,
  potProviderMode: PotProviderMode,
  potProviderPath: string | undefined,
  data: OptionalDefaulted,
): Config {
  return {
    discordToken,
    discordClientId,
    ...(data.SPOTIFY_CLIENT_ID !== undefined && { spotifyClientId: data.SPOTIFY_CLIENT_ID }),
    ...(data.SPOTIFY_CLIENT_SECRET !== undefined && {
      spotifyClientSecret: data.SPOTIFY_CLIENT_SECRET,
    }),
    ...(data.HEALTH_DETAIL_TOKEN !== undefined && { healthDetailToken: data.HEALTH_DETAIL_TOKEN }),

    nodeEnv: data.NODE_ENV,
    ...(data.PORT !== undefined && { port: data.PORT }),
    ...(data.SERVER_PORT !== undefined && { serverPort: data.SERVER_PORT }),
    ...(data.SERVER_ALLOCATION_PORT !== undefined && {
      serverAllocationPort: data.SERVER_ALLOCATION_PORT,
    }),
    serverIp: data.SERVER_IP,
    logLevel: data.LOG_LEVEL,

    maxPlaylistSize: data.MAX_PLAYLIST_SIZE,
    maxQueueSize: data.MAX_QUEUE_SIZE,
    maxSearchResults: data.MAX_SEARCH_RESULTS,
    queuePageSize: data.QUEUE_PAGE_SIZE,

    voiceIdleTimeoutMs: data.VOICE_IDLE_TIMEOUT_MS,
    voiceJoinTimeoutMs: data.VOICE_JOIN_TIMEOUT_MS,
    voiceReconnectAttempts: data.VOICE_RECONNECT_ATTEMPTS,

    prefetchTracks: data.PREFETCH_TRACKS,

    searchTimeoutMs: data.SEARCH_TIMEOUT_MS,
    resolveTimeoutMs: data.RESOLVE_TIMEOUT_MS,
    streamOpenTimeoutMs: data.STREAM_OPEN_TIMEOUT_MS,
    playStartTimeoutMs: data.PLAY_START_TIMEOUT_MS,
    trackStartDeadlineMs: data.TRACK_START_DEADLINE_MS,
    trackStartSloMs: data.TRACK_START_SLO_MS,
    slowStartThreshold: data.SLOW_START_THRESHOLD,

    playbackStartThreshold: data.PLAYBACK_START_THRESHOLD,
    toolFailureThreshold: data.TOOL_FAILURE_THRESHOLD,

    rateLimitPlayMax: data.RATE_LIMIT_PLAY_MAX,
    rateLimitPlayWindowMs: data.RATE_LIMIT_PLAY_WINDOW_MS,

    matchLowConfidenceThreshold: data.MATCH_LOW_CONFIDENCE_THRESHOLD,

    audioProviderChain: parseProviderChain(data.AUDIO_PROVIDER_CHAIN) as AudioProviderName[],
    audioFailureThreshold: data.AUDIO_FAILURE_THRESHOLD,
    audioFailureWindowMs: data.AUDIO_FAILURE_WINDOW_MS,
    audioDegradedCooldownMs: data.AUDIO_DEGRADED_COOLDOWN_MS,

    memoryBudgetMb: data.MEMORY_BUDGET_MB,

    ...(data.YTDLP_PATH !== undefined && { ytdlpPath: data.YTDLP_PATH }),
    ytdlpArgsExtra: data.YTDLP_ARGS_EXTRA,
    ffmpegPath: data.FFMPEG_PATH,

    potProviderMode,
    ...(potProviderPath !== undefined && { potProviderPath }),
    potProviderUrl: data.POT_PROVIDER_URL,
    potSupervisorRearmMs: data.POT_SUPERVISOR_REARM_MS,
    potPingFailures: data.POT_PING_FAILURES,

    ...(data.YOUTUBE_COOKIES_PATH !== undefined && {
      youtubeCookiesPath: data.YOUTUBE_COOKIES_PATH,
    }),
  };
}

/**
 * Pure, synchronous parse of `process.env` (or an equivalent map) into a
 * typed {@link Config}. Reports every problem found in one pass — never
 * throws after only the first missing variable.
 */
export function parseEnv(env: NodeJS.ProcessEnv): Config {
  const { issues, potProviderMode } = collectRequiredIssues(env);

  const optionalResult = optionalDefaultedSchema.safeParse(env);
  if (!optionalResult.success) {
    for (const issue of optionalResult.error.issues) {
      issues.push(issue.message);
    }
  }

  if (issues.length > 0) {
    throw new ConfigError(issues.join("\n"));
  }

  // Safe: collectRequiredIssues() found no issues above, which guarantees
  // both required variables are present and optionalResult.success is true.
  const discordToken = readString(env, "DISCORD_TOKEN") as string;
  const discordClientId = readString(env, "DISCORD_CLIENT_ID") as string;
  const potProviderPath = readString(env, "POT_PROVIDER_PATH");
  const data = (optionalResult as { success: true; data: OptionalDefaulted }).data;

  return toConfig(discordToken, discordClientId, potProviderMode, potProviderPath, data);
}
