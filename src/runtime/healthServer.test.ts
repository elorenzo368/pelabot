import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../utils/logger.js";
import {
  buildHealthPayload,
  createHealthRequestListener,
  logPortResolution,
  resolvePort,
  startHealthServer,
} from "./healthServer.js";

describe("resolvePort (D-15)", () => {
  it("uses SERVER_PORT when it is the only variable set", () => {
    expect(resolvePort({ serverPort: 4000 })).toEqual({ port: 4000, source: "SERVER_PORT" });
  });

  it("prefers SERVER_PORT over SERVER_ALLOCATION_PORT and PORT when all three are set", () => {
    const result = resolvePort({ serverPort: 4000, serverAllocationPort: 5000, port: 6000 });
    expect(result).toEqual({ port: 4000, source: "SERVER_PORT" });
  });

  it("falls back to SERVER_ALLOCATION_PORT when SERVER_PORT is absent", () => {
    const result = resolvePort({ serverAllocationPort: 5000, port: 6000 });
    expect(result).toEqual({ port: 5000, source: "SERVER_ALLOCATION_PORT" });
  });

  it("falls back to PORT when neither SERVER_PORT nor SERVER_ALLOCATION_PORT is set", () => {
    expect(resolvePort({ port: 8080 })).toEqual({ port: 8080, source: "PORT" });
  });

  it("defaults to 3000 when nothing is set — the plain-local-run fallback only", () => {
    expect(resolvePort({})).toEqual({ port: 3000, source: "default" });
  });
});

describe("logPortResolution", () => {
  it("logs the chosen port and its source variable", () => {
    const info = vi.fn();
    const fakeLogger = { info } as unknown as Logger;

    logPortResolution(fakeLogger, { port: 4000, source: "SERVER_PORT" });

    expect(info).toHaveBeenCalledTimes(1);
    const [payload] = info.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      event: "health_server_port_resolved",
      port: 4000,
      source: "SERVER_PORT",
    });
  });
});

describe("buildHealthPayload (D-14)", () => {
  it("always reports Discord disconnected and zero active players at this phase", () => {
    const payload = buildHealthPayload();
    expect(payload.status).toBe("degraded");
    expect(payload.discord).toBe("disconnected");
    expect(payload.activePlayers).toBe(0);
    expect(typeof payload.uptime).toBe("number");
  });
});

describe("createHealthRequestListener", () => {
  interface FakeResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    writeHead(status: number, headers?: Record<string, string>): void;
    end(chunk?: string): void;
  }

  function fakeResponse(): FakeResponse {
    return {
      statusCode: 0,
      headers: {},
      body: "",
      writeHead(status, headers) {
        this.statusCode = status;
        if (headers) this.headers = headers;
      },
      end(chunk) {
        this.body = chunk ?? "";
      },
    };
  }

  function fakeRequest(method: string, url: string): IncomingMessage {
    return { method, url } as unknown as IncomingMessage;
  }

  it("responds 503 with the health payload on GET /health — Discord never connects at this phase", () => {
    const listener = createHealthRequestListener();
    const res = fakeResponse();

    listener(fakeRequest("GET", "/health"), res as unknown as ServerResponse);

    expect(res.statusCode).toBe(503);
    expect(res.headers["Content-Type"]).toBe("application/json");
    const parsed = JSON.parse(res.body) as Record<string, unknown>;
    expect(parsed).toMatchObject({ status: "degraded", discord: "disconnected", activePlayers: 0 });
  });

  it("responds 404 for any other route", () => {
    const listener = createHealthRequestListener();
    const res = fakeResponse();

    listener(fakeRequest("GET", "/health/detail"), res as unknown as ServerResponse);

    expect(res.statusCode).toBe(404);
  });

  it("responds 404 for a non-GET method on /health", () => {
    const listener = createHealthRequestListener();
    const res = fakeResponse();

    listener(fakeRequest("POST", "/health"), res as unknown as ServerResponse);

    expect(res.statusCode).toBe(404);
  });
});

describe("startHealthServer", () => {
  it("binds the resolved port on the configured host and answers /health over a real socket", async () => {
    const info = vi.fn();
    const fakeLogger = { info } as unknown as Logger;

    // port: 0 asks the OS for an ephemeral free port — never a real deploy
    // port, purely local loopback, so this stays a fast, isolated unit test.
    const server = startHealthServer({ port: 0, serverIp: "127.0.0.1" }, fakeLogger);

    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the server to report a bound { port }, not a pipe/named address");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ status: "degraded", discord: "disconnected" });
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ event: "health_server_port_resolved", source: "PORT" }),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
