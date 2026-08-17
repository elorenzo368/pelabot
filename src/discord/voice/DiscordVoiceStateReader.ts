import type { Client } from "discord.js";
import type { VoiceStateReader } from "../../music/VoiceStateReader.js";

/**
 * `VoiceStateReader` port implementation (C-29). Derives strictly from
 * `guild.voiceStates.cache` — populated by `GuildVoiceStates` for every
 * connected member at READY, no privileged `GuildMembers` intent needed.
 *
 * MUST NOT read the guild-wide member-list getter on a voice channel
 * (backed by the guild MEMBER cache, which without `GuildMembers` returns
 * 0 — not null — for a channel full of people who were present before
 * boot): that swap is exactly the bug this contract exists to prevent, and
 * it disconnects the bot from a full room on every restart. `VoiceState`'s
 * own singular member accessor is a different, voice-state-scoped
 * property populated from the embedded member data on each voice state
 * entry itself, not from the general member cache — this file uses only
 * that one, never the banned collection getter.
 */
export class DiscordVoiceStateReader implements VoiceStateReader {
  constructor(private readonly client: Client) {}

  countNonBotMembers(guildId: string, channelId: string): number | null {
    const guild = this.client.guilds.cache.get(guildId);
    if (guild === undefined) return null;

    const voiceStates = guild.voiceStates.cache;
    // An empty cache for a guild we ARE connected to means "not populated
    // yet", never "confirmed empty" — the whole point of C-29.
    if (voiceStates.size === 0) return null;

    let count = 0;
    for (const voiceState of voiceStates.values()) {
      if (voiceState.channelId !== channelId) continue;
      if (voiceState.member?.user.bot === true) continue;
      count += 1;
    }
    return count;
  }

  currentChannelId(guildId: string): string | null {
    const selfId = this.client.user?.id;
    if (selfId === undefined) return null;

    const guild = this.client.guilds.cache.get(guildId);
    if (guild === undefined) return null;

    const ownVoiceState = guild.voiceStates.cache.get(selfId);
    return ownVoiceState?.channelId ?? null;
  }
}
