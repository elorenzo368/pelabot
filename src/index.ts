import { ConfigError, parseEnv, type Config } from "./config/env.js";
import { startHealthServer } from "./runtime/healthServer.js";
import { createLogger } from "./utils/logger.js";

/**
 * The composition root. This is the ONLY module allowed to call
 * `process.exit` — every other module fails by throwing.
 */

function loadConfig(): Config {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

function main(): void {
  const config = loadConfig();
  const logger = createLogger(config);
  logger.info("pela-discord-bot booting");

  // The Discord client lands in Phase 1. Until then the health server is
  // this process's only reason to keep running — its own listen() call
  // keeps the event loop alive, so main() no longer exits after boot.
  // /health always reports discord: "disconnected" / 503 here (D-14),
  // which is correct: Discord is never connected at this phase.
  startHealthServer(config, logger);
}

main();
