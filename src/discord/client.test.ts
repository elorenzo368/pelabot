import { GatewayIntentBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { BOT_INTENTS, createDiscordClient } from "./client.js";

describe("BOT_INTENTS (Phase 1 exit criterion)", () => {
  it("resolves to exactly Guilds | GuildVoiceStates", () => {
    const expectedBitfield = GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates;
    const actualBitfield = BOT_INTENTS.reduce((acc, bit) => acc | bit, 0);
    expect(actualBitfield).toBe(expectedBitfield);
  });

  it("requests no message intent", () => {
    const bitfield = BOT_INTENTS.reduce((acc, bit) => acc | bit, 0);
    // Without GuildVoiceStates, member.voice.channelId is always null (the
    // voice gate rejects every user) and voiceStateUpdate never fires
    // (design-part6 §5) — so the negative assertions below matter as much
    // as the positive one above.
    expect(bitfield & GatewayIntentBits.GuildMessages).toBe(0);
    expect(bitfield & GatewayIntentBits.MessageContent).toBe(0);
    expect(bitfield & GatewayIntentBits.DirectMessages).toBe(0);
    expect(bitfield & GatewayIntentBits.GuildMembers).toBe(0);
  });
});

describe("createDiscordClient", () => {
  it("builds a client whose resolved intents match BOT_INTENTS exactly, no other bit set", () => {
    const client = createDiscordClient();
    expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.GuildVoiceStates)).toBe(true);

    const expectedBitfield = GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates;
    expect(client.options.intents.bitfield).toBe(expectedBitfield);
  });
});
