import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const requireFromGateway = createRequire(new URL("../apps/gateway/package.json", import.meta.url));
const WebSocket = requireFromGateway("ws");

const DEFAULT_AUDIO = "/Users/bengoihman/Desktop/Downloads/Fashion Institute of Technology 3.m4a";
const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;
const FRAME_MS = 200;
const FRAME_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * (FRAME_MS / 1000);
const options = parseArgs(process.argv.slice(2));
const roomCode = options.roomCode ?? `WSAUDIO-${Date.now().toString(36).toUpperCase().slice(-6)}`;

console.log(
  `Signal Room Realtime audio smoke\nroom: ${roomCode}\ngateway: ${options.gatewayUrl}\ndatabase: ${options.database}`
);

if (!existsSync(options.file)) {
  throw new Error(`Audio file not found: ${options.file}`);
}

await assertGateway(options.gatewayUrl);
const pcmAudio = createPcmPrefix(options.file, options.seconds);
try {
  const transcript = await sendRealtimeAudio({
    audioPath: pcmAudio,
    database: options.database,
    displayName: options.displayName,
    gatewayUrl: options.gatewayUrl,
    roomCode,
  });

  assert(transcript.trim(), "expected Realtime transcription text");

  const roomId = findRoomId(options.database, roomCode);
  const transcriptChunks = rowsForRoom(options.database, "transcript_chunk", "room_id, text", roomId).length;
  const nodes = rowsForRoom(options.database, "map_node", "room_id, title", roomId).length;
  assert(transcriptChunks >= 1, "expected at least one transcript chunk in SpacetimeDB");
  assert(nodes >= 1, "expected at least one map node in SpacetimeDB");

  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode,
        roomId,
        transcript,
        transcriptChunks,
        nodes,
        url: `http://127.0.0.1:5173/?room=${encodeURIComponent(roomCode)}`,
      },
      null,
      2
    )
  );
} finally {
  rmSync(options.tempDir, { force: true, recursive: true });
}

function parseArgs(args) {
  const parsed = {
    database: "signal-room",
    displayName: "Realtime Audio Tester",
    file: existsSync(DEFAULT_AUDIO) ? DEFAULT_AUDIO : "",
    gatewayUrl: process.env.VITE_GATEWAY_URL || "http://127.0.0.1:8787",
    roomCode: undefined,
    seconds: 18,
    tempDir: mkdtempSync(join(tmpdir(), "signal-room-realtime-audio-")),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--database") {
      parsed.database = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--display-name") {
      parsed.displayName = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--file") {
      parsed.file = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--gateway-url") {
      parsed.gatewayUrl = readValue(args, index, arg).replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (arg === "--room-code") {
      parsed.roomCode = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--seconds") {
      parsed.seconds = parseSeconds(readValue(args, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!parsed.file) {
    throw new Error("Provide --file <audio path> for Realtime audio smoke");
  }

  return parsed;
}

async function assertGateway(gatewayUrl) {
  const response = await fetch(`${gatewayUrl}/health`);
  const payload = await response.json();
  assert(response.ok, `gateway health failed with ${response.status}`);
  assert(payload.ok === true, "gateway health returned ok=false");
  assert(payload.realtimeRouter?.audioMode === "openai_realtime", "gateway audioMode is not openai_realtime");
}

function createPcmPrefix(audioPath, seconds) {
  const output = join(options.tempDir, "socket-smoke.pcm");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    audioPath,
    "-t",
    String(seconds),
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-acodec",
    "pcm_s16le",
    "-f",
    "s16le",
    output,
  ]);
  return output;
}

function sendRealtimeAudio(input) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(input.gatewayUrl.replace(/^http/, "ws") + "/live-audio");
    const audio = readFileSync(input.audioPath);
    let offset = 0;
    const finalTranscripts = [];
    let stopRequested = false;
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Timed out waiting for Realtime transcript"));
    }, 90_000);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.close();
    };

    socket.on("message", (data) => {
      const payload = JSON.parse(String(data));
      if (payload.type === "ready") {
        socket.send(
          JSON.stringify({
            type: "session_start",
            roomCode: input.roomCode,
            displayName: input.displayName,
            database: input.database,
            contextTranscript: "",
          })
        );
        return;
      }

      if (payload.type === "session_started") {
        void streamFrames(
          socket,
          audio,
          () => offset,
          (nextOffset) => {
            offset = nextOffset;
          },
          () => stopRequested
        ).catch((error) => {
          cleanup();
          reject(error);
        }).then(() => {
          if (socket.readyState === WebSocket.OPEN && !stopRequested) {
            stopRequested = true;
            socket.send(JSON.stringify({ type: "session_stop" }));
          }
        });
        return;
      }

      if (payload.type === "transcript_final" && payload.text) {
        finalTranscripts.push(payload.text);
        return;
      }

      if (payload.type === "closed" && finalTranscripts.length > 0) {
        cleanup();
        resolve(finalTranscripts.join("\n\n"));
        return;
      }

      if (payload.type === "error" || payload.ok === false) {
        cleanup();
        reject(new Error(payload.message || "Realtime audio socket failed"));
      }
    });
    socket.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}

async function streamFrames(socket, audio, getOffset, setOffset, shouldStop) {
  while (socket.readyState === WebSocket.OPEN && !shouldStop() && getOffset() < audio.length) {
    const offset = getOffset();
    const frame = audio.subarray(offset, Math.min(offset + FRAME_BYTES, audio.length));
    socket.send(JSON.stringify({ type: "audio_pcm", audioBase64: frame.toString("base64") }));
    setOffset(offset + FRAME_BYTES);
    await sleep(FRAME_MS);
  }

  const silence = Buffer.alloc(FRAME_BYTES * 5);
  for (let index = 0; socket.readyState === WebSocket.OPEN && !shouldStop() && index < 5; index += 1) {
    socket.send(JSON.stringify({ type: "audio_pcm", audioBase64: silence.subarray(0, FRAME_BYTES).toString("base64") }));
    await sleep(FRAME_MS);
  }
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseSeconds(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 3 || parsed > 45) {
    throw new Error("--seconds must be an integer from 3 to 45");
  }
  return parsed;
}

function findRoomId(database, code) {
  const rows = sqlRows(database, "SELECT room_id, code FROM room");
  const normalized = code.trim().toUpperCase();
  const match = rows.find((row) => row[1] === normalized);
  assert(match, `room ${normalized} was not found in SpacetimeDB`);
  return match[0];
}

function rowsForRoom(database, table, fields, roomId) {
  return sqlRows(database, `SELECT ${fields} FROM ${table}`).filter((row) => row[0] === roomId);
}

function sqlRows(database, sql) {
  const stdout = execFileSync("spacetime", ["sql", database, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseSqlTable(stdout);
}

function parseSqlTable(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|") && !/^-+\+/.test(line))
    .slice(1)
    .map((line) => line.split("|").map((cell) => stripSqlCell(cell.trim())));
}

function stripSqlCell(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  const optionMatch = value.match(/^\(some = (.+)\)$/);
  if (optionMatch) return stripSqlCell(optionMatch[1].trim());
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
