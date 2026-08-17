import pino from "pino";
import type { Config } from "../config/env.js";

export type Logger = pino.Logger;

/** Builds the process-wide root logger from resolved config. */
export function createLogger(config: Pick<Config, "logLevel">): Logger {
  return pino({
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/** Scopes a logger to one guild — every per-guild log line should use this. */
export function childLogger(logger: Logger, guildId: string): Logger {
  return logger.child({ guildId });
}

/**
 * Structured event log helper (PRD §29). `event` should be a stable,
 * snake_case name (e.g. `orphans_swept`, `chain_recovered`). The full event
 * catalog is populated incrementally as each phase lands its own events and
 * completes in Phase 7 — this is the skeleton every later event goes through.
 */
export function logEvent(
  logger: Logger,
  event: string,
  fields: Record<string, unknown> = {},
  level: pino.Level = "info",
): void {
  logger[level]({ event, ...fields });
}
