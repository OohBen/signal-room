import OpenAI from "openai";
import type { RealtimeToolChoiceConfig } from "openai/resources/realtime/realtime";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import { WebSocket, type RawData } from "ws";

import { getSecret } from "../config/env.js";
import {
  ACTION_REALTIME_ROOM_TOOLS,
  buildOperatorInput,
  buildOperatorInstructions,
  type RealtimeOperatorInput,
} from "./operatorConfig.js";
import {
  handleRealtimeRoomTool,
  readRealtimeRoomSnapshot,
  shouldRunRealtimeOperator,
  writeRealtimeTranscriptTurn,
  type RealtimeRoomContext,
} from "./realtimeRoomTools.js";

const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe-2025-12-15";
const MAX_RECENT_TRANSCRIPT_TURNS = 8;

interface RealtimeClientMessage {
  type: "session_start" | "audio_pcm" | "session_stop";
  roomCode?: string;
  displayName?: string;
  database?: string;
  audioBase64?: string;
  contextTranscript?: string;
}

export function attachRealtimeAudioSocket(clientSocket: WebSocket): void {
  let realtime: OpenAIRealtimeWS | undefined;
  let roomContext: RealtimeRoomContext = {};
  let upstreamOpen = false;
  let closeAfterNextTranscript = false;
  let closeTimer: NodeJS.Timeout | undefined;
  let operatorTimer: NodeJS.Timeout | undefined;
  let uncommittedAudioMs = 0;
  let transcriptionPending = false;
  let operatorRunning = false;
  let operatorResponseDone = false;
  let operatorMutationCount = 0;
  let pendingToolCalls = 0;
  let queuedOperatorTranscript = "";
  let activeOperatorTranscript = "";
  let clientClosedNoticeSent = false;
  const recentTranscriptTurns: string[] = [];

  writeClient(clientSocket, {
    ok: true,
    type: "ready",
    route: "/live-audio",
    mode: "openai_realtime",
  });

  clientSocket.on("message", (data) => {
    void handleClientMessage(data).catch((error: unknown) => {
      writeClient(clientSocket, {
        ok: false,
        type: "error",
        message: error instanceof Error ? error.message : "Realtime audio failed",
      });
    });
  });

  clientSocket.on("close", () => closeRealtime({ closeClient: false }));
  clientSocket.on("error", () => closeRealtime({ closeClient: false }));

  async function handleClientMessage(data: RawData): Promise<void> {
    const message = parseRealtimeClientMessage(data);
    if (message.type === "session_start") {
      await startRealtimeSession(message);
      return;
    }

    if (message.type === "audio_pcm") {
      if (!realtime || !upstreamOpen) return;
      const audio = parseBase64Audio(message.audioBase64);
      uncommittedAudioMs += estimatePcmDurationMs(audio);
      realtime.send({ type: "input_audio_buffer.append", audio });
      return;
    }

    if (message.type === "session_stop") {
      if (realtime && upstreamOpen) {
        if (uncommittedAudioMs >= 100) {
          closeAfterNextTranscript = true;
          realtime.send({ type: "input_audio_buffer.commit" });
          closeTimer = setTimeout(closeRealtime, 9000);
          return;
        }
        if (transcriptionPending) {
          closeAfterNextTranscript = true;
          closeTimer = setTimeout(closeRealtime, 9000);
          return;
        }
        closeRealtime();
        return;
      }
      closeRealtime();
    }
  }

  async function startRealtimeSession(message: RealtimeClientMessage): Promise<void> {
    if (realtime) return;

    const apiKey = getSecret("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for Realtime audio");
    }

    const client = new OpenAI({ apiKey });
    const model = getSecret("SIGNAL_ROOM_REALTIME_MODEL") ?? DEFAULT_REALTIME_MODEL;
    const transcriptionModel = getSecret("SIGNAL_ROOM_TRANSCRIPTION_MODEL") ?? DEFAULT_TRANSCRIPTION_MODEL;
    roomContext = {
      database: message.database,
      roomCode: message.roomCode,
      displayName: message.displayName,
    };
    logRealtime("session_start", { roomCode: roomContext.roomCode, model, transcriptionModel });
    realtime = await OpenAIRealtimeWS.create(client, { model });

    realtime.on("event", (event) => {
      handleRealtimeEvent(event as unknown as { type?: string; [key: string]: unknown }, transcriptionModel);
    });
    realtime.on("error", (error) => {
      if (isExpectedStopCommitError(error.message)) {
        closeRealtimeIfIdle();
        return;
      }
      logRealtime("upstream_error", { roomCode: roomContext.roomCode, message: error.message });
      writeClient(clientSocket, {
        ok: false,
        type: "error",
        message: error.message,
      });
    });
    realtime.socket.on("open", () => {
      upstreamOpen = true;
      realtime?.send({
        type: "session.update",
        session: {
          type: "realtime",
          output_modalities: ["text"],
          instructions:
            "You are Signal Room's silent live listener. Do not answer, speak, or interrupt the room. Audio turns are transcribed; separate out-of-band tool calls update shared room state.",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              noise_reduction: { type: "far_field" },
              transcription: {
                model: transcriptionModel,
                language: "en",
                prompt: buildTranscriptionPrompt(message.contextTranscript),
              },
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: false,
                threshold: 0.42,
                prefix_padding_ms: 200,
                silence_duration_ms: 280,
              },
            },
          },
        },
      });
      writeClient(clientSocket, {
        ok: true,
        type: "session_started",
        model,
        transcriptionModel,
      });
    });
    realtime.socket.on("close", () => {
      upstreamOpen = false;
      notifyClientClosed();
      closeClientSocket();
    });
  }

  function handleRealtimeEvent(event: { type?: string; [key: string]: unknown }, transcriptionModel: string): void {
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (delta) {
        writeClient(clientSocket, {
          ok: true,
          type: "transcript_delta",
          text: delta,
        });
      }
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      transcriptionPending = false;
      const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (text) {
        logRealtime("transcript_final", { roomCode: roomContext.roomCode, words: text.split(/\s+/).length });
        writeClient(clientSocket, {
          ok: true,
          type: "transcript_final",
          text,
          transcriptionModel,
        });
        void handleFinalTranscriptTurn(text).catch((error: unknown) => {
          writeClient(clientSocket, {
            ok: false,
            type: "operator_error",
            message: error instanceof Error ? error.message : "Realtime room operator failed",
          });
        }).finally(() => {
          if (closeAfterNextTranscript) closeRealtimeIfIdle();
        });
      }
      if (closeAfterNextTranscript && !text) {
        closeRealtime();
      }
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      writeClient(clientSocket, { ok: true, type: "speech_started" });
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      writeClient(clientSocket, { ok: true, type: "speech_stopped" });
      return;
    }

    if (event.type === "input_audio_buffer.committed") {
      uncommittedAudioMs = 0;
      transcriptionPending = true;
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.failed") {
      const error = event.error as { message?: string } | undefined;
      transcriptionPending = false;
      if (error?.message?.includes("buffer too small") || error?.message?.includes("commit_empty")) {
        if (closeAfterNextTranscript) {
          closeRealtimeIfIdle();
        }
        return;
      }
      writeClient(clientSocket, {
        ok: false,
        type: "error",
        message: error?.message ?? "Realtime transcription failed",
      });
      if (closeAfterNextTranscript) {
        closeRealtime();
      }
      return;
    }

    if (event.type === "response.function_call_arguments.done") {
      const toolName = typeof event.name === "string" ? event.name : "";
      const callId = typeof event.call_id === "string" ? event.call_id : "";
      const rawArguments = typeof event.arguments === "string" ? event.arguments : "{}";
      if (toolName && callId) {
        pendingToolCalls += 1;
        void executeRealtimeTool(toolName, rawArguments).catch((error: unknown) => {
          writeClient(clientSocket, {
            ok: false,
            type: "operator_error",
            message: error instanceof Error ? error.message : "Realtime tool call failed",
          });
        }).finally(() => {
          pendingToolCalls = Math.max(0, pendingToolCalls - 1);
          finishOperatorIfSettled();
        });
      }
      return;
    }

    if (event.type === "response.done") {
      const response = event.response as { status?: string; status_details?: unknown } | undefined;
      logRealtime("operator_response_done", {
        roomCode: roomContext.roomCode,
        status: response?.status,
        statusDetails: response?.status_details,
        pendingToolCalls,
        operatorMutationCount,
      });
      operatorResponseDone = true;
      finishOperatorIfSettled();
    }
  }

  async function handleFinalTranscriptTurn(text: string): Promise<void> {
    await writeRealtimeTranscriptTurn(roomContext, text);

    const priorContext = recentTranscriptTurns.slice(-(MAX_RECENT_TRANSCRIPT_TURNS - 1)).join("\n\n");
    recentTranscriptTurns.push(text);
    while (recentTranscriptTurns.length > MAX_RECENT_TRANSCRIPT_TURNS) {
      recentTranscriptTurns.shift();
    }

    if (shouldRunRealtimeOperator(text)) {
      await queueOrRunRealtimeOperator(text, priorContext);
    }
  }

  async function queueOrRunRealtimeOperator(latestTranscript: string, recentContext: string): Promise<void> {
    if (operatorRunning) {
      queuedOperatorTranscript = [queuedOperatorTranscript, latestTranscript].filter(Boolean).join("\n\n").slice(-1800);
      return;
    }

    operatorRunning = true;
    operatorResponseDone = false;
    operatorMutationCount = 0;
    activeOperatorTranscript = latestTranscript;
    try {
      const snapshot = await readRealtimeRoomSnapshot(roomContext);
      sendRealtimeOperator({ latestTranscript, recentContext, snapshot });
    } catch (error) {
      operatorRunning = false;
      operatorResponseDone = false;
      operatorMutationCount = 0;
      activeOperatorTranscript = "";
      throw error;
    }
  }

  function sendRealtimeOperator(input: RealtimeOperatorInput): void {
    if (!realtime || !upstreamOpen) {
      operatorRunning = false;
      operatorResponseDone = false;
      operatorMutationCount = 0;
      activeOperatorTranscript = "";
      return;
    }

    const toolChoice: RealtimeToolChoiceConfig =
      input.snapshot.nodes.length === 0 && shouldRunRealtimeOperator(input.latestTranscript)
        ? { type: "function", name: "add_map_signal" }
        : "required";
    logRealtime("operator_start", {
      roomCode: roomContext.roomCode,
      nodes: input.snapshot.nodes.length,
      toolChoice,
      words: input.latestTranscript.split(/\s+/).length,
    });
    resetOperatorTimer();

    realtime.send({
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["text"],
        parallel_tool_calls: true,
        tool_choice: toolChoice,
        max_output_tokens: 650,
        tools: ACTION_REALTIME_ROOM_TOOLS,
        instructions: buildOperatorInstructions(),
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildOperatorInput(roomContext, input),
              },
            ],
          },
        ],
      },
    });
  }

  async function executeRealtimeTool(toolName: string, rawArguments: string): Promise<void> {
    const result = await handleRealtimeRoomTool(roomContext, toolName, rawArguments);
    logRealtime("operator_tool_result", {
      roomCode: roomContext.roomCode,
      toolName,
      action: result.action,
      ok: result.ok,
      skipped: result.skipped,
      message: result.message,
      nodeId: result.nodeId,
    });
    if (result.ok && !result.skipped && result.action !== "ignore_turn") {
      operatorMutationCount += 1;
    }
    writeClient(clientSocket, {
      ok: result.ok,
      type: "operator_event",
      action: result.action,
      skipped: result.skipped,
      message: result.message,
      nodeId: result.nodeId,
    });
  }

  function finishOperatorIfSettled(): void {
    if (!operatorResponseDone || pendingToolCalls > 0) return;

    if (
      operatorMutationCount === 0 &&
      activeOperatorTranscript &&
      shouldRunRealtimeOperator(activeOperatorTranscript)
    ) {
      console.warn(
        JSON.stringify({
          event: "realtime_operator_no_mutation",
          roomCode: roomContext.roomCode,
          transcript: activeOperatorTranscript.slice(0, 220),
        })
      );
    }

    completeOperatorRun();
  }

  function completeOperatorRun(): void {
    clearOperatorTimer();
    operatorRunning = false;
    operatorResponseDone = false;
    operatorMutationCount = 0;
    activeOperatorTranscript = "";
    writeClient(clientSocket, {
      ok: true,
      type: "operator_done",
    });
    if (queuedOperatorTranscript) {
      const transcript = queuedOperatorTranscript;
      queuedOperatorTranscript = "";
      void queueOrRunRealtimeOperator(
        transcript,
        recentTranscriptTurns.slice(-MAX_RECENT_TRANSCRIPT_TURNS).join("\n\n")
      ).catch((error: unknown) => {
        writeClient(clientSocket, {
          ok: false,
          type: "operator_error",
          message: error instanceof Error ? error.message : "Realtime room operator failed",
        });
      });
      return;
    }
    if (closeAfterNextTranscript && pendingToolCalls === 0) {
      closeRealtime();
    }
  }

  function closeRealtimeIfIdle(): void {
    if (!operatorRunning && pendingToolCalls === 0 && !queuedOperatorTranscript) {
      closeRealtime();
    }
  }

  function resetOperatorTimer(): void {
    clearOperatorTimer();
    operatorTimer = setTimeout(() => {
      if (!operatorRunning) return;
      console.warn(
        JSON.stringify({
          event: "realtime_operator_timeout",
          roomCode: roomContext.roomCode,
          transcript: activeOperatorTranscript.slice(0, 220),
        })
      );
      completeOperatorRun();
    }, 12000);
  }

  function clearOperatorTimer(): void {
    if (operatorTimer) {
      clearTimeout(operatorTimer);
      operatorTimer = undefined;
    }
  }

  function isExpectedStopCommitError(message: string): boolean {
    return closeAfterNextTranscript && (message.includes("buffer too small") || message.includes("commit_empty"));
  }

  function closeRealtime(options: { closeClient?: boolean } = {}): void {
    const closeClient = options.closeClient ?? true;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    clearOperatorTimer();
    closeAfterNextTranscript = false;
    uncommittedAudioMs = 0;
    transcriptionPending = false;
    operatorRunning = false;
    operatorResponseDone = false;
    operatorMutationCount = 0;
    pendingToolCalls = 0;
    queuedOperatorTranscript = "";
    activeOperatorTranscript = "";
    upstreamOpen = false;
    if (realtime) {
      realtime.close({ code: 1000, reason: "client closed" });
      realtime = undefined;
    }
    notifyClientClosed();
    if (closeClient) {
      closeClientSocket();
    }
  }

  function notifyClientClosed(): void {
    if (clientClosedNoticeSent) return;
    clientClosedNoticeSent = true;
    writeClient(clientSocket, {
      ok: true,
      type: "closed",
    });
  }

  function closeClientSocket(): void {
    if (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING) {
      clientSocket.close(1000, "realtime closed");
    }
  }
}

