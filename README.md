# pela-discord-bot

A Discord bot backend that plays music in a voice channel from Spotify
playlist URLs, YouTube video/playlist URLs, and free-text search. Headless
service — no web UI. See `docs/PRD.md` for the full product spec (Spanish).

## Requirements

- Node.js `>= 20.11` (see `.nvmrc`)
- FFmpeg on the host `PATH` (or set `FFMPEG_PATH`)
- `python3` on the host **only** if you need POT Plan-B rung 2 (script-mode
  plugin) — not required for the default managed mode

## Setup

```bash
npm ci
npm run setup    # materializes the pinned yt-dlp/POT triple — see "Update
                  # procedure" below before this does anything useful
npm run build
npm start
```

For local development: `npm run dev` (runs `src/index.ts` directly via
`tsx`, no build step).

`npm run setup` also runs automatically as `postinstall`. On a fresh clone
it will warn and exit `0` rather than fail — see "Update procedure".

## Environment

Copy `.env.example` to `.env` and fill in the blanks. `DISCORD_TOKEN` and
`DISCORD_CLIENT_ID` are required; everything else either has a sensible
default already filled in, or is required only when the feature it gates
is enabled (e.g. `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` once the
Spotify provider is registered). The bot fails fast at boot with the exact
name of every missing or invalid variable — nothing partially boots.

`PORT`, `SERVER_PORT` and `SERVER_ALLOCATION_PORT` are deliberately blank
in `.env.example`: on a panel host (BisectHosting and similar), the panel
supplies its own port variable, and the health server's resolution order
is `SERVER_PORT` → `SERVER_ALLOCATION_PORT` → `PORT` → `3000`. Filling in
`PORT` on such a host would make the panel's own assignment unreachable.

## Run

```bash
npm start          # after npm run build
npm run dev         # local development, no build step
```

`GET /health` reports `{ status, discord, activePlayers, uptime }` and
returns `503` while Discord is disconnected. `GET /health/detail` (gated by
`HEALTH_DETAIL_TOKEN`, unset ⇒ `404`) adds per-provider diagnostics.

## Invite the bot

```bash
npm run invite:url
```

Prints the OAuth2 invite URL for the bot, scoped to `bot
applications.commands` with exactly these 7 permissions — **never**
Administrator:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Connect
- Speak
- Use Application Commands

(permission bitfield `2150714368`)

## Runbook

### Update procedure

The yt-dlp binary, the POT Node server, and the POT extractor plugin are a
**version-coupled triple** — never update one leg alone, since updating
yt-dlp without its matching POT server/plugin can take token minting down
mid-incident.

```bash
npm run update:ytdlp   # re-pins and verifies all three legs
```

This rewrites `vendor/versions.json`. **Review the diff by hand before
committing** — the pinned hashes are exactly what a later `npm run setup`
trusts. After committing, run `npm run setup` on each host to materialize
the newly pinned bytes.

**Trust posture, stated plainly:**

- Only the yt-dlp leg is checksum-verified against an upstream-published
  list (`SHA2-256SUMS`); the POT server and POT plugin legs are
  trust-on-first-use — upstream publishes no checksums for them, so the
  pin recorded on first acquisition is what every later install is
  verified against.
- The yt-dlp `SHA2-256SUMS` file is itself fetched over the same TLS
  channel and is unsigned, so that leg is TLS trust, not signature trust —
  not a cryptographic guarantee beyond "nobody tampered with this specific
  download."

`vendor/versions.json` ships in this repo with empty placeholder pins.
`npm run setup` recognizes that and exits `0` without installing anything
until a maintainer runs `npm run update:ytdlp` once, reviews the real pins
in the diff, and commits them.

### POT Plan-B ladder

If the managed PO-token provider stops working, escalate in this order:

1. **Managed co-process** (default) — we spawn and supervise the POT
   Node server ourselves.
2. **Script-mode plugin** — a `python3` venv beside the yt-dlp binary.
   Only reachable where `python3` exists on the host.
3. **External provider container** — set `POT_PROVIDER_MODE=external`
   and point `POT_PROVIDER_URL` at a separately run container (Docker
   Compose).
4. **Fallback extractor client** — set `YTDLP_ARGS_EXTRA` to
   `--extractor-args youtube:player_client=<client>`, trying a client
   yt-dlp's current documentation lists as anonymous. **`tv` is NOT
   credential-free** — it requires OAuth device-code authentication.
   **OAuth / account-backed authentication is out of scope for V1** and
   must never be configured here.
5. **A different extraction backend** (ADR-002) — a larger change, only
   if the above are insufficient in practice.

Every flag used above must be on the `YTDLP_ARGS_EXTRA` allow-list
(`--extractor-args`, `--geo-bypass`, `--geo-bypass-country`,
`--geo-bypass-ip-block`, `--proxy`, `--source-address`, `--force-ipv4`,
`--force-ipv6`, `--user-agent`) — anything else fails boot rather than
being silently spawned.

### Troubleshooting

- **Boot fails with `yt-dlp not found`**: run `npm run setup` (after
  `npm run update:ytdlp` has populated real pins at least once).
- **Boot fails with a `POT_PROVIDER_PATH` error**: `npm run setup` did not
  materialize the POT server, or it was installed somewhere other than
  `vendor/bgutil-pot-provider/build/main.js`.
- **`/health` unreachable from outside the host**: check which of
  `SERVER_PORT` / `SERVER_ALLOCATION_PORT` / `PORT` your panel expects —
  the resolution order and the source variable actually used are both
  logged at boot.
