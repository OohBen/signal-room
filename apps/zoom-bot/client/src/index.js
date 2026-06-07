// Bridge: PCM file -> OpenAI Realtime WS -> SpacetimeDB reducers.
//
// What the bot does end-to-end:
//   1. Ensure room exists via `spacetime call <db> create_room ...`.
//   2. Look up the numeric room_id via `spacetime sql ...`.
//   3. Fetch the operator config (tools + instructions) from the gateway's
//      /realtime-token endpoint — same config the browser uses.
//   4. Open WS to OpenAI Realtime, configure transcription only on the input
//      side (24kHz PCM, server VAD).
//   5. Tail out/mixed.pcm (32kHz mono int16), resample to 24kHz, send.
//   6. On each transcription.completed:
//        - Write transcript chunk to SpacetimeDB.
//        - Send an out-of-band response.create to the SAME OpenAI Realtime
//          session, passing the operator tools + instructions + a snapshot
//          of recent transcript context.
//        - On function_call_arguments.done, dispatch to the matching
//          realtime_* reducer via spacetime CLI.

import { spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";
import OpenAI from "openai";
import { OpenAIRealtimeWS } from "openai/realtime/ws";

const PCM_PATH = process.env.BRIDGE_PCM_PATH ?? "../out/mixed.pcm";
const POLL_MS = Number(process.env.BRIDGE_POLL_MS ?? "100");
const ROOM_CODE = process.env.BRIDGE_ROOM_CODE ?? "ZOOM-LIVE";
const DISPLAY_NAME = process.env.BRIDGE_DISPLAY_NAME ?? "Signal Room Notetaker";
const DATABASE = process.env.BRIDGE_SPACETIME_DB ?? "signal-room-server-v3dax";
const GATEWAY_URL = process.env.BRIDGE_GATEWAY_URL ?? "http://host.docker.internal:8787";
const REALTIME_MODEL = process.env.BRIDGE_REALTIME_MODEL ?? "gpt-realtime-2";
const TRANSCRIPTION_MODEL =
  process.env.BRIDGE_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe-2025-12-15";

const SRC_RATE = 32000;
const DST_RATE = 24000;
const FRAME_MS = 40;
const SAMPLES_PER_FRAME = (DST_RATE * FRAME_MS) / 1000;
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2;
const RECENT_TURNS_KEPT = 8;
const OPERATOR_TIMEOUT_MS = 14000;

function log(message) {
  process.stdout.write(`[bridge] ${message}\n`);
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout: "", stderr: error.message });
    });
  });
}

function jsonString(value) {
  return JSON.stringify(value);
}

function optionString(value) {
  return value && String(value).trim() ? `{"some":${jsonString(String(value))}}` : '{"none":{}}';
}

function optionF64(value) {
  return typeof value === "number" && Number.isFinite(value) ? `{"some":${value}}` : '{"none":{}}';
}

async function ensureRoom() {
  log(`ensuring room ${ROOM_CODE} on ${DATABASE}`);
  const createResult = await runCommand("spacetime", [
    "call",
    DATABASE,
    "create_room",
    jsonString(ROOM_CODE),
    jsonString(`Signal Room ${ROOM_CODE}`),
    jsonString(DISPLAY_NAME),
  ]);
  if (createResult.code !== 0) {
    throw new Error(`create_room failed: ${createResult.stderr || createResult.stdout}`);
  }

  const sqlResult = await runCommand("spacetime", [
    "sql",
    DATABASE,
    `SELECT room_id FROM room WHERE code = '${ROOM_CODE}'`,
  ]);
  if (sqlResult.code !== 0) {
    throw new Error(`room lookup failed: ${sqlResult.stderr || sqlResult.stdout}`);
  }

  const match = sqlResult.stdout.match(/^\s*(\d+)\s*$/m);
  if (!match) {
    throw new Error(`room ${ROOM_CODE} not found after create_room — stdout: ${sqlResult.stdout}`);
  }
  const roomId = match[1];
  log(`room ${ROOM_CODE} ready (room_id=${roomId})`);
  return roomId;
}

async function addTranscriptChunk(roomId, text) {
  const now = Date.now();
  const startMs = Math.max(0, now - 5000);
  const result = await runCommand("spacetime", [
    "call",
    DATABASE,
    "add_transcript_chunk",
    roomId,
    jsonString("Room conversation"),
    jsonString(text),
    String(BigInt(startMs)),
    String(BigInt(now)),
    '{"none":{}}',
  ]);
  if (result.code !== 0) {
    log(`add_transcript_chunk failed: ${result.stderr || result.stdout}`);
  }
}

