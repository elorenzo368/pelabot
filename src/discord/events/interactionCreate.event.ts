import { Events, type Client } from "discord.js";
import type { Logger } from "../../utils/logger.js";
import { routeInteraction } from "../commands/router.js";

/**
 * Wires `Client#interactionCreate` to the command router. Call once, after
 * client construction — composition-root wiring lands once the session
 * skeleton it will eventually drive exists.
 */
export function registerInteractionCreateHandler(client: Client, logger: Logger): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction, logger).catch((error: unknown) => {
      logger.error(
        { event: "interaction_handler_error", error },
        "unhandled interaction router error",
      );
    });
  });
}
