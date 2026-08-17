/**
 * Quote-aware tokenizer for `YTDLP_ARGS_EXTRA`. Backslashes are NEVER
 * treated as an escape character — Windows paths (`C:\tmp\x`) must survive
 * intact, since this project is developed on Windows and deployed to Linux.
 * Single and double quotes both group a run of characters (including
 * whitespace) into one token; the quote characters themselves are not part
 * of the resulting token.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let quoteChar: '"' | "'" | null = null;

  for (const char of input) {
    if (quoteChar !== null) {
      if (char === quoteChar) {
        quoteChar = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      inToken = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
      continue;
    }

    current += char;
    inToken = true;
  }

  if (inToken) tokens.push(current);
  return tokens;
}

/**
 * The allow-list for `YTDLP_ARGS_EXTRA` (C-27). A deny-list cannot be made
 * safe — it is structurally one yt-dlp release behind (see design-part3
 * C-27) — so anything not on this list fails boot rather than being spawned.
 */
export const ALLOWED_YTDLP_EXTRA_FLAGS = [
  "--extractor-args",
  "--geo-bypass",
  "--geo-bypass-country",
  "--geo-bypass-ip-block",
  "--proxy",
  "--source-address",
  "--force-ipv4",
  "--force-ipv6",
  "--user-agent",
] as const;

export type AllowedYtdlpExtraFlag = (typeof ALLOWED_YTDLP_EXTRA_FLAGS)[number];

function isFlagToken(token: string): boolean {
  return token.startsWith("-");
}

/**
 * Tokenizes `YTDLP_ARGS_EXTRA` and rejects any flag not on the allow-list.
 * Throws a plain `Error` carrying the exact boot-failure message (C-27);
 * `config/env.ts` turns that into a `ConfigError` issue at boot.
 */
export function parseYtdlpArgsExtra(input: string): string[] {
  const tokens = tokenize(input);
  for (const token of tokens) {
    if (isFlagToken(token) && !(ALLOWED_YTDLP_EXTRA_FLAGS as readonly string[]).includes(token)) {
      throw new Error(`YTDLP_ARGS_EXTRA contains a flag that is not allow-listed: ${token}`);
    }
  }
  return tokens;
}
