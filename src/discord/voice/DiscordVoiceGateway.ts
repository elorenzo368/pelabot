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
    const connection = this.deps.joinChannel(guildId, channelId);
    const player = this.deps.createAudioPlayer();
    const state: GuildVoiceState = {
      connection,
      player,
      channelId,
      generation: -1,
      resource: undefined,
    };
    this.states.set(guildId, state);

    // C-01: subscribe on EVERY Ready, reconnects included — a missing
    // subscribe presents as a permanent AudioPlayerStatus.AutoPaused hang,
    // never as an error anywhere.
    connection.on(VoiceConnectionStatus.Ready, () => {
      connection.subscribe(player);
      state.generation += 1;
      this.emit("ready", {
        guildId,
        channelId: state.channelId,
        generation: state.generation,
        reconnect: state.generation > 0,
      });
    });

    // Both `VoiceConnection` and `AudioPlayer` are plain EventEmitters, and
    // both emit "error" (onNetworkingError / onStreamError). An "error" with
    // ZERO listeners is re-thrown by EventEmitter itself and takes the whole
    // process down — every other guild's session and the health server with
    // it. These two listeners are what keeps a single guild's failure a
    // single guild's failure, and they feed the port's declared `error`
    // event so downstream consumers can actually react.
    connection.on("error", (error) => {
      this.reportError("voice_connection_error", guildId, state, error);
    });
    player.on("error", (error) => {
      this.reportError("voice_player_error", guildId, state, error);
    });

    try {
      await this.deps.entersState(
        connection,
        VoiceConnectionStatus.Ready,
        this.deps.voiceJoinTimeoutMs,
      );
    } catch (error) {
      connection.destroy();
      this.states.delete(guildId);
      throw error;
    }
  }

  // No `await` in this body by design — leave() has nothing to wait on
  // (connection.destroy() is synchronous); Promise<void> is the port's
  // contract shape (VoiceGateway), not a hint that this does real I/O.
  leave(guildId: string): Promise<void> {
    const state = this.states.get(guildId);
    if (state === undefined) return Promise.resolve();
    state.connection.destroy();
    this.states.delete(guildId);
    return Promise.resolve();
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
      listener(payload);
    }
  }
}
