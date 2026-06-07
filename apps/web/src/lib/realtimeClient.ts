import { GATEWAY_URL } from "../config";

// Browser-direct OpenAI Realtime transcription over WebRTC.
// Audio never touches our gateway: the gateway only mints a short-lived
// ephemeral token, then the browser opens a peer connection straight to
// OpenAI. Transcripts arrive on the data channel; the caller decides what to
// do with them (write to SpacetimeDB, route to the map, etc.).

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export interface RealtimeTranscriptionHandlers {
  onStatus?: (status: string) => void;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  // fatal=true means do not auto-reconnect (bad key, no mic permission, …).
  onError?: (message: string, fatal: boolean) => void;
  onClosed?: () => void;
}

export interface RealtimeTranscriptionSession {
  stop: () => void;
  model: string;
  transcriptionModel: string;
}

interface RealtimeTokenResult {
  value: string;
  model: string;
  transcriptionModel: string;
  expiresAt?: number;
}

interface RealtimeServerEvent {
  type?: string;
  delta?: string;
  transcript?: string;
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

  // The model only returns text, so there is no remote audio to play — but
  // wire ontrack defensively so a stray track never throws.
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
      case "error": {
        const message = event.error?.message || "Realtime error";
        handlers.onError?.(message, isFatalRealtimeError(message));
        return;
      }
      default:
        return;
    }
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
  };
}

export function isFatalRealtimeError(message: string): boolean {
  return /\b(?:openai_api_key is required|microphone capture is unavailable|webrtc is unavailable|not-?allowed|permission denied|invalid_api_key|insufficient_quota)\b/i.test(
    message
  );
}
