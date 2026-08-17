import { Events } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../utils/logger.js";

const routeInteraction = vi.fn().mockResolvedValue(undefined);
vi.mock("../commands/router.js", () => ({ routeInteraction }));

const { registerInteractionCreateHandler } = await import("./interactionCreate.event.js");

function fakeLogger(): Logger {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe("registerInteractionCreateHandler", () => {
  it("subscribes routeInteraction to Client#interactionCreate", () => {
    const on = vi.fn();
    const fakeClient = { on };

    registerInteractionCreateHandler(fakeClient as never, fakeLogger());

    expect(on).toHaveBeenCalledTimes(1);
    const [event, listener] = on.mock.calls[0] as [string, (...args: unknown[]) => unknown];
    expect(event).toBe(Events.InteractionCreate);
    expect(typeof listener).toBe("function");
  });

  it("forwards the interaction and logger to routeInteraction", async () => {
    vi.clearAllMocks();
    const on = vi.fn();
    const fakeClient = { on };
    const logger = fakeLogger();

    registerInteractionCreateHandler(fakeClient as never, logger);
    const [, listener] = on.mock.calls[0] as [string, (interaction: unknown) => unknown];

    const fakeInteraction = { id: "interaction-1" };
    await listener(fakeInteraction);

    expect(routeInteraction).toHaveBeenCalledWith(fakeInteraction, logger);
  });

  it("logs rather than throws when routeInteraction rejects", async () => {
    vi.clearAllMocks();
    routeInteraction.mockRejectedValueOnce(new Error("boom"));
    const on = vi.fn();
    const fakeClient = { on };
    const logger = fakeLogger();

    registerInteractionCreateHandler(fakeClient as never, logger);
    const [, listener] = on.mock.calls[0] as [string, (interaction: unknown) => unknown];

    await listener({ id: "interaction-2" });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "interaction_handler_error" }),
      expect.any(String),
    );
  });
});