async function fetchOperatorConfig() {
  log(`fetching operator config from ${GATEWAY_URL}/realtime-token`);
  const response = await fetch(`${GATEWAY_URL}/realtime-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`/realtime-token returned ${response.status}`);
  }
  const payload = await response.json();
  const result = payload?.result ?? {};
  const tools = Array.isArray(result.tools) ? result.tools : [];
  const instructions = typeof result.operatorInstructions === "string" ? result.operatorInstructions : "";
  if (tools.length === 0 || !instructions) {
    throw new Error("operator config is missing tools or instructions");
  }
  log(`operator config ready (${tools.length} tools)`);
  return { tools, instructions };
}

async function runOperatorTool(roomId, name, rawArgs) {
  let args = {};
  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      args = parsed;
    }
  } catch {
    log(`operator tool ${name}: could not parse arguments`);
    return;
  }

  const urgency = typeof args.urgency === "string" && args.urgency.trim() ? args.urgency : "normal";

  if (name === "ignore_turn") return;

  let cliArgs;
  if (name === "add_map_signal") {
    cliArgs = [
      "realtime_map_signal",
      roomId,
      jsonString(typeof args.kind === "string" && args.kind ? args.kind : "topic"),
      jsonString(typeof args.title === "string" ? args.title : ""),
      jsonString(typeof args.summary === "string" ? args.summary : ""),
      optionString(args.connectedTo),
      jsonString(urgency),
      optionString(args.question),
      optionString(args.task),
      optionF64(args.confidence),
    ];
  } else if (name === "add_passive_question") {
    cliArgs = [
      "realtime_passive_question",
      roomId,
      optionString(args.connectedTo),
      jsonString(typeof args.question === "string" ? args.question : ""),
      jsonString(urgency),
    ];
  } else if (name === "summon_quick_agent") {
    cliArgs = [
      "realtime_quick_agent",
      roomId,
      optionString(args.connectedTo),
      jsonString(typeof args.task === "string" ? args.task : ""),
      jsonString(urgency),
    ];
  } else if (name === "correct_map_node") {
    cliArgs = [
      "realtime_correct_node",
      roomId,
      jsonString(typeof args.target === "string" ? args.target : ""),
      optionString(args.title),
      optionString(args.summary),
      jsonString(urgency),
    ];
  } else {
    log(`operator tool ${name}: unknown, ignoring`);
    return;
  }

  log(`operator -> ${name}`);
  const result = await runCommand("spacetime", ["call", DATABASE, ...cliArgs]);
  if (result.code !== 0) {
    log(`operator ${name} failed: ${result.stderr || result.stdout}`);
  }
}

function buildOperatorInput(recentTurns, latest) {
  const recent = recentTurns
    .filter((t) => t && t !== latest)
    .slice(-4)
    .join("\n\n");

  const lines = [
    `Room code: ${ROOM_CODE}`,
    `Participant name: ${DISPLAY_NAME}`,
    "Current map:",
    "center: (none)",
    "nodes: (none)",
    "",
    "Recent prior context:",
    recent.slice(-1400) || "(none)",
    "",
    "LATEST TRANSCRIPT TURN TO ROUTE:",
    latest.slice(-900),
    "",
    "Decide whether the shared state needs a map signal, passive question, quick-agent task, or no action.",
  ];
  return lines.join("\n");
}

function makeOperator(realtime, operatorConfig, getMapNodeCount) {
  let busy = false;
  let pendingLatest = null;
  let timer;

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function finish() {
    clearTimer();
    busy = false;
    const next = pendingLatest;
    pendingLatest = null;
    if (next) trigger(next);
  }

  function trigger(latest) {
    if (busy) {
      pendingLatest = latest;
      return;
    }
    const toolChoice = getMapNodeCount() === 0 ? { type: "function", name: "add_map_signal" } : "required";

    realtime.send({
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["text"],
        parallel_tool_calls: true,
        tool_choice: toolChoice,
        max_output_tokens: 650,
        tools: operatorConfig.tools,
        instructions: operatorConfig.instructions,
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: buildOperatorInput(recentTurns, latest) }],
          },
        ],
      },
    });
    busy = true;
    clearTimer();
    timer = setTimeout(finish, OPERATOR_TIMEOUT_MS);
  }

  const recentTurns = [];

  return {
    onTranscript(text) {
      recentTurns.push(text);
      if (recentTurns.length > RECENT_TURNS_KEPT) recentTurns.shift();
      trigger(text);
    },
    onResponseDone: finish,
  };
}

function resample32To24(int16) {
  const inLen = int16.length;
  const outLen = Math.floor((inLen * 3) / 4);
  const out = new Int16Array(outLen);
  for (let n = 0; n < outLen; n++) {
    const pos = (n * 4) / 3;
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = int16[i] ?? 0;
    const b = int16[i + 1] ?? a;
    out[n] = Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * frac)));
  }
  return out;
}

function makeBufferedSender(realtime) {
  let leftover = Buffer.alloc(0);

  return function send(pcm32Buf) {
    const combined = Buffer.concat([leftover, pcm32Buf]);
    const usableLen = combined.length - (combined.length % 2);
    const int16 = new Int16Array(combined.buffer, combined.byteOffset, usableLen / 2);
    const resampled = resample32To24(int16);
    const resampledBuf = Buffer.from(resampled.buffer, resampled.byteOffset, resampled.byteLength);

    let offset = 0;
    while (resampledBuf.length - offset >= BYTES_PER_FRAME) {
      const frame = resampledBuf.subarray(offset, offset + BYTES_PER_FRAME);
      realtime.send({
        type: "input_audio_buffer.append",
        audio: frame.toString("base64"),
      });
      offset += BYTES_PER_FRAME;
    }

    leftover = resampledBuf.subarray(offset);
    if (leftover.length === 0) leftover = Buffer.alloc(0);
  };
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(path);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function tailPcm(path, onChunk) {
  log(`waiting for ${path}`);
  await waitForFile(path, 60_000);
  log(`tailing ${path}`);

  const fh = await open(path, "r");
  let offset = 0;
  let buffer = Buffer.alloc(64 * 1024);

  while (true) {
    const { size } = await fh.stat();
    const available = size - offset;
    if (available <= 0) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    if (available > buffer.length) {
      buffer = Buffer.alloc(Math.max(available, buffer.length * 2));
    }
    const { bytesRead } = await fh.read({ buffer, position: offset, length: available });
    if (bytesRead > 0) {
      onChunk(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  }
}

async function connectOpenAIRealtime() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const client = new OpenAI({ apiKey });
  log(`connecting OpenAI Realtime (model=${REALTIME_MODEL})`);
  const realtime = new OpenAIRealtimeWS({ model: REALTIME_MODEL }, client);

  await new Promise((resolve, reject) => {
    realtime.socket.once("open", resolve);
    realtime.socket.once("error", reject);
  });
  log("OpenAI Realtime connected");

  realtime.send({
    type: "session.update",
    session: {
      type: "realtime",
      output_modalities: ["text"],
      instructions:
        "You are Signal Room's silent live listener. Do not answer, speak, or interrupt the room. Audio turns are transcribed; separate out-of-band tool calls update shared room state.",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: DST_RATE },
          noise_reduction: { type: "far_field" },
          transcription: {
            model: TRANSCRIPTION_MODEL,
            language: "en",
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

  return realtime;
}

async function main() {
  const roomId = await ensureRoom();
  const operatorConfig = await fetchOperatorConfig();
  const realtime = await connectOpenAIRealtime();

  let mapNodeCount = 0;
  const operator = makeOperator(realtime, operatorConfig, () => mapNodeCount);

  realtime.on("event", async (event) => {
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (text) {
        log(`transcript_final: ${text}`);
        await addTranscriptChunk(roomId, text);
        operator.onTranscript(text);
      }
    } else if (event.type === "response.function_call_arguments.done") {
      const name = typeof event.name === "string" ? event.name : "";
      const rawArguments = typeof event.arguments === "string" ? event.arguments : "{}";
      if (name) {
        await runOperatorTool(roomId, name, rawArguments);
        if (name === "add_map_signal") mapNodeCount += 1;
      }
    } else if (event.type === "response.done") {
      operator.onResponseDone();
    } else if (event.type === "error") {
      log(`openai error: ${event.error?.message || JSON.stringify(event)}`);
    }
  });

  realtime.socket.on("close", () => {
    log("OpenAI Realtime closed, exiting");
    process.exit(0);
  });

  const send = makeBufferedSender(realtime);

  try {
    await tailPcm(PCM_PATH, (chunk) => send(Buffer.from(chunk)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`tail failed: ${message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[bridge] fatal: ${message}\n`);
  process.exit(1);
});
