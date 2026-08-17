import type { ChatInputCommandInteraction, Interaction } from "discord.js";
import { logEvent, type Logger } from "../../utils/logger.js";
import { handleLoop } from "./loop.command.js";
import { handlePause } from "./pause.command.js";
import { handlePlay } from "./play.command.js";
import { handleQueue } from "./queue.command.js";
import { handleResume } from "./resume.command.js";
import { handleShuffle } from "./shuffle.command.js";
import { handleSkip } from "./skip.command.js";
import { handleStop } from "./stop.command.js";

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

/**
 * One dispatch table, the interaction router's only source of truth for
 * "which handler owns this command name" — exactly the 8 V1 commands
 * (spec: Command Surface), no more.
 */
const COMMAND_HANDLERS: Readonly<Record<string, CommandHandler>> = {
  play: handlePlay,
  pause: handlePause,
  resume: handleResume,
  skip: handleSkip,
  stop: handleStop,
  queue: handleQueue,
  shuffle: handleShuffle,
  loop: handleLoop,
};

/**
 * Routes one Discord `Interaction` to its command handler. Ignores every
 * interaction type except chat input commands (autocomplete, buttons,
 * modals — none exist in V1) and logs, rather than throws, on an
 * unregistered command name: Discord's own registered set can only
 * diverge from this table mid-propagation after a redeploy, never be
 * handed to us maliciously in this deployment.
 */
export async function routeInteraction(interaction: Interaction, logger: Logger): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const handler = COMMAND_HANDLERS[interaction.commandName];
  if (handler === undefined) {
    logEvent(logger, "unknown_command", { commandName: interaction.commandName }, "warn");
    return;
  }

  await handler(interaction);
}
