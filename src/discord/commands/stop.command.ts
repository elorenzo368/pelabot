import type { ChatInputCommandInteraction } from "discord.js";
import { NOT_YET_IMPLEMENTED } from "../ui/messages.es.js";

/** `/stop` handler skeleton — voice-gated behavior lands Phase 3 (queue-management: Stop Resets Session State, C-24). */
export async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: NOT_YET_IMPLEMENTED, ephemeral: true });
}
