import type { ChatInputCommandInteraction } from "discord.js";
import { NOT_YET_IMPLEMENTED } from "../ui/messages.es.js";

/** `/resume` handler skeleton — voice-gated behavior lands Phase 3 (C-02, C-24). */
export async function handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: NOT_YET_IMPLEMENTED, ephemeral: true });
}
