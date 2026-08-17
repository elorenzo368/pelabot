import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { NOT_YET_IMPLEMENTED } from "../ui/messages.es.js";
import { handleLoop } from "./loop.command.js";
import { handlePause } from "./pause.command.js";
import { handlePlay } from "./play.command.js";
import { handleQueue } from "./queue.command.js";
import { handleResume } from "./resume.command.js";
import { handleShuffle } from "./shuffle.command.js";
import { handleSkip } from "./skip.command.js";
import { handleStop } from "./stop.command.js";

/**
 * `router.test.ts` mocks every handler away to prove dispatch, so nothing
 * exercised the handler bodies themselves. These cover the other half: the
 * Phase 1 skeletons must all ack ephemerally with the ONE placeholder line
 * from `ui/messages.es.ts`, and `/play` must read its registered option.
 */
function fakeInteraction(): {
  interaction: ChatInputCommandInteraction;
  reply: ReturnType<typeof vi.fn>;
  getString: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn().mockResolvedValue(undefined);
  const getString = vi.fn().mockReturnValue("never mind me");

  return {
    interaction: { reply, options: { getString } } as unknown as ChatInputCommandInteraction,
    reply,
    getString,
  };
}

describe("V1 command handler skeletons", () => {
  it.each([
    ["play", handlePlay],
    ["pause", handlePause],
    ["resume", handleResume],
    ["skip", handleSkip],
    ["stop", handleStop],
    ["queue", handleQueue],
    ["shuffle", handleShuffle],
    ["loop", handleLoop],
  ] as const)("/%s acks ephemerally with the placeholder copy", async (_commandName, handler) => {
    const { interaction, reply } = fakeInteraction();

    await handler(interaction);

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({ content: NOT_YET_IMPLEMENTED, ephemeral: true });
  });

  it("/play reads its required `input` option, proving the registered shape end-to-end", async () => {
    const { interaction, getString, reply } = fakeInteraction();

    await handlePlay(interaction);

    expect(getString).toHaveBeenCalledWith("input", true);
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
