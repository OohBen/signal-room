import {
  GoogleGenAI,
  Modality,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
  type Schema,
  type Session,
} from "@google/genai";

import { GATEWAY_URL } from "../config";

// Browser-direct Gemini Live API transcription + tool-calling.
// Audio never touches our gateway: the gateway mints a single-use ephemeral
// token, then the browser opens a Live API WebSocket straight to Google.
// Gemini does input transcription AND function-calls in one bidi stream — no
// separate "operator" round-trip, which is the latency win over the OpenAI path.

type AudioContextConstructor = new (contextOptions?: AudioContextOptions) => AudioContext;

const TARGET_SAMPLE_RATE = 16000;

export interface GeminiLiveHandlers {
  onStatus?: (status: string) => void;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onToolCall?: (name: string, rawArguments: string) => void;
  onError?: (message: string, fatal: boolean) => void;
  onClosed?: () => void;
}

export interface GeminiLiveSession {
  stop: () => void;
  model: string;
}

interface GeminiTokenResult {
  token: string;
  model: string;
  tools?: unknown[];
  operatorInstructions?: string;
}

interface OpenAiToolShape {
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
}

const TYPE_MAP: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  object: Type.OBJECT,
  array: Type.ARRAY,
};

// Convert our OpenAI-style JSON-schema tool params to a Gemini Schema, dropping
// fields Gemini's Schema rejects (additionalProperties, min/max length, etc.).
function toGeminiSchema(node: unknown): Schema | undefined {
  if (!node || typeof node !== "object") return undefined;
  const record = node as Record<string, unknown>;
  const out: Schema = {};
  if (typeof record.type === "string") {
    out.type = TYPE_MAP[record.type.toLowerCase()] ?? Type.STRING;
  }
  if (typeof record.description === "string") out.description = record.description;
  if (Array.isArray(record.enum)) out.enum = record.enum.filter((v): v is string => typeof v === "string");
  if (record.items) {
    const items = toGeminiSchema(record.items);
    if (items) out.items = items;
  }
  if (record.properties && typeof record.properties === "object") {
    const props: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(record.properties as Record<string, unknown>)) {
      const schema = toGeminiSchema(value);
      if (schema) props[key] = schema;
    }
    out.properties = props;
  }
  if (Array.isArray(record.required)) {
    out.required = record.required.filter((v): v is string => typeof v === "string");
  }
  return out;
}

function toFunctionDeclarations(tools: unknown[]): FunctionDeclaration[] {
  return tools
    .map((tool): FunctionDeclaration | undefined => {
      const shape = tool as OpenAiToolShape;
      if (typeof shape.name !== "string") return undefined;
      return {
        name: shape.name,
        description: typeof shape.description === "string" ? shape.description : undefined,
        parameters: toGeminiSchema(shape.parameters),
      };
    })
    .filter((decl): decl is FunctionDeclaration => decl !== undefined);
}

async function mintToken(): Promise<GeminiTokenResult> {
  const response = await fetch(`${GATEWAY_URL}/gemini-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    message?: string;
    result?: GeminiTokenResult;
  };
  if (!response.ok || payload.ok === false || !payload.result?.token) {
    throw new Error(payload.message || `Gemini token request failed (${response.status})`);
  }
  return payload.result;
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const browserWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function startGeminiLive(handlers: GeminiLiveHandlers): Promise<GeminiLiveSession> {
  handlers.onStatus?.("Requesting microphone");
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is unavailable in this browser");
  }

  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
  });

  handlers.onStatus?.("Minting Gemini token");
  let token: GeminiTokenResult;
  try {
    token = await mintToken();
  } catch (error) {
    micStream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  const tools = Array.isArray(token.tools) ? token.tools : [];
  const functionDeclarations = toFunctionDeclarations(tools);

  let stopped = false;
  let session: Session | undefined;
  let audioContext: AudioContext | undefined;
  let worklet: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let mutedSink: GainNode | undefined;
  let utterance = "";

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try {
      worklet?.port.close();
      worklet?.disconnect();
      source?.disconnect();
      mutedSink?.disconnect();
      void audioContext?.close();
    } catch {
      /* ignore */
    }
    micStream.getTracks().forEach((track) => track.stop());
    try {
      session?.close();
    } catch {
      /* ignore */
    }
  };

  const ai = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: "v1alpha" } });

  handlers.onStatus?.("Connecting to Gemini Live");
  session = await ai.live.connect({
    model: token.model,
    config: {
      // The available Gemini Live models are native-audio: they ONLY support AUDIO
      // output (TEXT is rejected with close 1007). We discard the model's audio and
      // only consume its inputAudioTranscription + function-calls.
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      systemInstruction: token.operatorInstructions || undefined,
      ...(functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] } : {}),
    },
    callbacks: {
      onopen: () => {
        void startCapture().catch((error: unknown) => {
          handlers.onError?.(error instanceof Error ? error.message : "Mic capture failed", true);
          cleanup();
          handlers.onClosed?.();
        });
      },
      onmessage: (message: LiveServerMessage) => handleMessage(message),
      onerror: (event: ErrorEvent) => {
        const message = event.message || "Gemini Live error";
        handlers.onError?.(message, /invalid|unauthor|permission|api key/i.test(message));
      },
      onclose: () => {
        cleanup();
        handlers.onClosed?.();
      },
    },
  });

  function handleMessage(message: LiveServerMessage) {
    const serverContent = message.serverContent;
    const interim = serverContent?.inputTranscription?.text;
    if (typeof interim === "string" && interim) {
      utterance += interim;
      handlers.onInterim?.(utterance.trim());
    }

    const calls = message.toolCall?.functionCalls;
    if (calls && calls.length > 0) {
      const responses = calls.map((call) => {
        const name = typeof call.name === "string" ? call.name : "";
        if (name) handlers.onToolCall?.(name, JSON.stringify(call.args ?? {}));
        return { id: call.id, name, response: { result: "ok" } };
      });
      try {
        session?.sendToolResponse({ functionResponses: responses });
      } catch {
        /* ignore */
      }
    }

    if (serverContent?.turnComplete) {
      const finalText = utterance.trim();
      utterance = "";
      if (finalText) handlers.onFinal?.(finalText);
    }
  }

  async function startCapture() {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) throw new Error("AudioContext is unavailable in this browser");

    const context = new AudioContextCtor();
    if (!context.audioWorklet) {
      await context.close();
      throw new Error("AudioWorklet is required for microphone capture");
    }
    await context.audioWorklet.addModule("/audio-worklets/realtime-pcm-worklet.js");

    const node = new AudioWorkletNode(context, "signal-room-pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { frameSamples: 1600, targetRate: TARGET_SAMPLE_RATE },
    });
    const src = context.createMediaStreamSource(micStream);
    const sink = context.createGain();
    sink.gain.value = 0;

    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (stopped || !session) return;
      const data = bytesToBase64(new Uint8Array(event.data));
      try {
        session.sendRealtimeInput({ audio: { data, mimeType: `audio/pcm;rate=${TARGET_SAMPLE_RATE}` } });
      } catch {
        /* ignore transient send errors */
      }
    };

    src.connect(node);
    node.connect(sink);
    sink.connect(context.destination);
    await context.resume();

    audioContext = context;
    worklet = node;
    source = src;
    mutedSink = sink;
    handlers.onStatus?.("Listening live");
  }

  if (stopped) {
    cleanup();
  }

  return { stop: cleanup, model: token.model };
}
