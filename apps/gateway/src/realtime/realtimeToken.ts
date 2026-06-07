import { getSecret } from "../config/env.js";
import { ACTION_REALTIME_ROOM_TOOLS, buildOperatorInstructions } from "./operatorConfig.js";

const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe-2025-12-15";

export interface RealtimeTokenResult {
  value: string;
  model: string;
  transcriptionModel: string;
  expiresAt?: number;
  tools: unknown[];
  operatorInstructions: string;
}

export async function mintRealtimeToken(): Promise<RealtimeTokenResult> {
  const apiKey = getSecret("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for realtime tokens");
  }

  const model = getSecret("SIGNAL_ROOM_REALTIME_MODEL") ?? DEFAULT_REALTIME_MODEL;
  const transcriptionModel = getSecret("SIGNAL_ROOM_TRANSCRIPTION_MODEL") ?? DEFAULT_TRANSCRIPTION_MODEL;

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        output_modalities: ["text"],
        instructions:
          "You are Signal Room's silent live transcriber. Do not speak or respond; only transcribe the room audio.",
        audio: {
          input: {
            transcription: { model: transcriptionModel, language: "en" },
            noise_reduction: { type: "far_field" },
            turn_detection: {
              type: "server_vad",
              create_response: false,
              interrupt_response: false,
              threshold: 0.5,
              prefix_padding_ms: 200,
              silence_duration_ms: 380,
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to mint realtime token (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    value?: unknown;
    expires_at?: unknown;
    client_secret?: { value?: unknown } | string;
  };

  const clientSecret = data?.client_secret;
  const value =
    typeof data?.value === "string"
      ? data.value
      : typeof clientSecret === "object" && clientSecret !== null && typeof clientSecret.value === "string"
        ? clientSecret.value
        : typeof clientSecret === "string"
          ? clientSecret
          : undefined;

  if (typeof value !== "string" || !value) {
    throw new Error("Realtime token response did not include an ephemeral value");
  }

  const expiresAt = typeof data?.expires_at === "number" ? data.expires_at : undefined;

  return {
    value,
    model,
    transcriptionModel,
    expiresAt,
    tools: ACTION_REALTIME_ROOM_TOOLS,
    operatorInstructions: buildOperatorInstructions(),
  };
}
