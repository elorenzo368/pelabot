import type { ChatInputCommandInteraction } from "discord.js";
import { NOT_YET_IMPLEMENTED } from "../ui/messages.es.js";

/**
 * `/queue` handler skeleton — NOT voice-gated (spec: Queue Read Access
 * Exemption). Pagination and rendering (C-16) land Phase 3.
 */
export async function handleQueue(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: NOT_YET_IMPLEMENTED, ephemeral: true });
}
