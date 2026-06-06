import OpenAI from "openai";
import type { RealtimeFunctionTool, RealtimeToolChoiceConfig } from "openai/resources/realtime/realtime";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import { WebSocket, type RawData } from "ws";

import { getSecret } from "../config/env.js";
import {
  handleRealtimeRoomTool,
  readRealtimeRoomSnapshot,
  shouldRunRealtimeOperator,
  writeRealtimeTranscriptTurn,
  type RealtimeRoomContext,
  type RealtimeRoomSnapshot,
} from "./realtimeRoomTools.js";

const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe-2025-12-15";
const MAX_RECENT_TRANSCRIPT_TURNS = 8;

const REALTIME_ROOM_TOOLS: RealtimeFunctionTool[] = [
  {
    type: "function",
    name: "add_map_signal",
    description:
      "Add one meaningful shared map card from the latest room turn. If the latest turn states the main room question and no center exists, add that question as kind=topic. If the latest turn lists several material factors, call this once per factor with kind=factor and connectedTo set to the current center. Never call this for filler, acknowledgements, or tiny utterances.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "title", "summary"],
      properties: {
        kind: {
          type: "string",
          enum: ["topic", "factor", "question", "claim", "topic_shift", "summary"],
          description: "What kind of map item this is.",
        },
        title: {
          type: "string",
          minLength: 4,
          maxLength: 72,
          description: "Short card title. No speaker labels.",
        },
        summary: {
          type: "string",
          minLength: 18,
          maxLength: 220,
          description: "What changed or what the room should preserve.",
        },
        connectedTo: {
          type: "string",
          maxLength: 72,
          description: "Existing nearby topic title to connect this signal to, if obvious.",
        },
        urgency: {
          type: "string",
          enum: ["normal", "high"],
          description: "Use high only if the room should notice soon.",
        },
        question: {
          type: "string",
          maxLength: 180,
          description: "Optional passive question to put on screen for humans to choose from.",
        },
        task: {
          type: "string",
          maxLength: 240,
          description: "Optional quick research task if the topic can be checked from public/current sources.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "How confident you are that this belongs on the map.",
        },
      },
    },
  },
  {
    type: "function",
    name: "add_passive_question",
    description:
      "Put a quiet suggested question on screen. It must not interrupt the room; humans decide whether to discuss it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string", minLength: 8, maxLength: 180 },
        connectedTo: { type: "string", maxLength: 72 },
        urgency: { type: "string", enum: ["normal", "high"] },
        reason: { type: "string", maxLength: 160 },
      },
    },
  },
  {
    type: "function",
    name: "summon_quick_agent",
    description:
      "Queue a fast background research task when the room explicitly asks the agent to look something up or when a public/current check is clearly useful.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: {
        task: { type: "string", minLength: 12, maxLength: 240 },
        connectedTo: { type: "string", maxLength: 72 },
        urgency: { type: "string", enum: ["normal", "high"] },
      },
    },
  },
  {
    type: "function",
    name: "correct_map_node",
    description:
      "Correct an existing map card when the latest turn fixes a transcription mistake, clarifies the main question, or says an existing card is wrong. Prefer this over adding a new topic_shift for direct corrections.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["target"],
      properties: {
        target: {
          type: "string",
          maxLength: 72,
          description: "Existing map title to correct, or 'center' for the root/current main question.",
        },
        title: {
          type: "string",
          maxLength: 72,
          description: "Corrected card title, if the title changed.",
        },
        summary: {
          type: "string",
          maxLength: 220,
          description: "Corrected summary, if the card meaning changed.",
        },
        urgency: { type: "string", enum: ["normal", "high"] },
      },
    },
  },
  {
    type: "function",
    name: "ignore_turn",
    description:
      "Use when the latest transcript is filler, too short, a backchannel, or not useful for transcript-derived room state.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        reason: { type: "string", maxLength: 120 },
      },
    },
  },
];

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
  let uncommittedAudioMs = 0;
  let transcriptionPending = false;
  let operatorRunning = false;
  let operatorResponseDone = false;
  let operatorMutationCount = 0;
  let pendingToolCalls = 0;
  let queuedOperatorTranscript = "";
  let activeOperatorTranscript = "";
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

  clientSocket.on("close", closeRealtime);
  clientSocket.on("error", closeRealtime);

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
      logRealtime("upstream_error", { roomCode: roomContext.roomCode, message: error.message });
      if (
        closeAfterNextTranscript &&
        (error.message.includes("buffer too small") || error.message.includes("commit_empty"))
      ) {
        closeRealtime();
        return;
      }
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
                threshold: 0.45,
                prefix_padding_ms: 260,
                silence_duration_ms: 420,
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
      writeClient(clientSocket, {
        ok: true,
        type: "closed",
      });
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
          if (closeAfterNextTranscript && !operatorRunning && pendingToolCalls === 0 && !queuedOperatorTranscript) {
            closeRealtime();
          }
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
          closeRealtime();
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

    realtime.send({
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["text"],
        parallel_tool_calls: true,
        tool_choice: toolChoice,
        max_output_tokens: 1000,
        tools: REALTIME_ROOM_TOOLS,
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

  function closeRealtime(): void {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
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

interface RealtimeOperatorInput {
  latestTranscript: string;
  recentContext: string;
  snapshot: RealtimeRoomSnapshot;
}

function buildOperatorInstructions(): string {
  return [
    "You are Signal Room's silent realtime operator.",
    "You are not a chatbot. Do not answer the meeting. Do not interrupt. Do not produce user-facing prose.",
    "Your only job is to make small tool calls that keep a shared research map useful while people keep talking.",
    "Judge the LATEST TRANSCRIPT TURN first. Use recent context only to resolve pronouns like 'it' or 'that'.",
    "The map has one center. If Current map center is empty, generic, or missing, and the latest turn names the main question, call add_map_signal once with kind='topic'. The title must be the actual question or target, not a vague discussion label.",
    "If the latest turn says a main topic is coming but does not actually name the target yet, use ignore_turn and wait.",
    "If there is no usable center yet and the latest turn only lists factors, do not invent a center from those factors. Use ignore_turn unless one factor is clearly the actual main question.",
    "If a real center already exists, do not create another card that merely restates it. Add new cards only for new factors, claims, questions, shifts, or agent requests.",
    "If the latest turn corrects a prior mishearing or says 'not X, Y', use correct_map_node on the existing card. Example: if the center says 'spot at Scrabble' and the room says 'not spot, bot', correct the center/title to 'Ben's bot at Scrabble'.",
    "When the latest turn enumerates factors, e.g. 'it is going to be about A, B, C', create separate kind='factor' map signals for each material factor. Connect each to the exact Current map center title.",
    "When a participant asks for data or says 'agent, look up/research/find/figure out', create a map signal for the request and include a task on that same signal only when it is public/current-source researchable.",
    "If the latest turn materially contradicts the current center, changes the expected answer, or sounds game-changing for the room, set urgency='high' and make the title/action specific.",
    "Only use summon_quick_agent without add_map_signal when the room asks for a quick check that does not deserve a card.",
    "Only set connectedTo to an exact title listed in Current map. If unsure, omit it.",
    "Use add_passive_question for quiet questions that humans may choose to discuss. AI never asks these aloud.",
    "Use ignore_turn for filler, acknowledgements, corrections, jokes, repetition, or turns too small to preserve.",
    "Do not create a card titled 'Brief utterance', 'Conversation summary', 'Current discussion', 'NVIDIA discussion', or similar low-information generic labels.",
    "Bad center titles: 'Gas discussion', 'NVIDIA interest', 'Current discussion'. Good center titles: 'Gas prices this month vs $100', 'NVIDIA Q4 2026 outlook'.",
    "Bad factor handling: one card named 'Geopolitical events'. Good factor handling: separate cards like 'Russian sanctions', 'Ukraine war', 'Strait of Hormuz risk', each connected to the center.",
    "Do not preserve turns like 'oh, that', 'um', 'yeah', or short acknowledgements as map cards.",
    "Do not invent sources, facts, countries, companies, or dates that were not in the transcript.",
    "If a topic is not researchable from public/current sources, preserve it as a map signal or passive question and omit the task.",
    "Private-room claims about people in the room, e.g. who worked harder, who drank caffeine, who stole a phone, or a Scrabble matchup, should usually be preserved as claims/questions without web research tasks unless the room explicitly asks for general outside evidence.",
    "Prefer one strong tool call over many weak ones. Exception: a factor-list turn may create up to five factor cards.",
  ].join("\n");
}

function buildOperatorInput(context: RealtimeRoomContext, input: RealtimeOperatorInput): string {
  return [
    `Room code: ${cleanOperatorContext(context.roomCode)}`,
    `Participant name: ${cleanOperatorContext(context.displayName)}`,
    "Current map:",
    formatSnapshot(input.snapshot),
    "",
    "Recent prior context:",
    input.recentContext.trim().slice(-1400) || "(none)",
    "",
    "LATEST TRANSCRIPT TURN TO ROUTE:",
    input.latestTranscript.trim().slice(-900),
    "",
    "Decide whether the shared state needs a map signal, passive question, quick-agent task, or no action.",
  ].join("\n");
}

function formatSnapshot(snapshot: RealtimeRoomSnapshot): string {
  const lines = [`center: ${snapshot.rootTitle ?? "(none)"}`];
  if (snapshot.nodes.length === 0) {
    lines.push("nodes: (none)");
    return lines.join("\n");
  }

  lines.push("nodes:");
  for (const node of snapshot.nodes) {
    lines.push(`- [${node.nodeType}] ${node.title}: ${node.summary}`);
  }
  return lines.join("\n");
}

function cleanOperatorContext(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) || "unknown" : "unknown";
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
