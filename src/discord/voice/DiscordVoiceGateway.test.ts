import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { AudioPlayerStatus, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import { describe, expect, it, vi } from "vitest";
import type { AudioSource, VoiceEventMap } from "../../music/VoiceGateway.js";
import { DiscordVoiceGateway, type DiscordVoiceGatewayDeps } from "./DiscordVoiceGateway.js";

class FakeConnection extends EventEmitter {
  state: { status: VoiceConnectionStatus } = { status: VoiceConnectionStatus.Signalling };
  subscribe = vi.fn();
  destroy = vi.fn();

  setReady(): void {
    this.state = { status: VoiceConnectionStatus.Ready };
    this.emit(VoiceConnectionStatus.Ready);
  }
}

class FakePlayer extends EventEmitter {
  state: { status: AudioPlayerStatus } = { status: AudioPlayerStatus.Idle };
  play = vi.fn();
  pause = vi.fn();
  unpause = vi.fn();

  setPlaying(): void {
    this.state = { status: AudioPlayerStatus.Playing };
    this.emit(AudioPlayerStatus.Playing);
  }
}

function fakeAudioSource(): AudioSource {
  return {
    stream: Readable.from([]),
    hint: "opus",
    metadata: { provider: "test", extractedAt: new Date() },
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function buildDeps(overrides: Partial<DiscordVoiceGatewayDeps> = {}): {
  deps: DiscordVoiceGatewayDeps;
  connection: FakeConnection;
  player: FakePlayer;
} {
  const connection = new FakeConnection();
  const player = new FakePlayer();

  const deps: DiscordVoiceGatewayDeps = {
    joinChannel: vi.fn().mockReturnValue(connection),
    createAudioPlayer: vi.fn().mockReturnValue(player),
    demuxProbe: vi.fn().mockResolvedValue({ stream: Readable.from([]), type: "opus" }),
    createAudioResource: vi.fn().mockReturnValue({ playStream: { destroy: vi.fn() } }),
    entersState,
    voiceJoinTimeoutMs: 1000,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
    ...overrides,
  };

  return { deps, connection, player };
}

describe("DiscordVoiceGateway.join (C-01, join half)", () => {
  it("calls connection.subscribe(player) once per Ready, repeated across reconnects", async () => {
    const { deps, connection } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);

    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;

    expect(connection.subscribe).toHaveBeenCalledTimes(1);

    // Simulate a reconnect: the connection re-enters Ready a second time.
    connection.setReady();
    expect(connection.subscribe).toHaveBeenCalledTimes(2);
  });

  it("rejects at voiceJoinTimeoutMs when Ready never arrives, and destroys the connection", async () => {
    const { deps, connection } = buildDeps({ voiceJoinTimeoutMs: 20 });
    const gateway = new DiscordVoiceGateway(deps);

    await expect(gateway.join("guild-1", "channel-1")).rejects.toBeTruthy();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("DiscordVoiceGateway.leave", () => {
  it("destroys the connection for a joined guild", async () => {
    const { deps, connection } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;

    await gateway.leave("guild-1");

    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for a guild with no active session", async () => {
    const { deps } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);

    await expect(gateway.leave("never-joined")).resolves.toBeUndefined();
  });
});

describe("DiscordVoiceGateway.play (Phase 1 stub)", () => {
  async function joinedGateway() {
    const { deps, connection, player } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;
    return { gateway, deps, connection, player };
  }

  it("probes the source, creates a resource, and plays it", async () => {
    const { gateway, deps, player } = await joinedGateway();
    const source = fakeAudioSource();
    const controller = new AbortController();

    const playPromise = gateway.play("guild-1", source, 0, { signal: controller.signal });
    player.setPlaying();
    await playPromise;

    expect(deps.demuxProbe).toHaveBeenCalledWith(source.stream);
    expect(deps.createAudioResource).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("pauses immediately after Playing when opts.startPaused is true", async () => {
    const { gateway, player } = await joinedGateway();
    const source = fakeAudioSource();
    const controller = new AbortController();

    const playPromise = gateway.play("guild-1", source, 0, {
      signal: controller.signal,
      startPaused: true,
    });
    player.setPlaying();
    await playPromise;

    expect(player.pause).toHaveBeenCalledTimes(1);
  });

  it("throws when no session exists for the guild", async () => {
    const { deps } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const controller = new AbortController();

    await expect(
      gateway.play("never-joined", fakeAudioSource(), 0, { signal: controller.signal }),
    ).rejects.toThrow(/no active connection/i);
  });
});

describe("DiscordVoiceGateway.pause/resume/stop", () => {
  it("pause() calls player.pause()", async () => {
    const { deps, connection, player } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;

    gateway.pause("guild-1");
    expect(player.pause).toHaveBeenCalledTimes(1);
  });

  it("resume() calls player.unpause() exactly once (C-02)", async () => {
    const { deps, connection, player } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;

    gateway.resume("guild-1");
    expect(player.unpause).toHaveBeenCalledTimes(1);
  });

  it("stop() destroys the current AudioResource's playStream", async () => {
    const { deps, connection, player } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;

    const destroyStream = vi.fn();
    (deps.createAudioResource as ReturnType<typeof vi.fn>).mockReturnValue({
      playStream: { destroy: destroyStream },
    });

    const source = fakeAudioSource();
    const controller = new AbortController();
    const playPromise = gateway.play("guild-1", source, 0, { signal: controller.signal });
    player.setPlaying();
    await playPromise;

    gateway.stop("guild-1");
    expect(destroyStream).toHaveBeenCalledTimes(1);
  });

  it("pause/resume/stop are no-ops for a guild with no active session", () => {
    const { deps } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);

    expect(() => gateway.pause("never-joined")).not.toThrow();
    expect(() => gateway.resume("never-joined")).not.toThrow();
    expect(() => gateway.stop("never-joined")).not.toThrow();
  });
});

describe("DiscordVoiceGateway error events", () => {
  async function joinedGateway() {
    const { deps, connection, player } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const errors: VoiceEventMap["error"][] = [];
    gateway.on("error", (payload) => errors.push(payload));

    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;

    return { gateway, deps, connection, player, errors };
  }

  it("does not throw, logs, and re-emits when the connection emits 'error'", async () => {
    const { deps, connection, errors } = await joinedGateway();
    const failure = new Error("networking blew up");

    expect(() => connection.emit("error", failure)).not.toThrow();

    expect(errors).toEqual([{ guildId: "guild-1", generation: 0, error: failure }]);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice_connection_error",
        guildId: "guild-1",
        generation: 0,
      }),
    );
  });

  it("does not throw, logs, and re-emits when the player emits 'error'", async () => {
    const { deps, player, errors } = await joinedGateway();
    const failure = new Error("stream blew up");

    expect(() => player.emit("error", failure)).not.toThrow();

    expect(errors).toEqual([{ guildId: "guild-1", generation: 0, error: failure }]);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "voice_player_error", guildId: "guild-1", generation: 0 }),
    );
  });

  it("normalizes a non-Error 'error' payload into an Error", async () => {
    const { connection, errors } = await joinedGateway();

    expect(() => connection.emit("error", "just a string")).not.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect(errors[0]?.error.message).toContain("just a string");
  });
});

describe("DiscordVoiceGateway.on", () => {
  it("emits 'ready' with an incrementing generation on every Ready, including reconnects", async () => {
    const { deps, connection } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const readyEvents: unknown[] = [];
    gateway.on("ready", (payload) => readyEvents.push(payload));

    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;
    connection.setReady();

    expect(readyEvents).toEqual([
      { guildId: "guild-1", channelId: "channel-1", generation: 0, reconnect: false },
      { guildId: "guild-1", channelId: "channel-1", generation: 1, reconnect: true },
    ]);
  });

  it("returns an unsubscribe function that stops further delivery", async () => {
    const { deps, connection } = buildDeps();
    const gateway = new DiscordVoiceGateway(deps);
    const handler = vi.fn();
    const unsubscribe = gateway.on("ready", handler);

    const joinPromise = gateway.join("guild-1", "channel-1");
    connection.setReady();
    await joinPromise;
    unsubscribe();
    connection.setReady();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
