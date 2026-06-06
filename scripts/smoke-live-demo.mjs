import { execFileSync } from "node:child_process";

const DEFAULT_TRANSCRIPT =
  "We are trying to predict when the Strait of Hormuz reopens. Agent, look up China and India public positions on the Iran conflict. Oil prices should fall if ceasefire talks become credible.";

const options = parseArgs(process.argv.slice(2));
const roomCode = options.roomCode ?? `SMOKE-${Date.now().toString(36).toUpperCase().slice(-6)}`;

console.log(`Signal Room live smoke\nroom: ${roomCode}\ngateway: ${options.gatewayUrl}\ndatabase: ${options.database}`);

await assertGateway(options.gatewayUrl);
const replay = await postJson(`${options.gatewayUrl}/replay-transcript`, {
  roomCode,
  displayName: options.displayName,
  database: options.database,
  delayMs: 0,
  transcript: options.transcript,
});
assert(replay.ok === true, "replay-transcript returned ok=false");

const work = await postJson(`${options.gatewayUrl}/work-room`, {
  roomCode,
  database: options.database,
  maxTasks: options.maxTasks,
  forceMock: options.forceMock,
});
assert(work.ok === true, "work-room returned ok=false");

const roomId = findRoomId(options.database, roomCode);
const evidence = {
  roomId,
  transcriptChunks: rowsForRoom(options.database, "transcript_chunk", "room_id, text", roomId).length,
  nodes: rowsForRoom(options.database, "map_node", "room_id, title", roomId).length,
  tasks: rowsForRoom(options.database, "agent_task", "room_id, status, instructions", roomId),
  findings: rowsForRoom(options.database, "finding", "room_id, title", roomId),
};

const completedTasks = evidence.tasks.filter((row) => row[1] === "completed");
assert(evidence.transcriptChunks >= 1, "expected at least one transcript chunk");
assert(evidence.nodes >= 3, "expected at least three map nodes");
assert(evidence.tasks.length >= 1, "expected at least one agent task");
assert(completedTasks.length >= 1, "expected at least one completed agent task");
assert(evidence.findings.length >= 1, "expected at least one finding");

console.log(
  JSON.stringify(
    {
      ok: true,
      roomCode,
      roomId,
      replaySteps: replay.result?.steps?.length ?? null,
      workedCount: work.result?.workedCount ?? null,
      transcriptChunks: evidence.transcriptChunks,
      nodes: evidence.nodes,
      tasks: evidence.tasks.length,
      completedTasks: completedTasks.length,
      findings: evidence.findings.length,
      url: `http://127.0.0.1:5173/?room=${encodeURIComponent(roomCode)}`,
    },
    null,
    2
  )
);

function parseArgs(args) {
  const parsed = {
    database: "signal-room",
    displayName: "Smoke Tester",
    forceMock: true,
    gatewayUrl: process.env.VITE_GATEWAY_URL || "http://127.0.0.1:8787",
    maxTasks: 1,
    roomCode: undefined,
    transcript: DEFAULT_TRANSCRIPT,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--real-research") {
      parsed.forceMock = false;
      continue;
    }
    if (arg === "--mock") {
      parsed.forceMock = true;
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
    if (arg === "--gateway-url") {
      parsed.gatewayUrl = readValue(args, index, arg).replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (arg === "--max-tasks") {
      parsed.maxTasks = parseMaxTasks(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--room-code") {
      parsed.roomCode = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--transcript") {
      parsed.transcript = readValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function readValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parseMaxTasks(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("--max-tasks must be an integer from 1 to 10");
  }
  return parsed;
}

async function assertGateway(gatewayUrl) {
  const health = await fetchJson(`${gatewayUrl}/health`);
  assert(health.ok === true, "gateway health returned ok=false");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
