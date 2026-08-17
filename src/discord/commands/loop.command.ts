import type { ChatInputCommandInteraction } from "discord.js";
import { NOT_YET_IMPLEMENTED } from "../ui/messages.es.js";

/** `/loop` handler skeleton — voice-gated behavior lands Phase 3-4 (C-24). */
export async function handleLoop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: NOT_YET_IMPLEMENTED, ephemeral: true });
}
