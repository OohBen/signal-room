import { getSecret } from "../config/env.js";

// Dedicated OpenAI realtime *transcription* session (session.type = "transcription").
// It needs NO conversational model — there is no top-level `model` (gpt-realtime-2 is gone).
// gpt-realtime-whisper is OpenAI's natively-streaming, lowest-latency realtime transcriber
// and segments internally (it rejects turn_detection). Override the model via
// SIGNAL_ROOM_TRANSCRIPTION_MODEL; tune latency with SIGNAL_ROOM_TRANSCRIBE_DELAY
// (minimal|low|medium|high|xhigh). The browser connects this token over WebRTC.
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";

export interface RealtimeTokenResult {
  value: string;
  model: string;
  transcriptionModel: string;
  expiresAt?: number;
}

export async function mintRealtimeToken(): Promise<RealtimeTokenResult> {
  const apiKey = getSecret("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for realtime tokens");
  }

  const transcriptionModel = getSecret("SIGNAL_ROOM_TRANSCRIPTION_MODEL") ?? DEFAULT_TRANSCRIPTION_MODEL;
  const transcribeDelay = getSecret("SIGNAL_ROOM_TRANSCRIBE_DELAY");

  const transcription: Record<string, unknown> = { model: transcriptionModel, language: "en" };
  if (transcribeDelay) {
    transcription.delay = transcribeDelay;
  }

  const input: Record<string, unknown> = {
    transcription,
    noise_reduction: { type: "far_field" },
  };
  // gpt-realtime-whisper segments internally and rejects turn_detection; other
  // transcription models (e.g. gpt-4o-mini-transcribe) need server VAD to emit
  // completed events, so add it only for non-whisper models.
  if (!transcriptionModel.includes("whisper")) {
    input.turn_detection = {
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 200,
      silence_duration_ms: 380,
    };
  }

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: { input },
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

  return { value, model: transcriptionModel, transcriptionModel, expiresAt };
}
