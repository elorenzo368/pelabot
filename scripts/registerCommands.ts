/**
 * Standalone command-registration script (`npm run register:commands`),
 * NOT a boot step: registration is a rate-limited write that changes only
 * a handful of times in a project's life, not something to redo on every
 * restart (design-part6 §D).
 *
 * Global route is the default and is what makes every guild the bot joins
 * see the command set (spec: Command Surface). Setting `DISCORD_GUILD_ID`
 * FOR THIS SCRIPT'S OWN INVOCATION switches to the guild-scoped dev fast
 * path instead — instant propagation, scoped to one test guild. The bot
 * process itself never reads `DISCORD_GUILD_ID` anywhere (D-32); this
 * script is the only place in the repo allowed to.
 */
import { pathToFileURL } from "node:url";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

/** Exactly the 8 V1 commands (spec: Command Surface) — /volume is out of V1 (business rule 11). */
export const COMMAND_DEFINITIONS = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a track, playlist, or search query")
    .addStringOption((option) =>
      option
        .setName("input")
        .setDescription("YouTube/Spotify link or free-text search")
        .setRequired(true),
    ),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the current track"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume the paused track"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),
  new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the pending queue"),
  new SlashCommandBuilder().setName("loop").setDescription("Set the loop mode (off/track/queue)"),
] as const;

export interface RegisterCommandsEnv {
  DISCORD_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_GUILD_ID?: string;
}

export interface RegisterCommandsLogger {
  warn: (fields: Record<string, unknown>) => void;
}

export interface RegisterCommandsDeps {
  rest: Pick<REST, "put">;
  logger?: RegisterCommandsLogger;
}

/**
 * Full-array `PUT` of {@link COMMAND_DEFINITIONS} — a replace, so a command
 * dropped from this file is pruned on the next run, never left lingering.
 * Global by default; guild-scoped only when `env.DISCORD_GUILD_ID` is set.
 */
export async function registerCommands(
  env: RegisterCommandsEnv,
  deps: RegisterCommandsDeps,
): Promise<void> {
  if (env.DISCORD_TOKEN === undefined || env.DISCORD_TOKEN === "") {
    throw new Error("Missing environment variable: DISCORD_TOKEN");
  }
  if (env.DISCORD_CLIENT_ID === undefined || env.DISCORD_CLIENT_ID === "") {
    throw new Error("Missing environment variable: DISCORD_CLIENT_ID");
  }

  const body = COMMAND_DEFINITIONS.map((command) => command.toJSON());

  if (env.DISCORD_GUILD_ID !== undefined && env.DISCORD_GUILD_ID !== "") {
    deps.logger?.warn({ event: "command_registration", scope: "guild" });
    await deps.rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
      {
        body,
      },
    );
    return;
  }

  await deps.rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
}

async function main(): Promise<void> {
  const token = process.env["DISCORD_TOKEN"];
  if (token === undefined || token === "") {
    console.error("Missing environment variable: DISCORD_TOKEN");
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const logger: RegisterCommandsLogger = {
    warn: (fields) => console.warn(fields),
  };

  try {
    await registerCommands(process.env, { rest, logger });
    console.log("Commands registered.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Only run when executed directly (`tsx scripts/registerCommands.ts`), never
// on import — the test suite imports registerCommands()/COMMAND_DEFINITIONS
// without wanting a live process.exit or a real REST client.
const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  void main();
}
