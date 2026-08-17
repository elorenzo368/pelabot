import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client, Guild, VoiceState } from "discord.js";
import { describe, expect, it } from "vitest";
import { DiscordVoiceStateReader } from "./DiscordVoiceStateReader.js";

interface FakeMember {
  user: { bot: boolean };
}

function fakeVoiceState(channelId: string | null, member: FakeMember | null): VoiceState {
  return { channelId, member } as unknown as VoiceState;
}

function fakeClient(
  guilds: Record<string, { voiceStates: Map<string, VoiceState> } | undefined>,
  selfId = "bot-self-id",
): Client {
  const guildsCache = new Map<string, Guild>();
  for (const [guildId, data] of Object.entries(guilds)) {
    if (data === undefined) continue;
    guildsCache.set(guildId, {
      voiceStates: { cache: data.voiceStates },
    } as unknown as Guild);
  }
  return {
    guilds: { cache: guildsCache },
    user: { id: selfId },
  } as unknown as Client;
}

describe("DiscordVoiceStateReader.countNonBotMembers (C-29)", () => {
  it("counts 2 non-bot members present in the channel", () => {
    const cache = new Map<string, VoiceState>([
      ["user-1", fakeVoiceState("channel-1", { user: { bot: false } })],
      ["user-2", fakeVoiceState("channel-1", { user: { bot: false } })],
    ]);
    const reader = new DiscordVoiceStateReader(fakeClient({ "guild-1": { voiceStates: cache } }));

    expect(reader.countNonBotMembers("guild-1", "channel-1")).toBe(2);
  });

  it("returns 0 for a channel populated only by the bot itself", () => {
    const cache = new Map<string, VoiceState>([
      ["bot-self-id", fakeVoiceState("channel-1", { user: { bot: true } })],
    ]);
    const reader = new DiscordVoiceStateReader(fakeClient({ "guild-1": { voiceStates: cache } }));

    expect(reader.countNonBotMembers("guild-1", "channel-1")).toBe(0);
  });

  it("returns null for an empty voice-state cache while connected — unknown, not confirmed empty", () => {
    const reader = new DiscordVoiceStateReader(
      fakeClient({ "guild-1": { voiceStates: new Map() } }),
    );

    expect(reader.countNonBotMembers("guild-1", "channel-1")).toBeNull();
  });

  it("returns null when the guild itself is not cached", () => {
    const reader = new DiscordVoiceStateReader(fakeClient({}));

    expect(reader.countNonBotMembers("unknown-guild", "channel-1")).toBeNull();
  });

  it("excludes non-bot members present in a DIFFERENT channel", () => {
    const cache = new Map<string, VoiceState>([
      ["user-1", fakeVoiceState("other-channel", { user: { bot: false } })],
    ]);
    const reader = new DiscordVoiceStateReader(fakeClient({ "guild-1": { voiceStates: cache } }));

    expect(reader.countNonBotMembers("guild-1", "channel-1")).toBe(0);
  });

  it("treats a voice state with no resolvable member as non-bot (no privileged intent needed)", () => {
    const cache = new Map<string, VoiceState>([["user-1", fakeVoiceState("channel-1", null)]]);
    const reader = new DiscordVoiceStateReader(fakeClient({ "guild-1": { voiceStates: cache } }));

    expect(reader.countNonBotMembers("guild-1", "channel-1")).toBe(1);
  });
});

describe("DiscordVoiceStateReader.currentChannelId", () => {
  it("returns the bot's own channelId when connected", () => {
    const cache = new Map<string, VoiceState>([
      ["bot-self-id", fakeVoiceState("channel-1", { user: { bot: true } })],
    ]);
    const reader = new DiscordVoiceStateReader(fakeClient({ "guild-1": { voiceStates: cache } }));

    expect(reader.currentChannelId("guild-1")).toBe("channel-1");
  });

  it("returns null when the bot has no voice-state entry (not connected)", () => {
    const reader = new DiscordVoiceStateReader(
      fakeClient({ "guild-1": { voiceStates: new Map() } }),
    );

    expect(reader.currentChannelId("guild-1")).toBeNull();
  });
});

describe("static check: no .members access (C-29)", () => {
  it("DiscordVoiceStateReader.ts never accesses .members", () => {
    const filePath = fileURLToPath(new URL("./DiscordVoiceStateReader.ts", import.meta.url));
    const source = readFileSync(filePath, "utf-8");
    expect(source).not.toContain(".members");
  });
});
