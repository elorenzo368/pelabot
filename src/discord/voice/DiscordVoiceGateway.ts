import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type AudioResource,
  type VoiceConnection,
} from "@discordjs/voice";
import type { Client } from "discord.js";
import type {
  AudioSource,
  Unsubscribe,
  VoiceEventMap,
  VoiceGateway,
} from "../../music/VoiceGateway.js";
import { logEvent, type Logger } from "../../utils/logger.js";

/**
 * Produces a live `VoiceConnection` for `(guildId, channelId)`. Kept out of
 * `DiscordVoiceGateway`'s own body so `join()`/`play()` stay unit-testable
 * against a fake connection (design-part3 C-01 verify) without touching a
 * real discord.js `Client` or real UDP/WebSocket transport.
 */
export type JoinChannelFn = (guildId: string, channelId: string) => VoiceConnection;

/**
 * Builds the real {@link JoinChannelFn} from a live discord.js `Client` —
 * resolves the target guild's `voiceAdapterCreator` and calls the real
 * `joinVoiceChannel`. Production wiring only; not used by unit tests.
 */
export function createJoinChannelFn(client: Client): JoinChannelFn {
  return (guildId, channelId) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild === undefined) {
      throw new Error(`DiscordVoiceGateway: guild not cached: ${guildId}`);
    }
    return joinVoiceChannel({
      guildId,
      channelId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
  };
}

interface GuildVoiceState {
  connection: VoiceConnection;
  player: AudioPlayer;
  channelId: string;
  generation: number;
  resource: AudioResource | undefined;
  /**
   * Removes every listener `join()` registered for THIS session. Assigned
   * right after registration (the handlers close over `state`, so the
   * object has to exist first) and never called twice for one session.
   */
  detachListeners: Unsubscribe;
}

export interface DiscordVoiceGatewayDeps {
  joinChannel: JoinChannelFn;
  createAudioPlayer: typeof createAudioPlayer;
  demuxProbe: typeof demuxProbe;
  createAudioResource: typeof createAudioResource;
  entersState: typeof entersState;
  voiceJoinTimeoutMs: number;
  logger: Logger;
}

/** Builds the real (non-test) dependency set from a live discord.js `Client`. */
export function createDiscordVoiceGatewayDeps(
  client: Client,
  voiceJoinTimeoutMs: number,
  logger: Logger,
): DiscordVoiceGatewayDeps {
  return {
    joinChannel: createJoinChannelFn(client),
    createAudioPlayer,
    demuxProbe,
    createAudioResource,
    entersState,
    voiceJoinTimeoutMs,
    logger,
  };
}

type Listener<E extends keyof VoiceEventMap> = (payload: VoiceEventMap[E]) => void;

/**
 * `EventEmitter#emit("error", …)` can carry ANY value, so the port's
 * `error` payload — which promises a real `Error` — has to normalize
 * whatever @discordjs/voice hands us.
 */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * `VoiceGateway` port implementation (ADR-007), a thin @discordjs/voice
 * wrapper. `play()` here is the Phase 1 stub: steps 2-4 of design-part6 §5
 * (`demuxProbe` -> `createAudioResource` -> `player.play` -> `entersState`,
 * sharing `opts.signal` with the wait). The composite
 * `PLAY_START_TIMEOUT_MS`/generation-guard/dispose-ordering machinery
 * Phase 2b adds (`C-25`) is NOT here yet — this only needs to play a
 * bundled local ogg for the Phase 1 exit criterion (design-part5 §B).
 * Reconnect/backoff/disconnect-kind computation (Part 7 §10) are Phase 7.
 */
export class DiscordVoiceGateway implements VoiceGateway {
  private readonly states = new Map<string, GuildVoiceState>();
  private readonly listeners = new Map<keyof VoiceEventMap, Set<Listener<never>>>();

  constructor(private readonly deps: DiscordVoiceGatewayDeps) {}

  async join(guildId: string, channelId: string): Promise<void> {
    const existing = this.states.get(guildId);
    const connection = this.deps.joinChannel(guildId, channelId);

    // Idempotent re-join. `joinVoiceChannel` hands back the SAME
    // `VoiceConnection` for a guild that is already tracked and not
    // destroyed, and leaves it in whatever state it was — a Ready connection
    // stays Ready and never emits a second Ready. Registering again on that
    // one emitter would (a) stack a duplicate Ready handler, so every later
    // reconnect fired N subscribes and N `ready` events carrying stale
    // generations, and (b) strand a brand-new `AudioPlayer` that nothing
    // ever subscribes. So reuse the live session and just retarget it.
    if (existing !== undefined && existing.connection === connection) {
      existing.channelId = channelId;
      await this.enterReady(guildId, connection);
      return;
    }

    // Different connection: the tracked one is gone (destroyed/replaced), so
    // its registration is stale. Drop it before building the new session —
    // never `destroy()` it, that throws on an already-destroyed connection.
    if (existing !== undefined) {
      this.disposeSession(guildId, existing);
      this.states.delete(guildId);
    }

    const player = this.deps.createAudioPlayer();
    const state: GuildVoiceState = {
      connection,
      player,
      channelId,
      generation: -1,
      resource: undefined,
      detachListeners: () => {},
    };
    this.states.set(guildId, state);

    // C-01: subscribe on EVERY Ready, reconnects included — a missing
    // subscribe presents as a permanent AudioPlayerStatus.AutoPaused hang,
    // never as an error anywhere.
    const onReady = (): void => {
      connection.subscribe(player);
      state.generation += 1;
      this.emit("ready", {
        guildId,
        channelId: state.channelId,
        generation: state.generation,
        reconnect: state.generation > 0,
      });
    };

    // Both `VoiceConnection` and `AudioPlayer` are plain EventEmitters, and
    // both emit "error" (onNetworkingError / onStreamError). An "error" with
    // ZERO listeners is re-thrown by EventEmitter itself and takes the whole
    // process down — every other guild's session and the health server with
    // it. These two listeners are what keeps a single guild's failure a
    // single guild's failure, and they feed the port's declared `error`
    // event so downstream consumers can actually react.
    const onConnectionError = (error: unknown): void => {
      this.reportError("voice_connection_error", guildId, state, error);
    };
    const onPlayerError = (error: unknown): void => {
      this.reportError("voice_player_error", guildId, state, error);
    };

    connection.on(VoiceConnectionStatus.Ready, onReady);
    connection.on("error", onConnectionError);
    player.on("error", onPlayerError);
    state.detachListeners = () => {
      connection.off(VoiceConnectionStatus.Ready, onReady);
      connection.off("error", onConnectionError);
      player.off("error", onPlayerError);
    };

    await this.enterReady(guildId, connection);
  }

