import type { ResearchTaskRunner } from "./researchTaskRunner.js";
import { callReducer, jsonString, optionU64, parseSqlTable, querySql } from "../spacetime/cli.js";
import { writeResearchResultToSpacetime } from "../spacetime/writeback.js";

const DEFAULT_DATABASE = "signal-room";
const DEFAULT_WORKER_COUNT = 3;
const DETAIL_MAX_LENGTH = 70;
const ROOM_CONTEXT_MAX_LENGTH = 1800;
const MAP_CONTEXT_MAX_LENGTH = 1200;

interface RosterWorker {
  name: string;
  persona: string;
}

const WORKER_ROSTER: RosterWorker[] = [
  { name: "Scout", persona: "quick" },
  { name: "Analyst", persona: "deep" },
  { name: "Verifier", persona: "quick" },
];

export interface RoomSwarmOptions {
  database?: string;
  roomCode: string;
  runner: ResearchTaskRunner;
  workerCount?: number;
}

export interface RoomSwarmResult {
  database: string;
  roomCode: string;
  roomId: string;
  totalCompleted: number;
  workers: { name: string; completed: number }[];
}

interface QueuedTask {
  taskId: bigint;
  roomId: bigint;
  nodeId?: bigint;
  taskType: string;
  instructions: string;
  priority: number;
}

interface RoomResearchContext {
  roomTitle: string;
  rootTitle?: string;
  rootSummary?: string;
  transcript: string;
  nodes: Map<string, RoomContextNode>;
}

interface RoomContextNode {
  id: bigint;
  nodeType: string;
  title: string;
  summary: string;
}

