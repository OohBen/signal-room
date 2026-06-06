import { Bot, Mic, MicOff, Radio, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SignalRoomSnapshot } from "../adapters/roomAdapter";
import { GATEWAY_URL, SPACETIME_DATABASE } from "../config";
import { Chip, PanelTitle } from "./Primitives";

interface HostMicProps {
  room: SignalRoomSnapshot;
  isActive: boolean;
  onToast: (message: string) => void;
}

interface RealtimeAudioSocketMessage {
  ok?: boolean;
  type?:
    | "ready"
    | "session_started"
    | "transcript_delta"
    | "transcript_final"
    | "speech_started"
    | "speech_stopped"
    | "operator_event"
    | "operator_done"
    | "operator_error"
    | "closed"
    | "error";
  message?: string;
  text?: string;
  action?: string;
  skipped?: boolean;
  nodeId?: string;
  model?: string;
  transcriptionModel?: string;
}

type AudioContextConstructor = new (contextOptions?: AudioContextOptions) => AudioContext;

const defaultChunk =
  "Question: will the Strait of Hormuz reopen within 72 hours? Michelle says China and India public pressure on Iran could matter. Ben asks: agent, look up recent China and India statements on Iran and whether oil markets are pricing a ceasefire.";

export function HostMic({ room, isActive, onToast }: HostMicProps) {
  const { state, adapterStatus, actions } = room;
  const [chunk, setChunk] = useState(defaultChunk);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [liveRouting, setLiveRouting] = useState(true);
  const [routing, setRouting] = useState(false);
  const [researching, setResearching] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Mic idle");
  const [voiceStarting, setVoiceStarting] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSocketRef = useRef<WebSocket | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioWorkletRef = useRef<AudioWorkletNode | null>(null);
  const audioMutedOutputRef = useRef<GainNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const deltaTranscriptRef = useRef("");
  const pendingRouteTranscriptRef = useRef("");
  const liveRoutingRef = useRef(true);
  const routingRef = useRef(false);
  const researchingRef = useRef(false);
  const startTimeoutRef = useRef<number | undefined>(undefined);
  const stopCloseTimerRef = useRef<number | undefined>(undefined);
  const stopRequestedRef = useRef(false);
  const sharedRoomReady = adapterStatus.mode === "spacetime" && Boolean(adapterStatus.roomId);

  useEffect(() => {
    liveRoutingRef.current = liveRouting;
  }, [liveRouting]);

  useEffect(() => {
    return () => {
      stopRealtimeCapture(false);
    };
  }, []);

  async function submitManualChunk() {
    const text = chunk.trim();
    if (!text) return;
    if (!sharedRoomReady) {
      onToast("Shared room still connecting");
      return;
    }
    const synced = await actions.addTranscriptChunk(text);
    if (synced) {
      queueRouteText(text);
      setChunk("");
    } else {
      onToast("Shared room did not accept the transcript chunk");
    }
  }

  function toggleLiveRouting() {
    const next = !liveRouting;
    setLiveRouting(next);
    onToast(next ? "Live routing enabled" : "Live routing paused");
  }

  async function startListening() {
    if (voiceStarting || listening) return;
    if (!sharedRoomReady) {
      onToast("Shared room still connecting");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onToast("Microphone capture is unavailable in this browser");
      return;
    }

    setVoiceStarting(true);
    setVoiceStatus("Requesting microphone");
    stopRequestedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const socket = new WebSocket(buildGatewayWebSocketUrl());
      audioStreamRef.current = stream;
      audioSocketRef.current = socket;

      startTimeoutRef.current = window.setTimeout(() => {
        onToast("Realtime voice session did not start");
        stopRealtimeCapture(false);
      }, 10_000);

      socket.onopen = () => {
        setVoiceStatus("Starting Realtime transcription");
        socket.send(
          JSON.stringify({
            type: "session_start",
            roomCode: state.roomCode,
            displayName: state.displayName,
            database: SPACETIME_DATABASE,
            contextTranscript: buildTranscriptContext(""),
          })
        );
      };
      socket.onmessage = (event) => {
        void handleRealtimeSocketMessage(event.data, stream, socket);
      };
      socket.onerror = () => {
        onToast("Realtime voice socket failed");
        stopRealtimeCapture(false);
      };
      socket.onclose = () => {
        if (audioSocketRef.current !== socket) return;
        stopRealtimeCapture(false);
        setVoiceStatus("Realtime voice closed");
      };
    } catch (error: unknown) {
      stopRealtimeCapture(false);
      onToast(error instanceof Error ? error.message : "Could not start host mic");
    }
  }

  async function handleRealtimeSocketMessage(raw: unknown, stream: MediaStream, socket: WebSocket) {
    const payload = parseRealtimeSocketMessage(raw);
    if (payload.type === "ready") return;

    if (payload.type === "operator_error") {
      onToast(payload.message || "Realtime room operator failed");
      return;
    }

    if (payload.type === "operator_event") {
      if (!payload.skipped && payload.action !== "add_transcript_turn") {
        setVoiceStatus(payload.message ? `Operator updated: ${payload.message}` : "Operator updated room");
      }
      return;
    }

    if (payload.type === "operator_done") {
      if (!stopRequestedRef.current) {
        setVoiceStatus("Listening live");
      }
      return;
    }

    if (payload.ok === false || payload.type === "error") {
      onToast(payload.message || "Realtime voice failed");
      stopRealtimeCapture(false);
      return;
    }

    if (payload.type === "session_started") {
      clearStartTimeout();
      try {
        await startRealtimeAudioGraph(stream, socket);
        setListening(true);
        setVoiceStarting(false);
        setVoiceStatus("Listening live");
      } catch (error: unknown) {
        stopRealtimeCapture(false);
        onToast(error instanceof Error ? error.message : "Could not stream microphone audio");
      }
      return;
    }

    if (payload.type === "speech_started") {
      setVoiceStatus("Speech detected");
      return;
    }

    if (payload.type === "speech_stopped") {
      setVoiceStatus("Transcribing turn");
      return;
    }

    if (payload.type === "transcript_delta" && payload.text) {
      deltaTranscriptRef.current = `${deltaTranscriptRef.current}${payload.text}`;
      setInterim(deltaTranscriptRef.current.trim());
      return;
    }

    if (payload.type === "transcript_final") {
      const text = payload.text?.trim() ?? "";
      deltaTranscriptRef.current = "";
      if (!text) return;

      setInterim(text);
      setVoiceStatus("Turn sent to room operator");
      if (stopRequestedRef.current) {
        setVoiceStatus("Finishing room update");
      }
    }
  }

  async function startRealtimeAudioGraph(stream: MediaStream, socket: WebSocket) {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      throw new Error("AudioContext is unavailable in this browser");
    }

    const audioContext = new AudioContextCtor({ sampleRate: 24000 });
    if (!audioContext.audioWorklet) {
      await audioContext.close();
      throw new Error("AudioWorklet is required for realtime microphone capture");
    }

    await audioContext.audioWorklet.addModule("/audio-worklets/realtime-pcm-worklet.js");
    const source = audioContext.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioContext, "signal-room-pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        frameSamples: 2400,
        targetRate: 24000,
      },
    });
    const mutedOutput = audioContext.createGain();
    mutedOutput.gain.value = 0;

    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const audioBase64 = bytesToBase64(new Uint8Array(event.data));
      socket.send(JSON.stringify({ type: "audio_pcm", audioBase64 }));
    };

    source.connect(worklet);
    worklet.connect(mutedOutput);
    mutedOutput.connect(audioContext.destination);
    await audioContext.resume();

    audioContextRef.current = audioContext;
    audioSourceRef.current = source;
    audioWorkletRef.current = worklet;
    audioMutedOutputRef.current = mutedOutput;
  }

  function stopListening() {
    finishRealtimeCapture(true);
  }

  function finishRealtimeCapture(showToast: boolean) {
    clearStartTimeout();
    stopAudioGraph();
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    setListening(false);
    setVoiceStarting(false);

    const socket = audioSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      stopRequestedRef.current = true;
      socket.send(JSON.stringify({ type: "session_stop" }));
      setVoiceStatus("Finishing last turn");
      stopCloseTimerRef.current = window.setTimeout(() => {
        stopRealtimeCapture(false);
      }, 12_000);
      return;
    }

    stopRealtimeCapture(showToast);
  }

  function stopRealtimeCapture(showToast: boolean) {
    clearStartTimeout();
    clearStopCloseTimer();
    const socket = audioSocketRef.current;
    audioSocketRef.current = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }

    stopAudioGraph();
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    stopRequestedRef.current = false;
    deltaTranscriptRef.current = "";
    setListening(false);
    setVoiceStarting(false);
    setInterim("");
    setVoiceStatus("Mic idle");
  }

  function stopAudioGraph() {
    audioWorkletRef.current?.port.postMessage({ type: "flush" });
    audioWorkletRef.current?.port.close();
    audioWorkletRef.current?.disconnect();
    audioSourceRef.current?.disconnect();
    audioMutedOutputRef.current?.disconnect();
    void audioContextRef.current?.close();
    audioWorkletRef.current = null;
    audioSourceRef.current = null;
    audioMutedOutputRef.current = null;
    audioContextRef.current = null;
  }

  function clearStartTimeout() {
    if (startTimeoutRef.current !== undefined) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = undefined;
    }
  }

  function clearStopCloseTimer() {
    if (stopCloseTimerRef.current !== undefined) {
      window.clearTimeout(stopCloseTimerRef.current);
      stopCloseTimerRef.current = undefined;
    }
  }

  async function routeTranscriptToMap(newText: string, quiet = false) {
    if (routingRef.current) return;
    const transcript = buildTranscriptContext(newText);
    if (!transcript) return;
    if (!sharedRoomReady) {
      if (!quiet) onToast("Shared room still connecting");
      return;
    }

    routingRef.current = true;
    setRouting(true);
    try {
      const response = await fetch(`${GATEWAY_URL}/replay-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: state.roomCode,
          displayName: state.displayName,
          database: SPACETIME_DATABASE,
          delayMs: 0,
          transcript,
        }),
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || `Gateway returned ${response.status}`);
      }
      if (!quiet) onToast("Router updated the shared map");
      void runResearchWorker(true);
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "Live router failed");
    } finally {
      routingRef.current = false;
      setRouting(false);
    }
  }

  function queueRouteText(text: string) {
    const cleanText = text.trim();
    if (!cleanText || !liveRoutingRef.current) return;

    pendingRouteTranscriptRef.current = [pendingRouteTranscriptRef.current, cleanText]
      .filter(Boolean)
      .join("\n\n")
      .slice(-1600);

    if (!hasMapworthySignal(pendingRouteTranscriptRef.current)) {
      return;
    }

    const transcript = pendingRouteTranscriptRef.current;
    pendingRouteTranscriptRef.current = "";
    void routeTranscriptToMap(transcript, true);
  }

  function buildTranscriptContext(newText: string): string {
    const existing = [...state.transcript]
      .reverse()
      .map((utterance) => utterance.text.trim())
      .filter(Boolean);
    const cleanNewText = newText.trim();
    if (cleanNewText && existing[existing.length - 1] !== cleanNewText) {
      existing.push(cleanNewText);
    }
    return existing.slice(-8).join("\n\n");
  }

  async function runResearchWorker(quiet = false) {
    if (researchingRef.current) return;
    if (!sharedRoomReady) {
      if (!quiet) onToast("Shared room still connecting");
      return;
    }

    researchingRef.current = true;
    setResearching(true);
    try {
      const response = await fetch(`${GATEWAY_URL}/work-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: state.roomCode,
          database: SPACETIME_DATABASE,
          maxTasks: 1,
          forceMock: false,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        result?: { workedCount?: number };
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || `Gateway returned ${response.status}`);
      }
      if (!quiet) {
        onToast(payload.result?.workedCount ? "Research finding written" : "No queued research tasks");
      }
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "Research worker failed");
    } finally {
      researchingRef.current = false;
      setResearching(false);
    }
  }

  if (!isActive) {
    return (
      <aside className="capture-dock" aria-label="Host capture dock">
        <div className="capture-dock-status">
          <span className={listening ? "live-dot" : "idle-dot"} aria-hidden="true" />
          <div>
            <strong>{listening ? "Host capture live" : "Host capture"}</strong>
            <span>{voiceStarting ? "Starting mic" : voiceStatus}</span>
          </div>
          <span className={listening ? "capture-wave active" : "capture-wave"} aria-hidden="true">
            {Array.from({ length: 18 }).map((_, index) => (
              <i key={index} />
            ))}
          </span>
        </div>
        <div className="capture-dock-actions">
          <button
            className={liveRouting ? "primary-btn" : "ghost-btn"}
            type="button"
            onClick={toggleLiveRouting}
            disabled={!sharedRoomReady || routing}
          >
            <Bot size={16} strokeWidth={2.1} />
            {routing ? "Routing" : liveRouting ? "Routing live" : "Route"}
          </button>
          <button
            className="ghost-btn"
            type="button"
            onClick={() => void runResearchWorker()}
            disabled={!sharedRoomReady || researching}
          >
            <Bot size={16} strokeWidth={2.1} />
            {researching ? "Working" : "Work task"}
          </button>
          <button
            className={listening ? "danger-btn" : "primary-btn"}
            type="button"
            onClick={listening ? stopListening : () => void startListening()}
            disabled={voiceStarting || (!listening && !sharedRoomReady)}
          >
            {listening ? <MicOff size={16} strokeWidth={2.1} /> : <Mic size={16} strokeWidth={2.1} />}
            {listening ? "Stop" : voiceStarting ? "Starting" : "Start mic"}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <section
      className={isActive ? "screen active" : "screen background-capture"}
      aria-hidden={!isActive}
      aria-label="Host mic"
    >
      <div className="host-grid">
        <section className="panel host-console">
          <div className="panel-head">
            <PanelTitle>
              <Radio size={17} strokeWidth={2.1} />
              Host Capture
            </PanelTitle>
            <span className="panel-sub">{state.roomCode}</span>
          </div>

          <div className="host-hero">
            <div>
              <h2>{listening ? "Listening" : "Ready"}</h2>
              <p>{adapterStatus.mode === "spacetime" ? "live Realtime + SpacetimeDB room" : "connecting"}</p>
            </div>
            <div className="host-actions">
              <button
                className={liveRouting ? "primary-btn" : "ghost-btn"}
                type="button"
                onClick={toggleLiveRouting}
                disabled={!sharedRoomReady || routing}
              >
                <Bot size={17} strokeWidth={2.1} />
                {routing ? "Routing" : liveRouting ? "Routing live" : "Route live mic"}
              </button>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => void runResearchWorker()}
                disabled={!sharedRoomReady || researching}
              >
                <Bot size={17} strokeWidth={2.1} />
                {researching ? "Researching" : "Work one task"}
              </button>
              <button
                className={listening ? "danger-btn" : "primary-btn"}
                type="button"
                onClick={listening ? stopListening : () => void startListening()}
                disabled={voiceStarting || (!listening && !sharedRoomReady)}
              >
                {listening ? <MicOff size={17} strokeWidth={2.1} /> : <Mic size={17} strokeWidth={2.1} />}
                {listening ? "Stop mic" : voiceStarting ? "Starting mic" : "Start mic"}
              </button>
            </div>
          </div>

          <div className="compose">
            <textarea
              aria-label="Manual transcript chunk"
              value={chunk}
              onChange={(event) => setChunk(event.target.value)}
            />
            <div className="compose-actions">
              <button
                className="primary-btn"
                type="button"
                onClick={() => void submitManualChunk()}
                disabled={!sharedRoomReady}
              >
                <Send size={17} strokeWidth={2.1} />
                Add transcript chunk
              </button>
            </div>
          </div>

          <article className="source-row">
            <strong>Realtime voice</strong>
            <span>{voiceStatus}</span>
          </article>

          <article className="source-row">
            <strong>Current turn</strong>
            <span>{interim || "No speech yet"}</span>
          </article>
        </section>

        <aside className="panel side-stack">
          <div className="panel-head">
            <PanelTitle>
              <Mic size={17} strokeWidth={2.1} />
              Live Transcript
            </PanelTitle>
            <span className="panel-sub">{adapterStatus.counts.transcriptChunks} chunks</span>
          </div>
          <div className="side-content">
            {state.transcript.slice(0, 6).map((utterance) => (
              <article className="queue-row" key={utterance.id}>
                <div className="queue-meta">
                  <strong>{utterance.speaker}</strong>
                  <Chip chip={{ label: utterance.timestamp, tone: "blue" }} />
                </div>
                <span>{utterance.text}</span>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function buildGatewayWebSocketUrl(): string {
  const url = new URL(GATEWAY_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/live-audio";
  url.search = "";
  return url.toString();
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const browserWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
}

function parseRealtimeSocketMessage(raw: unknown): RealtimeAudioSocketMessage {
  if (typeof raw !== "string") {
    return { ok: false, type: "error", message: "Unexpected Realtime voice message" };
  }
  try {
    return JSON.parse(raw) as RealtimeAudioSocketMessage;
  } catch {
    return { ok: false, type: "error", message: "Realtime voice message was not JSON" };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function hasMapworthySignal(transcript: string): boolean {
  const compact = transcript.trim().replace(/\s+/g, " ");
  if (!compact) return false;
  const words = compact.split(/\s+/).filter(Boolean);
  const lower = compact.toLowerCase();

  if (words.length >= 22) return true;
  if (/[?]/.test(compact) && words.length >= 6) return true;
  if (/\b(?:agent|look up|research|find out|figure out|source|evidence|consider)\b/.test(lower)) return true;
  if (/\b(?:let'?s talk|trying to predict|what will|will .* be|how might|impact|affect|risk|price|stock|market|oil|tariff|nvidia|nvda|bitcoin|hormuz|ukraine|russia|iran|china|india)\b/.test(lower)) {
    return words.length >= 8;
  }

  return false;
}
