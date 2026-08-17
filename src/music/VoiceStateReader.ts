/**
 * `VoiceStateReader` port (ADR-007, design-part6 §5) — a read-only Discord
 * voice-membership query the domain needs (the empty-channel idle check,
 * Phase 7) without importing discord.js.
 * `src/discord/voice/DiscordVoiceStateReader.ts` is the sole implementation.
 */
export interface VoiceStateReader {
  /**
   * Counts non-bot members currently in `channelId` of `guildId`. Returns
   * `null` — never `0` — when nothing is knowable yet: an empty
   * voice-state cache for a guild we ARE connected to means "not
   * populated", not "confirmed empty" (`C-29`).
   */
  countNonBotMembers(guildId: string, channelId: string): number | null;
  /** The channel id this bot is currently connected to in `guildId`, or `null`. */
  currentChannelId(guildId: string): string | null;
}
