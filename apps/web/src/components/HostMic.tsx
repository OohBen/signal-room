import { Bot, Mic, MicOff, Radio, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SignalRoomSnapshot } from "../adapters/roomAdapter";
import { GATEWAY_URL, SPACETIME_DATABASE } from "../config";
import {
  isFatalRealtimeError,
  startRealtimeTranscription,
  type RealtimeTranscriptionSession,
} from "../lib/realtimeClient";
import { Chip, PanelTitle } from "./Primitives";

interface HostMicProps {
  room: SignalRoomSnapshot;
  isActive: boolean;
  onToast: (message: string) => void;
}

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
  const realtimeSessionRef = useRef<RealtimeTranscriptionSession | null>(null);
  const pendingRouteTranscriptRef = useRef("");
  const liveRoutingRef = useRef(true);
  const routingRef = useRef(false);
  const researchingRef = useRef(false);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const captureShouldRunRef = useRef(false);
  const stopRequestedRef = useRef(false);
  // Operator concurrency: only one out-of-band response.create in flight; keep
  // the most recent turn queued so we never overlap responses or drop the latest.
  const operatorBusyRef = useRef(false);
  const pendingOperatorTextRef = useRef<string | null>(null);
  const operatorTimerRef = useRef<number | undefined>(undefined);
  const lastAskRef = useRef<{ question: string; at: number }>({ question: "", at: 0 });
  // Connect-time handlers close over `state`; keep a live ref so the operator
  // always reads the CURRENT map snapshot + transcript, not a stale closure.
  const stateRef = useRef(state);
  stateRef.current = state;
  const sharedRoomReady = adapterStatus.mode === "spacetime" && Boolean(adapterStatus.roomId);

  // Direct "Hey agent, <question>" → fast /ask lane: answered straight into Live signals,
  // no map node, no queued task. Returns true if it fired.
  function maybeAskAgent(text: string): boolean {
    const match =
      text.match(/\bhey\s+agent\b[\s,:]*(.+)/i) ?? text.match(/\bagent\s*[,:]\s*(.+)/i);
    if (!match) return false;
    const question = match[1].trim().replace(/[?.!]+$/, "").trim();
    if (question.length < 4) return false;
    const now = Date.now();
    if (lastAskRef.current.question === question && now - lastAskRef.current.at < 12000) return true;
    lastAskRef.current = { question, at: now };
    onToast("🔎 Hey agent — looking it up, answer lands in Live signals…");
    void fetch(`${GATEWAY_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode: state.roomCode, question, database: SPACETIME_DATABASE }),
    }).catch(() => {
      onToast("Could not reach the agent for that question");
    });
    return true;
  }

  useEffect(() => {
    liveRoutingRef.current = liveRouting;
  }, [liveRouting]);

  useEffect(() => {
    return () => {
      stopRealtimeCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setChunk("");
      // A direct "Hey agent, …" goes to the fast /ask lane only — do NOT route it to
      // the map, so it never becomes a card. Other chunks build the map as usual.
      if (maybeAskAgent(text)) return;
      queueRouteText(text);
    } else {
      onToast("Shared room did not accept the transcript chunk");
    }
  }

  function toggleLiveRouting() {
    const next = !liveRouting;
    setLiveRouting(next);
    onToast(next ? "Live routing enabled" : "Live routing paused");
  }

  // ── Realtime mic: browser ↔ OpenAI over WebRTC ──────────────────────────────
  // The gateway only mints an ephemeral token; audio never passes through it.
  // Each finalized transcript is written to the shared transcript log and routed
  // to the map through the existing /replay-transcript router.

  async function startListening() {
    if (voiceStarting || listening) return;
    if (!sharedRoomReady) {
      onToast("Shared room still connecting");
      return;
    }
    captureShouldRunRef.current = true;
    stopRequestedRef.current = false;
    reconnectAttemptsRef.current = 0;
    setVoiceStarting(true);
    await connectRealtime();
  }

  async function connectRealtime() {
    clearReconnectTimer();
    setVoiceStatus("Starting live transcription");
    try {
      // OpenAI realtime session is used for streaming transcription only
      // (gpt-4o-mini-transcribe). The map operator runs server-side on Cerebras
      // via POST /operate, so no in-session tool-calls are needed here.
      const session = await startRealtimeTranscription({
        onStatus: (status: string) => {
          if (!stopRequestedRef.current) setVoiceStatus(status);
        },
        onInterim: (text: string) => setInterim(text),
        onFinal: (text: string) => {
          void handleFinalTranscript(text);
        },
        onError: (message: string, fatal: boolean) => handleRealtimeError(message, fatal),
        onClosed: () => handleRealtimeClosed(),
      });

      // Stop may have been requested while the async handshake was in flight.
      if (stopRequestedRef.current || !captureShouldRunRef.current) {
        session.stop();
        return;
      }

      realtimeSessionRef.current = session;
      reconnectAttemptsRef.current = 0;
      setListening(true);
      setVoiceStarting(false);
      setVoiceStatus(`Listening live · ${session.transcriptionModel}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not start live mic";
      handleRealtimeError(message, isFatalRealtimeError(message));
    }
  }

  async function handleFinalTranscript(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setInterim(clean);
    setVoiceStatus("Turn captured");

    // Persist to the shared transcript log first so everyone sees the turn.
    await actions.addTranscriptChunk(clean).catch(() => undefined);

    // Direct "Hey agent, …" → fast lane only (no map card).
    if (maybeAskAgent(clean)) return;
    // Everything else: the server-side Cerebras operator turns this turn into map
    // tool-calls (it reads the live room snapshot from SpacetimeDB itself).
    operateViaGateway(clean);
  }

  // Server-side operator: POST the latest turn (+ recent context) to /operate,
  // which runs gpt-oss-120b on Cerebras and executes map tool-calls. One in flight
  // at a time; keep only the most recent turn queued so we never overlap or drop.
  function operateViaGateway(latest: string) {
    if (!liveRoutingRef.current) return;

    const recent = [...stateRef.current.transcript]
      .reverse()
      .map((utterance) => utterance.text.trim())
      .filter(Boolean)
      .filter((t) => t !== latest)
      .slice(-4)
      .join("\n\n");

    if (!hasMapworthySignal([recent, latest].filter(Boolean).join("\n\n"))) return;

    if (operatorBusyRef.current) {
      pendingOperatorTextRef.current = latest;
      return;
    }
    operatorBusyRef.current = true;
    setVoiceStatus("Agent reading the room…");
    clearOperatorTimer();
    operatorTimerRef.current = window.setTimeout(() => finishOperator(), 14000);

    void (async () => {
      try {
        const response = await fetch(`${GATEWAY_URL}/operate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomCode: stateRef.current.roomCode,
            database: SPACETIME_DATABASE,
            transcript: latest,
            recentContext: recent,
          }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          result?: { executed?: Array<{ action?: string; skipped?: boolean }> };
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.message || `Gateway returned ${response.status}`);
        }
        const did = (payload.result?.executed ?? []).filter(
          (e) => e && !e.skipped && e.action && e.action !== "ignore_turn"
        );
        if (did.length > 0) {
          setVoiceStatus(`Map updated · ${did.length} change${did.length > 1 ? "s" : ""}`);
          void runResearchWorker(true);
        } else if (!stopRequestedRef.current) {
          setVoiceStatus("Listening live");
        }
      } catch (error: unknown) {
        onToast(error instanceof Error ? error.message : "Operator failed");
      } finally {
        finishOperator();
      }
    })();
  }

  function finishOperator() {
    clearOperatorTimer();
    operatorBusyRef.current = false;
    const pending = pendingOperatorTextRef.current;
    pendingOperatorTextRef.current = null;
    if (pending && captureShouldRunRef.current && !stopRequestedRef.current) {
      operateViaGateway(pending);
    }
  }

  function clearOperatorTimer() {
    if (operatorTimerRef.current !== undefined) {
      window.clearTimeout(operatorTimerRef.current);
      operatorTimerRef.current = undefined;
    }
  }

  function handleRealtimeError(message: string, fatal: boolean) {
    if (!fatal && captureShouldRunRef.current && !stopRequestedRef.current) {
      teardownSession();
      scheduleReconnect("Realtime voice reconnecting");
      return;
    }
    onToast(message);
    stopRealtimeCapture();
  }

  function handleRealtimeClosed() {
    realtimeSessionRef.current = null;
    if (captureShouldRunRef.current && !stopRequestedRef.current) {
      scheduleReconnect("Realtime voice reconnecting");
      return;
    }
    stopRealtimeCapture();
  }

  function scheduleReconnect(status: string) {
    clearReconnectTimer();
    const attempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = attempt;
    const delayMs = Math.min(5000, 500 * attempt);
    setListening(true);
    setVoiceStarting(true);
    setVoiceStatus(status);
    reconnectTimerRef.current = window.setTimeout(() => {
      if (!captureShouldRunRef.current || stopRequestedRef.current) {
        stopRealtimeCapture();
        return;
      }
      void connectRealtime();
    }, delayMs);
  }

  function teardownSession() {
    realtimeSessionRef.current?.stop();
    realtimeSessionRef.current = null;
  }

  function stopListening() {
    stopRequestedRef.current = true;
    stopRealtimeCapture();
  }

  function stopRealtimeCapture() {
    captureShouldRunRef.current = false;
    clearReconnectTimer();
    clearOperatorTimer();
    operatorBusyRef.current = false;
    pendingOperatorTextRef.current = null;
    teardownSession();
    setListening(false);
    setVoiceStarting(false);
    setInterim("");
    setVoiceStatus("Mic idle");
    stopRequestedRef.current = false;
  }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== undefined) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
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

    // Direct questions go to the fast /ask lane (answered in Live signals, no card).
    maybeAskAgent(newText);

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
