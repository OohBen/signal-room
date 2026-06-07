import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { GatewayRuntimeEnv } from "../config/env.js";
import { DEFAULT_NO_SPEECH_POLICY } from "../realtime/router.js";

export interface HealthPayload {
  ok: true;
  service: "signal-room-gateway";
  env: {
    aiEnvFound: boolean;
    loadedNames: string[];
    skippedNames: string[];
    hasOpenAiApiKey: boolean;
    hasExaApiKey: boolean;
    hasOpenRouterApiKey: boolean;
  };
  realtimeRouter: {
    policy: typeof DEFAULT_NO_SPEECH_POLICY;
    audioMode: "openai_realtime";
  };
}

export interface HealthServerOptions {
  host?: string;
  port?: number;
  runtimeEnv: GatewayRuntimeEnv;
  replayTranscript?: (request: ReplayTranscriptRequest) => Promise<unknown>;
  workRoom?: (request: WorkRoomRequest) => Promise<unknown>;
  fleet?: (request: FleetRequest) => Promise<unknown>;
  ask?: (request: AskRequest) => Promise<unknown>;
  realtimeToken?: () => Promise<unknown>;
}

export interface ReplayTranscriptRequest {
  roomCode: string;
  displayName?: string;
  delayMs?: number;
  database?: string;
  transcript: string;
}

export interface WorkRoomRequest {
  roomCode: string;
  database?: string;
  maxTasks?: number;
  workerCount?: number;
}

export interface FleetRequest {
  roomCode: string;
  database?: string;
}

export interface AskRequest {
  roomCode: string;
  question: string;
  database?: string;
}

export function buildHealthPayload(runtimeEnv: GatewayRuntimeEnv): HealthPayload {
  return {
    ok: true,
    service: "signal-room-gateway",
    env: {
      aiEnvFound: runtimeEnv.envFile.found,
      loadedNames: runtimeEnv.envFile.loadedNames,
      skippedNames: runtimeEnv.envFile.skippedNames,
      hasOpenAiApiKey: runtimeEnv.hasOpenAiApiKey,
      hasExaApiKey: runtimeEnv.hasExaApiKey,
      hasOpenRouterApiKey: runtimeEnv.hasOpenRouterApiKey,
    },
    realtimeRouter: {
      policy: DEFAULT_NO_SPEECH_POLICY,
      audioMode: "openai_realtime",
    },
  };
}

