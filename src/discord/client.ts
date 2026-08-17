import { Client, GatewayIntentBits, type ClientOptions } from "discord.js";

/**
 * The exact, and only, intent bitmask this bot requests — `Guilds`
 * (guild/channel structure) and `GuildVoiceStates` (voice channel
 * membership). No message intents: this bot never reads message content.
 *
 * Without `GuildVoiceStates`, `member.voice.channelId` is always `null`
 * (the voice gate rejects every user) and `voiceStateUpdate` never fires
 * (`VoiceStateReader` counts nothing, the empty-channel watchdog never
 * arms) — both present as "the bot is broken" with no error anywhere
 * (design-part6 §5). This is the Phase 1 exit criterion.
 */
export const BOT_INTENTS: readonly GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
];

export function createDiscordClientOptions(): ClientOptions {
  return { intents: BOT_INTENTS };
}

/**
 * Builds the bot's Discord client. Never calls `login()` — wiring the
 * client into the boot sequence (login, event registration) is the
 * composition root's job, once the session skeleton it depends on exists.
 */
export function createDiscordClient(): Client {
  return new Client(createDiscordClientOptions());
}
