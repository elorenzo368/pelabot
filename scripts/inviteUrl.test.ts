import { describe, expect, it } from "vitest";
import { INVITE_PERMISSIONS, buildInviteUrl, computePermissionBitfield } from "./inviteUrl.js";

describe("INVITE_PERMISSIONS", () => {
  it("names exactly the 7 spec permissions", () => {
    expect(Object.keys(INVITE_PERMISSIONS).sort()).toEqual(
      [
        "VIEW_CHANNEL",
        "SEND_MESSAGES",
        "EMBED_LINKS",
        "READ_MESSAGE_HISTORY",
        "CONNECT",
        "SPEAK",
        "USE_APPLICATION_COMMANDS",
      ].sort(),
    );
  });
});

describe("computePermissionBitfield", () => {
  it("matches the exact bitfield for the 7 spec permissions", () => {
    expect(computePermissionBitfield()).toBe(2_150_714_368n);
  });

  it("never includes the Administrator bit (D-11)", () => {
    const ADMINISTRATOR = 1n << 3n;
    expect(computePermissionBitfield() & ADMINISTRATOR).toBe(0n);
  });

  it("sets exactly 7 bits", () => {
    let bitfield = computePermissionBitfield();
    let count = 0;
    while (bitfield > 0n) {
      count += Number(bitfield & 1n);
      bitfield >>= 1n;
    }
    expect(count).toBe(7);
  });
});

describe("buildInviteUrl", () => {
  it("builds a bot+applications.commands scoped URL with the client id and bitfield", () => {
    const url = buildInviteUrl("123456789012345678");
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("123456789012345678");
    expect(parsed.searchParams.get("scope")).toBe("bot applications.commands");
    expect(parsed.searchParams.get("permissions")).toBe("2150714368");
  });
});
