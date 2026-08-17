import type { ChatInputCommandInteraction, Interaction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../utils/logger.js";

const handlePlay = vi.fn();
const handlePause = vi.fn();
const handleResume = vi.fn();
const handleSkip = vi.fn();
const handleStop = vi.fn();
const handleQueue = vi.fn();
const handleShuffle = vi.fn();
const handleLoop = vi.fn();

vi.mock("./play.command.js", () => ({ handlePlay }));
vi.mock("./pause.command.js", () => ({ handlePause }));
vi.mock("./resume.command.js", () => ({ handleResume }));
vi.mock("./skip.command.js", () => ({ handleSkip }));
vi.mock("./stop.command.js", () => ({ handleStop }));
vi.mock("./queue.command.js", () => ({ handleQueue }));
vi.mock("./shuffle.command.js", () => ({ handleShuffle }));
vi.mock("./loop.command.js", () => ({ handleLoop }));

const { routeInteraction } = await import("./router.js");

function fakeLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function fakeChatInputInteraction(commandName: string): ChatInputCommandInteraction {
  return {
    isChatInputCommand: () => true,
    commandName,
  } as unknown as ChatInputCommandInteraction;
}

function fakeNonChatInputInteraction(): Interaction {
  return { isChatInputCommand: () => false } as unknown as Interaction;
}

describe("routeInteraction", () => {
  it.each([
    ["play", handlePlay],
    ["pause", handlePause],
    ["resume", handleResume],
    ["skip", handleSkip],
    ["stop", handleStop],
    ["queue", handleQueue],
    ["shuffle", handleShuffle],
    ["loop", handleLoop],
  ] as const)("routes /%s to its own handler exactly", async (commandName, handler) => {
    vi.clearAllMocks();
    const interaction = fakeChatInputInteraction(commandName);
    await routeInteraction(interaction, fakeLogger());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(interaction);
  });

  it("ignores non-chat-input interactions (buttons, autocomplete, modals — none exist in V1)", async () => {
    vi.clearAllMocks();
    await routeInteraction(fakeNonChatInputInteraction(), fakeLogger());

    for (const handler of [
      handlePlay,
      handlePause,
      handleResume,
      handleSkip,
      handleStop,
      handleQueue,
      handleShuffle,
      handleLoop,
    ]) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("logs a warning and does not throw for an unregistered command name", async () => {
    vi.clearAllMocks();
    const logger = fakeLogger();
    const interaction = fakeChatInputInteraction("volume");

    await expect(routeInteraction(interaction, logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "unknown_command", commandName: "volume" }),
    );
  });
});
