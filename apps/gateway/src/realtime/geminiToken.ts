import { GoogleGenAI } from "@google/genai";
import { getSecret } from "../config/env.js";
import { ACTION_REALTIME_ROOM_TOOLS, buildOperatorInstructions } from "./operatorConfig.js";

const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

export interface GeminiTokenResult {
  token: string;
  model: string;
  tools: unknown[];
  operatorInstructions: string;
  expiresAt?: string;
}

export async function mintGeminiToken(): Promise<GeminiTokenResult> {
  const apiKey = getSecret("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini Live tokens");
  }
  const model = getSecret("SIGNAL_ROOM_GEMINI_MODEL") ?? DEFAULT_GEMINI_LIVE_MODEL;

  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const created = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: { model },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });

  const token = typeof created?.name === "string" ? created.name : undefined;
  if (!token) {
    throw new Error("Gemini token response did not include a token name");
  }

  return {
    token,
    model,
    tools: ACTION_REALTIME_ROOM_TOOLS,
    operatorInstructions: buildOperatorInstructions(),
    expiresAt: expireTime,
  };
}
