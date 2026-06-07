import { GATEWAY_URL } from "../config";

// Browser-direct OpenAI Realtime over WebRTC.
// Audio never touches our gateway: the gateway only mints a short-lived
// ephemeral token (and hands back the operator tool schemas + instructions),
// then the browser opens a peer connection straight to OpenAI.
//
// Two things flow over the data channel:
//   1. background transcription (gpt-4o-mini-transcribe) → interim/final text
//   2. the per-turn "operator": the caller sends a response.create with the
//      room snapshot + tools; gpt-realtime-2 emits function_call events which
//      the caller executes (relays to the gateway).

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type RealtimeToolChoice = "required" | "auto" | { type: "function"; name: string };

export interface RealtimeOperatorRequest {
  input: string;
  toolChoice?: RealtimeToolChoice;
}

export interface RealtimeTranscriptionHandlers {
  onStatus?: (status: string) => void;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  // A function_call emitted by gpt-realtime-2. The caller executes it.
  onToolCall?: (name: string, rawArguments: string) => void;
  // An operator response.create finished (any tool-calls were already delivered).
  onOperatorDone?: () => void;
  // fatal=true means do not auto-reconnect (bad key, no mic permission, …).
  onError?: (message: string, fatal: boolean) => void;
  onClosed?: () => void;
}

export interface RealtimeTranscriptionSession {
  stop: () => void;
  model: string;
  transcriptionModel: string;
  tools: unknown[];
  operatorInstructions: string;
  // Trigger an out-of-band operator turn. Returns false if the channel is not open.
  requestOperator: (request: RealtimeOperatorRequest) => boolean;
}

interface RealtimeTokenResult {
  value: string;
  model: string;
  transcriptionModel: string;
  tools?: unknown[];
  operatorInstructions?: string;
  expiresAt?: number;
}

interface RealtimeServerEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  error?: { message?: string };
}

async function mintToken(): Promise<RealtimeTokenResult> {
  const response = await fetch(`${GATEWAY_URL}/realtime-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    message?: string;
    result?: RealtimeTokenResult;
  };
  if (!response.ok || payload.ok === false || !payload.result?.value) {
    throw new Error(payload.message || `Realtime token request failed (${response.status})`);
  }
  return payload.result;
}

export async function startRealtimeTranscription(
  handlers: RealtimeTranscriptionHandlers
): Promise<RealtimeTranscriptionSession> {
  handlers.onStatus?.("Requesting microphone");
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is unavailable in this browser");
  }
  if (typeof RTCPeerConnection === "undefined") {
    throw new Error("WebRTC is unavailable in this browser");
  }

  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  handlers.onStatus?.("Minting realtime token");
  let token: RealtimeTokenResult;
  try {
    token = await mintToken();
  } catch (error) {
    micStream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  const tools = Array.isArray(token.tools) ? token.tools : [];
  const operatorInstructions = typeof token.operatorInstructions === "string" ? token.operatorInstructions : "";

  const pc = new RTCPeerConnection();
  let stopped = false;
  let utterance = "";

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try {
      pc.getSenders().forEach((sender) => sender.track?.stop());
    } catch {
      /* ignore */
    }
    micStream.getTracks().forEach((track) => track.stop());
    try {
      pc.close();
    } catch {
      /* ignore */
    }
  };

  for (const track of micStream.getAudioTracks()) {
    pc.addTrack(track, micStream);
  }

  // Text-only output, so there is no remote audio to play — wire ontrack
  // defensively so a stray track never throws.
  pc.ontrack = () => undefined;

  const dc = pc.createDataChannel("oai-events");
  dc.onmessage = (event) => {
    let parsed: RealtimeServerEvent;
    try {
      parsed = JSON.parse(String(event.data)) as RealtimeServerEvent;
    } catch {
      return;
    }
    handleServerEvent(parsed);
  };

  function handleServerEvent(event: RealtimeServerEvent) {
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        utterance = "";
        handlers.onStatus?.("Speech detected");
        return;
      case "input_audio_buffer.speech_stopped":
        handlers.onStatus?.("Transcribing");
        return;
      case "conversation.item.input_audio_transcription.delta": {
        if (typeof event.delta === "string") {
          utterance += event.delta;
          handlers.onInterim?.(utterance.trim());
        }
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = (event.transcript ?? utterance).trim();
        utterance = "";
        if (text) handlers.onFinal?.(text);
        return;
      }
      case "response.function_call_arguments.done": {
        const name = typeof event.name === "string" ? event.name : "";
        const rawArguments = typeof event.arguments === "string" ? event.arguments : "{}";
        if (name) handlers.onToolCall?.(name, rawArguments);
        return;
      }
      case "response.done": {
        handlers.onOperatorDone?.();
        return;
      }
      case "error": {
        const message = event.error?.message || "Realtime error";
        handlers.onError?.(message, isFatalRealtimeError(message));
        return;
      }
      default:
        return;
    }
  }

  function requestOperator(request: RealtimeOperatorRequest): boolean {
    if (stopped || dc.readyState !== "open" || tools.length === 0) return false;
    dc.send(
      JSON.stringify({
        type: "response.create",
        response: {
          conversation: "none",
          output_modalities: ["text"],
          parallel_tool_calls: true,
          tool_choice: request.toolChoice ?? "required",
          max_output_tokens: 650,
          tools,
          instructions: operatorInstructions,
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: request.input }],
            },
          ],
        },
      })
    );
    return true;
  }

  pc.onconnectionstatechange = () => {
    if (stopped) return;
    if (pc.connectionState === "connected") {
      handlers.onStatus?.("Listening live");
    } else if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected" ||
      pc.connectionState === "closed"
    ) {
      cleanup();
      handlers.onClosed?.();
    }
  };

  handlers.onStatus?.("Connecting to OpenAI");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  let answerSdp: string;
  try {
    const sdpResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      body: offer.sdp ?? "",
      headers: {
        Authorization: `Bearer ${token.value}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!sdpResponse.ok) {
      const detail = await sdpResponse.text().catch(() => "");
      throw new Error(`OpenAI realtime handshake failed (${sdpResponse.status}) ${detail}`.trim());
    }
    answerSdp = await sdpResponse.text();
  } catch (error) {
    cleanup();
    throw error;
  }

  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    stop: cleanup,
    model: token.model,
    transcriptionModel: token.transcriptionModel,
    tools,
    operatorInstructions,
    requestOperator,
  };
}

export function isFatalRealtimeError(message: string): boolean {
  return /\b(?:openai_api_key is required|microphone capture is unavailable|webrtc is unavailable|not-?allowed|permission denied|invalid_api_key|insufficient_quota)\b/i.test(
    message
  );
}
