import type { ChatInputCommandInteraction } from "discord.js";
import { NOT_YET_IMPLEMENTED } from "../ui/messages.es.js";

/**
 * `/play` handler skeleton. Full behavior (classify -> MusicService.play ->
 * ack copy chosen by routed kind -> summary edit, design-part6 §6) lands
 * Phase 3+ once `MusicService`/`InputRouter` exist. Reading the `input`
 * option now proves the command's registered shape end-to-end before that
 * domain logic exists; the value itself is unused until then.
 */
export async function handlePlay(interaction: ChatInputCommandInteraction): Promise<void> {
  interaction.options.getString("input", true);
  await interaction.reply({ content: NOT_YET_IMPLEMENTED, ephemeral: true });
}
