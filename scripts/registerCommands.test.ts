import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Routes } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_DEFINITIONS,
  registerCommands,
  type RegisterCommandsDeps,
} from "./registerCommands.js";

function fakeDeps(): RegisterCommandsDeps & { rest: { put: ReturnType<typeof vi.fn> } } {
  return {
    rest: { put: vi.fn().mockResolvedValue(undefined) },
    logger: { warn: vi.fn() },
  };
}

describe("registerCommands (D-6)", () => {
  it("PUTs the full 8-command array to the global route when DISCORD_GUILD_ID is unset", async () => {
    const deps = fakeDeps();
    await registerCommands({ DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "client-1" }, deps);

    expect(deps.rest.put).toHaveBeenCalledTimes(1);
    const [route, options] = deps.rest.put.mock.calls[0] as [string, { body: unknown[] }];
    expect(route).toBe(Routes.applicationCommands("client-1"));
    expect(options.body).toHaveLength(COMMAND_DEFINITIONS.length);
    expect(options.body).toHaveLength(8);
  });

  it("PUTs to the guild-scoped route and logs a warn when DISCORD_GUILD_ID is set (D-32 dev fast path)", async () => {
    const deps = fakeDeps();
    await registerCommands(
      { DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "client-1", DISCORD_GUILD_ID: "guild-9" },
      deps,
    );

    const [route] = deps.rest.put.mock.calls[0] as [string, unknown];
    expect(route).toBe(Routes.applicationGuildCommands("client-1", "guild-9"));
    expect(deps.logger?.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "command_registration", scope: "guild" }),
    );
  });

  it("registers exactly the 8 V1 commands and never /volume (spec: Command Surface)", () => {
    const names = COMMAND_DEFINITIONS.map((command) => command.toJSON().name).sort();
    expect(names).toEqual(
      ["loop", "pause", "play", "queue", "resume", "shuffle", "skip", "stop"].sort(),
    );
    expect(names).not.toContain("volume");
  });

  it("throws a named error when DISCORD_TOKEN is missing", async () => {
    const deps = fakeDeps();
    await expect(registerCommands({ DISCORD_CLIENT_ID: "client-1" }, deps)).rejects.toThrow(
      "Missing environment variable: DISCORD_TOKEN",
    );
  });

  it("throws a named error when DISCORD_CLIENT_ID is missing", async () => {
    const deps = fakeDeps();
    await expect(registerCommands({ DISCORD_TOKEN: "t" }, deps)).rejects.toThrow(
      "Missing environment variable: DISCORD_CLIENT_ID",
    );
  });
});

describe("static check: DISCORD_GUILD_ID (D-32)", () => {
  function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const fullPath = `${dir}/${entry}`;
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        files.push(...collectTsFiles(fullPath));
      } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it("is never read anywhere under src/ — only this script (outside the bot process) may read it", () => {
    const srcDir = fileURLToPath(new URL("../src", import.meta.url));
    const offenders = collectTsFiles(srcDir).filter((file) =>
      readFileSync(file, "utf-8").includes("DISCORD_GUILD_ID"),
    );
    expect(offenders).toEqual([]);
  });
});
