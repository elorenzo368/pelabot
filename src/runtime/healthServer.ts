import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Config } from "../config/env.js";
import { logEvent, type Logger } from "../utils/logger.js";

/**
 * The code-level last resort when no host-specific port variable is set —
 * a plain local run (`npm run dev`/`npm start` with an empty `.env`).
 */
const DEFAULT_PORT = 3000;

export type PortSource = "SERVER_PORT" | "SERVER_ALLOCATION_PORT" | "PORT" | "default";

export interface PortResolution {
  port: number;
  source: PortSource;
}

type PortConfig = Pick<Config, "port" | "serverPort" | "serverAllocationPort">;
type StartHealthServerConfig = PortConfig & Pick<Config, "serverIp">;

/**
 * Resolves the port to bind, in the order a hosting panel expects:
 * `SERVER_PORT` -> `SERVER_ALLOCATION_PORT` -> `PORT` -> `3000` (D-15).
 *
 * A panel-assigned port is knowable only from the panel's own variable, so
 * those MUST be consulted before the generic `PORT`. Consulting `PORT`
 * first — rev 4's order — combined with a filled-in `PORT=3000` in
 * `.env.example` made the panel's own variable unreachable and left
 * Phase 0.5's exit criterion unsatisfiable: the health server always bound
 * 3000, which the panel never routed to from outside.
 */
export function resolvePort(config: PortConfig): PortResolution {
  if (config.serverPort !== undefined) {
    return { port: config.serverPort, source: "SERVER_PORT" };
  }
  if (config.serverAllocationPort !== undefined) {
    return { port: config.serverAllocationPort, source: "SERVER_ALLOCATION_PORT" };
  }
  if (config.port !== undefined) {
    return { port: config.port, source: "PORT" };
  }
  return { port: DEFAULT_PORT, source: "default" };
}

/** Logs the chosen port and — just as importantly — which variable chose it. */
export function logPortResolution(logger: Logger, resolution: PortResolution): void {
  logEvent(logger, "health_server_port_resolved", {
    port: resolution.port,
    source: resolution.source,
  });
}

export interface HealthPayload {
  status: "ok" | "degraded";
  discord: "connected" | "disconnected";
  activePlayers: number;
  uptime: number;
}

/**
 * Builds the `/health` response body (PRD §28 shape). At this phase (0.5)
 * no Discord client exists yet, so this always reports disconnected/503 —
 * D-14: an endpoint returning 200 while Discord is down is not a health
 * endpoint. `status` becomes `"ok"` only once Phase 1+ wires a real
 * `discord: "connected"` signal in.
 */
export function buildHealthPayload(): HealthPayload {
  return {
    status: "degraded",
    discord: "disconnected",
    activePlayers: 0,
    uptime: process.uptime(),
  };
}

/**
 * `GET /health` -> the payload above, always 503 at this phase. Everything
 * else -> 404. The token-gated `/health/detail` fingerprinting route
 * (C-07) is Phase 7 — not built here.
 */
export function createHealthRequestListener(): RequestListener {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      const payload = buildHealthPayload();
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end();
  };
}

/**
 * Starts the minimal Phase 0.5 health server: resolves and logs the port
 * (D-15), binds `config.serverIp` (defaults to `0.0.0.0`, D-15/D-9), and
 * serves `/health`. This is the only network surface this composition root
 * exposes until Phase 1 adds the Discord client.
 */
export function startHealthServer(config: StartHealthServerConfig, logger: Logger): Server {
  const resolution = resolvePort(config);
  logPortResolution(logger, resolution);

  const server = createServer(createHealthRequestListener());
  server.listen(resolution.port, config.serverIp);

  return server;
}