export async function runRoomSwarm(options: RoomSwarmOptions): Promise<RoomSwarmResult> {
  const database = options.database ?? DEFAULT_DATABASE;
  const workerCount = clampWorkerCount(options.workerCount ?? DEFAULT_WORKER_COUNT);
  const roomId = await resolveRoomIdByCode(database, options.roomCode);
  const roomContext = await loadRoomResearchContext(database, roomId);
  const roster = WORKER_ROSTER.slice(0, workerCount);

  const setWorker = async (
    name: string,
    persona: string,
    status: string,
    detail: string,
    currentTaskId: bigint | undefined,
    currentNodeId: bigint | undefined,
    completed: number
  ): Promise<void> => {
    await callReducer(database, "upsert_agent_worker", [
      roomId.toString(),
      jsonString(name),
      jsonString(persona),
      jsonString(status),
      jsonString(truncateDetail(detail)),
      optionU64(currentTaskId),
      optionU64(currentNodeId),
      String(completed),
    ]);
  };

  for (const worker of roster) {
    await setWorker(worker.name, worker.persona, "idle", "Ready", undefined, undefined, 0);
  }

  // Co-located workers share one SpacetimeDB CLI identity, so the reducer-level
  // claim guard cannot tell them apart. Reserve task ids in-process so two
  // workers never research the same task (which would write duplicate findings).
  const reserved = new Set<string>();

  const workers = await Promise.all(
    roster.map(async (worker) => {
      let completed = 0;
      let emptyPolls = 0;

      while (emptyPolls < 2) {
        const task = await findQueuedTask(database, roomId, reserved);

        if (!task) {
          await setWorker(worker.name, worker.persona, "idle", "Waiting for work", undefined, undefined, completed);
          emptyPolls += 1;
          await wait(500);
          continue;
        }

        // Synchronous reserve: no await between has() and add() => atomic in JS.
        const taskKey = task.taskId.toString();
        if (reserved.has(taskKey)) {
          await wait(150);
          continue;
        }
        reserved.add(taskKey);

        emptyPolls = 0;
        const nodeInfo = task.nodeId === undefined ? undefined : roomContext.nodes.get(task.nodeId.toString());
        const short = shortLabel(task.instructions);

        await setWorker(
          worker.name,
          worker.persona,
          "claiming",
          `Claiming: ${short}`,
          task.taskId,
          task.nodeId,
          completed
        );

        const claim = await callReducer(database, "claim_agent_task", [task.taskId.toString()]);
        if (!claim.ok) {
          reserved.delete(taskKey);
          await setWorker(worker.name, worker.persona, "idle", "Ready", undefined, undefined, completed);
          await wait(250);
          continue;
        }

        await setWorker(
          worker.name,
          worker.persona,
          "researching",
          `Researching: ${short}`,
          task.taskId,
          task.nodeId,
          completed
        );
        await wait(500);

        let output;
        try {
          output = await options.runner.run({
            taskId: task.taskId.toString(),
            roomId: roomId.toString(),
            query: task.instructions,
            taskType: task.taskType,
            connectedNode: {
              id: task.nodeId?.toString() ?? "room",
              title: nodeInfo?.title ?? "Room",
            },
            connectedNodeSummary: nodeInfo?.summary,
            rootQuestion: roomContext.rootTitle ?? roomContext.roomTitle,
            roomContext: roomContext.transcript,
            mapContext: buildMapContext(roomContext, task.nodeId),
            urgencyHint: task.priority > 1 ? "high" : "medium",
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown worker failure";
          await callReducer(database, "complete_agent_task", [
            task.taskId.toString(),
            jsonString("failed"),
            jsonString(message),
          ]);
          await setWorker(worker.name, worker.persona, "idle", "Task failed", undefined, undefined, completed);
          continue;
        }

        await setWorker(worker.name, worker.persona, "writing", "Writing finding", task.taskId, task.nodeId, completed);

        await writeResearchResultToSpacetime({
          database,
          roomId,
          nodeId: task.nodeId,
          taskId: task.taskId,
          output,
        });

        completed += 1;
        await setWorker(worker.name, worker.persona, "done", `Done: ${short}`, undefined, task.nodeId, completed);
        await wait(600);
      }

      await setWorker(worker.name, worker.persona, "idle", "Idle", undefined, undefined, completed);
      return { name: worker.name, completed };
    })
  );

  return {
    database,
    roomCode: options.roomCode,
    roomId: roomId.toString(),
    totalCompleted: workers.reduce((sum, worker) => sum + worker.completed, 0),
    workers,
  };
}

async function findQueuedTask(
  database: string,
  roomId: bigint,
  reserved: Set<string>
): Promise<QueuedTask | undefined> {
  const rows = parseSqlTable(
    await querySql(
      database,
      "SELECT task_id, room_id, node_id, task_type, instructions, status, priority FROM agent_task"
    )
  );
  const queued = rows
    .map(parseQueuedTask)
    .filter((task): task is QueuedTask => Boolean(task))
    .filter((task) => task.roomId === roomId)
    .filter((task) => !reserved.has(task.taskId.toString()))
    .sort((a, b) => b.priority - a.priority || Number(b.taskId - a.taskId));

  return queued[0];
}

function parseQueuedTask(row: string[]): QueuedTask | undefined {
  if (row.length < 7 || row[5] !== "queued") return undefined;

  return {
    taskId: BigInt(row[0]),
    roomId: BigInt(row[1]),
    nodeId: parseOptionalBigInt(row[2]),
    taskType: row[3],
    instructions: row[4],
    priority: Number.parseInt(row[6], 10),
  };
}

async function resolveRoomIdByCode(database: string, roomCode: string): Promise<bigint> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, code FROM room"));
  const normalized = roomCode.trim().toUpperCase();
  const match = rows.find((row) => row[1] === normalized);
  if (!match) {
    throw new Error(`Room ${normalized} not found`);
  }
  return BigInt(match[0]);
}

function parseOptionalBigInt(value: string): bigint | undefined {
  if (!value || value === "none" || value === "(none)") return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  return BigInt(value);
}

function shortLabel(instructions: string): string {
  const normalized = instructions.trim().replace(/\s+/g, " ");
  if (normalized.length <= 40) return normalized;
  return `${normalized.slice(0, 37)}...`;
}

function truncateDetail(detail: string): string {
  if (detail.length <= DETAIL_MAX_LENGTH) return detail;
  return `${detail.slice(0, DETAIL_MAX_LENGTH - 1)}...`;
}

function clampWorkerCount(value: number): number {
  if (!Number.isInteger(value) || value < 1) return 1;
  if (value > WORKER_ROSTER.length) return WORKER_ROSTER.length;
  return value;
}

async function loadRoomResearchContext(database: string, roomId: bigint): Promise<RoomResearchContext> {
  const roomRows = parseSqlTable(await querySql(database, "SELECT room_id, title FROM room"));
  const roomTitle = roomRows.find((row) => row[0] === roomId.toString())?.[1] ?? `Room ${roomId.toString()}`;

  const nodeRows = parseSqlTable(
    await querySql(database, "SELECT node_id, room_id, node_type, title, summary FROM map_node")
  );
  const nodes = new Map<string, RoomContextNode>();
  for (const row of nodeRows) {
    if (row.length < 5 || row[1] !== roomId.toString()) continue;
    const id = BigInt(row[0]);
    nodes.set(id.toString(), {
      id,
      nodeType: row[2],
      title: row[3],
      summary: row[4],
    });
  }

  const root = [...nodes.values()].find((node) => node.nodeType.toLowerCase() === "root") ?? [...nodes.values()][0];
  const transcriptRows = parseSqlTable(await querySql(database, "SELECT room_id, text FROM transcript_chunk"));
  const transcript = transcriptRows
    .filter((row) => row.length >= 2 && row[0] === roomId.toString())
    .map((row) => row[1])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    roomTitle,
    rootTitle: root?.title,
    rootSummary: root?.summary,
    transcript: capFromEnd(transcript, ROOM_CONTEXT_MAX_LENGTH),
    nodes,
  };
}

function buildMapContext(context: RoomResearchContext, connectedNodeId: bigint | undefined): string {
  const connected = connectedNodeId === undefined ? undefined : context.nodes.get(connectedNodeId.toString());
  const lines = [
    `Room title: ${context.roomTitle}`,
    context.rootTitle ? `Root question: ${context.rootTitle}` : "",
    context.rootSummary ? `Root summary: ${context.rootSummary}` : "",
    connected ? `Connected node: ${connected.nodeType} - ${connected.title}: ${connected.summary}` : "",
    "Other map nodes:",
    ...[...context.nodes.values()]
      .filter((node) => node.id !== connectedNodeId)
      .slice(0, 8)
      .map((node) => `- ${node.nodeType}: ${node.title}${node.summary ? ` - ${node.summary}` : ""}`),
  ].filter(Boolean);

  return capText(lines.join("\n"), MAP_CONTEXT_MAX_LENGTH);
}

function capText(value: string, maxLength: number): string {
  const clean = value.trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

function capFromEnd(value: string, maxLength: number): string {
  const clean = value.trim();
  if (clean.length <= maxLength) return clean;
  return `...${clean.slice(clean.length - maxLength + 3)}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