function logRealtime(event: string, details: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: `realtime_${event}`, ...details }));
}

function parseRealtimeClientMessage(data: RawData): RealtimeClientMessage {
  const parsed = JSON.parse(rawDataToString(data)) as Partial<RealtimeClientMessage>;
  if (
    parsed.type !== "session_start" &&
    parsed.type !== "audio_pcm" &&
    parsed.type !== "session_stop"
  ) {
    throw new Error("Realtime audio message type is invalid");
  }
  return parsed as RealtimeClientMessage;
}

function parseBase64Audio(audioBase64: unknown): string {
  if (typeof audioBase64 !== "string" || !audioBase64.trim()) {
    throw new Error("audioBase64 is required");
  }
  if (audioBase64.length > 1_200_000) {
    throw new Error("PCM audio frame is too large");
  }
  return audioBase64;
}

function estimatePcmDurationMs(audioBase64: string): number {
  const clean = audioBase64.trim();
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const byteLength = Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  return (byteLength / 48_000) * 1000;
}

function buildTranscriptionPrompt(contextTranscript: unknown): string {
  const context = typeof contextTranscript === "string" ? contextTranscript.trim().slice(-1200) : "";
  return [
    "This is a live meeting in Signal Room, a shared research map.",
    "Expect finance, markets, geopolitics, oil, AI infrastructure, company names, and phrases like 'agent, look up'.",
    "Also expect casual room topics. In Scrabble contexts, 'bot' may be misheard as 'spot'; preserve corrections like 'not spot, bot'.",
    context ? `Recent room context:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function writeClient(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof Buffer) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}