export function startHealthServer(options: HealthServerOptions): void {
  // Bind all interfaces by default so a container's reverse proxy can reach it.
  // HOST overrides; local dev can still hit 127.0.0.1 since 0.0.0.0 accepts it.
  const host = process.env.HOST ?? options.host ?? "0.0.0.0";
  const port = options.port ?? 8787;
  const server = createServer((request, response) => {
    void handleRequest(request, response, options).catch((error: unknown) => {
      writeJson(response, 500, {
        ok: false,
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown gateway error",
      });
    });
  });
  server.listen(port, host, () => {
    const payload = {
      ok: true,
      service: "signal-room-gateway",
      url: `http://${host}:${port}/health`,
    };
    console.log(JSON.stringify(payload, null, 2));
  });

  const close = () => {
    server.close(() => undefined);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HealthServerOptions
): Promise<void> {
  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }

  const path = request.url ? new URL(request.url, "http://localhost").pathname : "/";

  if (request.method === "GET" && path === "/health") {
    writeJson(response, 200, buildHealthPayload(options.runtimeEnv));
    return;
  }

  if (request.method === "POST" && path === "/replay-transcript") {
    if (!options.replayTranscript) {
      writeJson(response, 503, {
        ok: false,
        error: "replay_unavailable",
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await options.replayTranscript(parseReplayTranscriptRequest(body));
      writeJson(response, 200, { ok: true, result });
    } catch (error: unknown) {
      writeJson(response, 400, {
        ok: false,
        error: "bad_request",
        message: error instanceof Error ? error.message : "Invalid replay-transcript request",
      });
    }
    return;
  }

  if (request.method === "POST" && path === "/work-room") {
    if (!options.workRoom) {
      writeJson(response, 503, {
        ok: false,
        error: "worker_unavailable",
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await options.workRoom(parseWorkRoomRequest(body));
      writeJson(response, 200, { ok: true, result });
    } catch (error: unknown) {
      writeJson(response, 400, {
        ok: false,
        error: "bad_request",
        message: error instanceof Error ? error.message : "Invalid work-room request",
      });
    }
    return;
  }

  if (request.method === "POST" && path === "/fleet") {
    if (!options.fleet) {
      writeJson(response, 503, {
        ok: false,
        error: "fleet_unavailable",
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await options.fleet(parseFleetRequest(body));
      writeJson(response, 200, { ok: true, result });
    } catch (error: unknown) {
      writeJson(response, 400, {
        ok: false,
        error: "bad_request",
        message: error instanceof Error ? error.message : "Invalid fleet request",
      });
    }
    return;
  }

  if (request.method === "POST" && path === "/ask") {
    if (!options.ask) {
      writeJson(response, 503, {
        ok: false,
        error: "ask_unavailable",
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await options.ask(parseAskRequest(body));
      writeJson(response, 200, { ok: true, result });
    } catch (error: unknown) {
      writeJson(response, 400, {
        ok: false,
        error: "bad_request",
        message: error instanceof Error ? error.message : "Invalid ask request",
      });
    }
    return;
  }

  if (request.method === "POST" && path === "/realtime-token") {
    if (!options.realtimeToken) {
      writeJson(response, 503, {
        ok: false,
        error: "realtime_token_unavailable",
      });
      return;
    }

    try {
      const result = await options.realtimeToken();
      writeJson(response, 200, { ok: true, result });
    } catch (error: unknown) {
      writeJson(response, 400, {
        ok: false,
        error: "bad_request",
        message: error instanceof Error ? error.message : "Invalid realtime-token request",
      });
    }
    return;
  }

  writeJson(response, 404, {
    ok: false,
    error: "not_found",
  });
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(statusCode === 204 ? undefined : JSON.stringify(payload, null, 2));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = await new Promise<string>((resolve, reject) => {
    let collected = "";
    request.on("data", (chunk) => {
      collected += String(chunk);
      if (collected.length > 65_536) {
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(collected));
    request.on("error", reject);
  });

  return body.trim() ? JSON.parse(body) : {};
}

function parseReplayTranscriptRequest(body: unknown): ReplayTranscriptRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Body must be a JSON object");
  }

  const record = body as Record<string, unknown>;
  const roomCode = parseString(record.roomCode, "roomCode");
  const displayName = parseOptionalString(record.displayName, "displayName");
  const database = parseOptionalString(record.database, "database");
  const delayMs = parseOptionalDelay(record.delayMs);
  const transcript = parseString(record.transcript, "transcript");

  return {
    roomCode,
    displayName,
    database,
    delayMs,
    transcript,
  };
}

function parseWorkRoomRequest(body: unknown): WorkRoomRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Body must be a JSON object");
  }

  const record = body as Record<string, unknown>;
  const roomCode = parseString(record.roomCode, "roomCode");
  const database = parseOptionalString(record.database, "database");
  const maxTasks = parseOptionalMaxTasks(record.maxTasks);
  const workerCount = parseOptionalWorkerCount(record.workerCount);

  return {
    roomCode,
    database,
    maxTasks,
    workerCount,
  };
}

function parseFleetRequest(body: unknown): FleetRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Body must be a JSON object");
  }

  const record = body as Record<string, unknown>;
  const roomCode = parseString(record.roomCode, "roomCode");
  const database = parseOptionalString(record.database, "database");

  return {
    roomCode,
    database,
  };
}

function parseAskRequest(body: unknown): AskRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Body must be a JSON object");
  }

  const record = body as Record<string, unknown>;
  const roomCode = parseString(record.roomCode, "roomCode");
  const question = parseString(record.question, "question");
  const database = parseOptionalString(record.database, "database");

  return {
    roomCode,
    question,
    database,
  };
}

function parseString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function parseOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseOptionalDelay(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 30_000) {
    throw new Error("delayMs must be an integer from 0 to 30000");
  }
  return value;
}

function parseOptionalMaxTasks(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("maxTasks must be an integer from 1 to 10");
  }
  return value;
}

function parseOptionalWorkerCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error("workerCount must be an integer from 1 to 6");
  }
  return value;
}