  /**
   * Waits out `VOICE_JOIN_TIMEOUT_MS` for Ready, tearing the whole session
   * down on failure so a half-open join never leaves a tracked state behind.
   */
  private async enterReady(guildId: string, connection: VoiceConnection): Promise<void> {
    try {
      await this.deps.entersState(
        connection,
        VoiceConnectionStatus.Ready,
        this.deps.voiceJoinTimeoutMs,
      );
    } catch (error) {
      await this.leave(guildId);
      throw error;
    }
  }

  // No `await` in this body by design — leave() has nothing to wait on
  // (connection.destroy() is synchronous); Promise<void> is the port's
  // contract shape (VoiceGateway), not a hint that this does real I/O.
  leave(guildId: string): Promise<void> {
    const state = this.states.get(guildId);
    if (state === undefined) return Promise.resolve();
    this.disposeSession(guildId, state);
    state.connection.destroy();
    this.states.delete(guildId);
    return Promise.resolve();
  }

  /**
   * Unwinds everything `join()` attached for a session EXCEPT the connection
   * itself (a stale session's connection is already destroyed, and
   * `destroy()` throws when called twice).
   *
   * `connection.destroy()` on its own deregisters NOTHING on the player
   * side: the player stays in @discordjs/voice's global 20ms audio cycle
   * (its own `checkPlayable()` never notices the connection is gone) and the
   * upstream extractor process is never told to die.
   */
  private disposeSession(guildId: string, state: GuildVoiceState): void {
    state.detachListeners();
    state.player.stop(true);
    // Reuse stop()'s stream teardown rather than duplicating it.
    this.stop(guildId);
  }

  async play(
    guildId: string,
    source: AudioSource,
    _generation: number,
    opts: { signal: AbortSignal; startPaused?: boolean },
  ): Promise<void> {
    const state = this.states.get(guildId);
    if (state === undefined) {
      throw new Error(`DiscordVoiceGateway.play: no active connection for guild ${guildId}`);
    }

    const probe = await this.deps.demuxProbe(source.stream);
    const resource = this.deps.createAudioResource(probe.stream, { inputType: probe.type });
    state.resource = resource;

    state.player.play(resource);
    await this.deps.entersState(state.player, AudioPlayerStatus.Playing, opts.signal);

    if (opts.startPaused === true) {
      state.player.pause();
    }
  }

  pause(guildId: string): void {
    this.states.get(guildId)?.player.pause();
  }

  /** C-02: unpause on resume. */
  resume(guildId: string): void {
    this.states.get(guildId)?.player.unpause();
  }

  stop(guildId: string): void {
    this.states.get(guildId)?.resource?.playStream.destroy();
  }

  on<E extends keyof VoiceEventMap>(event: E, handler: Listener<E>): Unsubscribe {
    const set = (this.listeners.get(event) ?? new Set()) as Set<Listener<E>>;
    set.add(handler);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler);
    };
  }

  /** Logs a voice-layer failure under `event` and republishes it on the port. */
  private reportError(
    event: "voice_connection_error" | "voice_player_error",
    guildId: string,
    state: GuildVoiceState,
    raw: unknown,
  ): void {
    const error = toError(raw);
    logEvent(
      this.deps.logger,
      event,
      { guildId, generation: state.generation, error: error.message },
      "error",
    );
    this.emit("error", { guildId, generation: state.generation, error });
  }

  private emit<E extends keyof VoiceEventMap>(event: E, payload: VoiceEventMap[E]): void {
    const set = this.listeners.get(event) as Set<Listener<E>> | undefined;
    if (set === undefined) return;
    for (const listener of set) {
      // Per-listener isolation: without it one throwing subscriber aborts
      // delivery to every other listener AND propagates synchronously back
      // into the discord.js internals that emitted the underlying event.
      try {
        listener(payload);
      } catch (raw) {
        logEvent(
          this.deps.logger,
          "voice_listener_failed",
          {
            voiceEvent: event,
            guildId: payload.guildId,
            error: toError(raw).message,
          },
          "error",
        );
      }
    }
  }
}
