/**
 * Prints the bot's OAuth2 invite URL from exactly the 7 permissions the
 * spec names — never Administrator (D-11). The bitfield is a generated
 * artifact: a bot cannot verify its own invite scope retroactively, so
 * this script and the README are where it is proven correct, once,
 * before an operator ever clicks the link.
 */
import { pathToFileURL } from "node:url";

/** The exact 7 permissions the spec's Bot Permission Scope requirement names. */
export const INVITE_PERMISSIONS = {
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
} as const;

/** ORs every {@link INVITE_PERMISSIONS} bit together — Administrator (bit 3) is never among them. */
export function computePermissionBitfield(): bigint {
  return Object.values(INVITE_PERMISSIONS).reduce((acc, bit) => acc | bit, 0n);
}

/**
 * Builds the OAuth2 authorize URL for `clientId`: `scope=bot
 * applications.commands` (slash commands need both), and the bitfield
 * from {@link computePermissionBitfield}.
 */
export function buildInviteUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: computePermissionBitfield().toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function main(): void {
  const clientId = process.env["DISCORD_CLIENT_ID"];
  if (clientId === undefined || clientId === "") {
    console.error("Missing environment variable: DISCORD_CLIENT_ID");
    process.exit(1);
  }
  console.log(buildInviteUrl(clientId));
}

// Only run when executed directly (`tsx scripts/inviteUrl.ts`), never on
// import — tests import the exports above without wanting a live
// process.exit or a DISCORD_CLIENT_ID requirement.
const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main();
}
