import { ConfigError, parseEnv, type Config } from "./config/env.js";
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

  // Health server wiring lands in Phase 0.5 (task 0.5.3), and the Discord
  // client in Phase 1. Until then this composition root has nothing left
  // to keep the process alive for, so it exits cleanly rather than hanging.
  logger.info("health server placeholder — not wired yet, exiting cleanly");

  process.exit(0);
}

main();
