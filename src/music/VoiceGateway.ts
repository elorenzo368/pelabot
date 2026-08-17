import type { Readable } from "node:stream";

/**
 * `VoiceGateway` port (ADR-007, design-part6 §5) — the domain's only way to
 * drive Discord voice playback. `music/` depends on this interface alone;
 * `src/discord/voice/DiscordVoiceGateway.ts` is the sole implementation and
 * the only place `@discordjs/voice` may be imported — the ESLint
 * `no-restricted-imports` rule scoped to `src/music/**` (ADR-010) enforces
 * this as a lint failure, not a review convention.
 */

export type Unsubscribe = () => void;

export type VoiceDisconnectKind = "dropped" | "moved" | "kicked";

/**
 * Minimal shape a resolved audio stream must carry to reach `play()`. This
 * is the field `play()`'s signature needs starting Phase 1; the FULL
 * `AudioProvider` port (taxonomy, `resolve()`, circuits) that PRODUCES real
 * `AudioSource` values is Phase 2b's `music/providers/audio/AudioProvider.ts`
 * (design-part6 §D) — it imports this same shape rather than redeclaring
 * it, so there is exactly one definition, never two competing ones.
 */
export interface AudioSource {
  stream: Readable;
  hint: "opus" | "arbitrary";
  metadata: { provider: string; sourceUrl?: string; extractedAt: Date };
  /** MUST kill the underlying process tree; idempotent. */
  dispose(): Promise<void>;
}

export interface VoiceEventMap {
  ready: { guildId: string; generation: number; channelId: string; reconnect: boolean };
  trackEnd: { guildId: string; generation: number };
  disconnected: {
    guildId: string;
    generation: number;
    kind: VoiceDisconnectKind;
    closeCode?: number;
    newChannelId?: string;
  };
  reconnectFailed: { guildId: string; attempts: number };
  error: { guildId: string; generation: number; error: Error };
}

/**
 * Thin @discordjs/voice wrapper (ADR-007). Phase 1 implements `join()` in
 * full — including the `VOICE_JOIN_TIMEOUT_MS` reject and the
 * on-every-`Ready` subscribe (`C-01`) — and a `play()` stub sufficient for
 * a bundled local ogg (design-part5 §B Phase 1 exit criterion). The
 * composite start deadline, generation-guarded staleness handling and
 * reconnect ladder are Phase 2b/7 (design-part6 §5).
 */
export interface VoiceGateway {
  /**
   * Rejects at `VOICE_JOIN_TIMEOUT_MS` if the connection never reaches Ready.
   *
   * Idempotent per guild: calling it again for a guild that already has a
   * live session RETARGETS that session at `channelId` and reuses its
   * connection, player and event registration — it never stands up a second
   * one. Exactly one live handler set exists per guild at any time, so a
   * reconnect always produces exactly one `ready` event with one monotonic
   * generation. A guild whose tracked connection has since been destroyed or
   * replaced gets its stale session torn down first, then a fresh one.
   */
  join(guildId: string, channelId: string): Promise<void>;
  leave(guildId: string): Promise<void>;
  play(
    guildId: string,
    source: AudioSource,
    generation: number,
    opts: { signal: AbortSignal; startPaused?: boolean },
  ): Promise<void>;
  pause(guildId: string): void;
  /** Calls `player.unpause()` (C-02). */
  resume(guildId: string): void;
  /** Destroys the current `AudioResource`'s `playStream`. */
  stop(guildId: string): void;
  on<E extends keyof VoiceEventMap>(
    event: E,
    handler: (payload: VoiceEventMap[E]) => void,
  ): Unsubscribe;
}
