import type { ResearchTaskRunner } from "./researchTaskRunner.js";
import { callReducer, parseSqlTable, querySql, type ReducerCallResult } from "../spacetime/cli.js";
import { writeResearchResultToSpacetime, type SpacetimeWritebackResult } from "../spacetime/writeback.js";

const DEFAULT_DATABASE = "signal-room";

export interface TaskWorkerOptions {
  database?: string;
  roomCode?: string;
  runner: ResearchTaskRunner;
}

export interface TaskWorkerBatchOptions extends TaskWorkerOptions {
  maxTasks: number;
}

export interface TaskWorkerBatchResult {
  database: string;
  roomCode?: string;
  maxTasks: number;
  workedCount: number;
  results: TaskWorkerResult[];
}

export interface TaskWorkerLoopOptions extends TaskWorkerOptions {
  intervalMs?: number;
  maxTasksPerTick?: number;
}

export interface TaskWorkerLoopHandle {
  stop: () => void;
}

export interface TaskWorkerResult {
  database: string;
  worked: boolean;
  reason?: string;
  task?: {
    taskId: string;
    roomId: string;
    nodeId?: string;
    taskType: string;
    instructions: string;
    priority: number;
    nodeTitle?: string;
  };
  claim?: ReducerCallResult;
  writeback?: SpacetimeWritebackResult;
  failureComplete?: ReducerCallResult;
}

interface QueuedTask {
  taskId: bigint;
  roomId: bigint;
  nodeId?: bigint;
  taskType: string;
  instructions: string;
  priority: number;
}

interface NodeRow {
  nodeId: bigint;
  roomId: bigint;
  title: string;
}

export async function workOneQueuedTask(options: TaskWorkerOptions): Promise<TaskWorkerResult> {
  const database = options.database ?? DEFAULT_DATABASE;
  const roomIdFilter = options.roomCode
    ? await resolveRoomIdByCode(database, options.roomCode)
    : undefined;
  const task = await findQueuedTask(database, roomIdFilter);

  if (!task) {
    return {
      database,
      worked: false,
      reason: roomIdFilter
        ? `No queued task found in room ${options.roomCode}`
        : "No queued task found",
    };
  }

  const node = task.nodeId === undefined ? undefined : await resolveNode(database, task.nodeId);
  const claim = await callReducer(database, "claim_agent_task", [task.taskId.toString()]);
  if (!claim.ok) {
    return {
      database,
      worked: false,
      reason: claim.stderr || claim.stdout || "Unable to claim queued task",
      task: taskSummary(task, node),
      claim,
    };
  }

  try {
    const output = await options.runner.run({
      taskId: task.taskId.toString(),
      roomId: task.roomId.toString(),
      query: task.instructions,
      taskType: task.taskType,
      connectedNode: {
        id: task.nodeId?.toString() ?? "room",
        title: node?.title ?? "Room",
      },
      urgencyHint: task.priority > 1 ? "high" : "medium",
    });

    const writeback = await writeResearchResultToSpacetime({
      database,
      roomId: task.roomId,
      nodeId: task.nodeId,
      taskId: task.taskId,
      output,
    });

    return {
      database,
      worked: true,
      task: taskSummary(task, node),
      claim,
      writeback,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown worker failure";
    const failureComplete = await callReducer(database, "complete_agent_task", [
      task.taskId.toString(),
      JSON.stringify("failed"),
      JSON.stringify(message),
    ]);

    return {
      database,
      worked: false,
      reason: message,
      task: taskSummary(task, node),
      claim,
      failureComplete,
    };
  }
}

export async function workQueuedTasks(options: TaskWorkerBatchOptions): Promise<TaskWorkerBatchResult> {
  const maxTasks = validateMaxTasks(options.maxTasks);
  const results: TaskWorkerResult[] = [];
  let workedCount = 0;

  for (let index = 0; index < maxTasks; index += 1) {
    const result = await workOneQueuedTask(options);
    results.push(result);
    if (!result.worked) {
      break;
    }
    workedCount += 1;
  }

  return {
    database: options.database ?? DEFAULT_DATABASE,
    roomCode: options.roomCode,
    maxTasks,
    workedCount,
    results,
  };
}

export function startQueuedTaskWorkerLoop(options: TaskWorkerLoopOptions): TaskWorkerLoopHandle {
  const intervalMs = Math.max(1500, options.intervalMs ?? 3500);
  const maxTasksPerTick = validateMaxTasks(options.maxTasksPerTick ?? 3);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await workQueuedTasks({
        ...options,
        maxTasks: maxTasksPerTick,
      });
      if (result.workedCount > 0) {
        console.log(
          JSON.stringify({
            ok: true,
            component: "task_worker_loop",
            workedCount: result.workedCount,
            roomCode: options.roomCode,
          })
        );
      }
    } catch (error: unknown) {
      console.warn(
        JSON.stringify({
          ok: false,
          component: "task_worker_loop",
          message: error instanceof Error ? error.message : "Task worker loop failed",
        })
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();

  return {
    stop: () => clearInterval(timer),
  };
}

async function findQueuedTask(
  database: string,
  roomIdFilter: bigint | undefined
): Promise<QueuedTask | undefined> {
  const rows = parseSqlTable(
    await querySql(database, "SELECT task_id, room_id, node_id, task_type, instructions, status, priority FROM agent_task")
  );
  const queued = rows
    .map(parseQueuedTask)
    .filter((task): task is QueuedTask => Boolean(task))
    .filter((task) => roomIdFilter === undefined || task.roomId === roomIdFilter)
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

async function resolveNode(database: string, nodeId: bigint): Promise<NodeRow | undefined> {
  const rows = parseSqlTable(await querySql(database, "SELECT node_id, room_id, title FROM map_node"));
  const match = rows.find((row) => row[0] === nodeId.toString());
  if (!match) return undefined;

  return {
    nodeId: BigInt(match[0]),
    roomId: BigInt(match[1]),
    title: match[2],
  };
}

function parseOptionalBigInt(value: string): bigint | undefined {
  if (!value || value === "none" || value === "(none)") return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  return BigInt(value);
}

function taskSummary(task: QueuedTask, node: NodeRow | undefined): NonNullable<TaskWorkerResult["task"]> {
  return {
    taskId: task.taskId.toString(),
    roomId: task.roomId.toString(),
    nodeId: task.nodeId?.toString(),
    taskType: task.taskType,
    instructions: task.instructions,
    priority: task.priority,
    nodeTitle: node?.title,
  };
}

function validateMaxTasks(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("maxTasks must be an integer from 1 to 10");
  }
  return value;
}
