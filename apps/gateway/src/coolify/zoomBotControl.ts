import { getSecret } from "../config/env.js";

export interface StartZoomBotRequest {
  roomCode: string;
  joinUrl: string;
}

export interface StartZoomBotResult {
  deployment: unknown;
}

export async function startZoomBot(request: StartZoomBotRequest): Promise<StartZoomBotResult> {
  const baseUrl = getSecret("COOLIFY_BASE_URL") ?? "https://app.coolify.io";
  const token = getSecret("COOLIFY_TOKEN");
  const appUuid = getSecret("ZOOM_BOT_APP_UUID");

  if (!token || !appUuid) {
    throw new Error("Zoom bot control is not configured");
  }

  await coolifyFetch(baseUrl, token, `/api/v1/applications/${appUuid}/envs/bulk`, {
    method: "PATCH",
    body: JSON.stringify({
      data: [
        {
          key: "ZOOM_JOIN_URL",
          value: request.joinUrl,
          is_buildtime: false,
          is_literal: true,
          is_preview: false,
        },
        {
          key: "BRIDGE_ROOM_CODE",
          value: request.roomCode,
          is_buildtime: false,
          is_literal: true,
          is_preview: false,
        },
      ],
    }),
  });

  const deployPath = `/api/v1/deploy?uuid=${encodeURIComponent(appUuid)}&force=false`;
  const deployment = await coolifyFetch(baseUrl, token, deployPath, { method: "GET" });
  return { deployment };
}

async function coolifyFetch(baseUrl: string, token: string, path: string, init: RequestInit): Promise<unknown> {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Coolify ${response.status}: ${text.slice(0, 240)}`);
  }

  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}
