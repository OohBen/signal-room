#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { createExaResearchClient } from "./clients/exa.js";
import { getGatewayRuntimeEnv, loadAiEnv } from "./config/env.js";
import { buildHealthPayload, startHealthServer } from "./http/health.js";
import { createOpenAiRealtimeRouter } from "./realtime/router.js";
import { mintRealtimeToken } from "./realtime/realtimeToken.js";
import { createTranscriptRouter } from "./realtime/transcriptRouter.js";
import { replayTranscript } from "./spacetime/replayTranscript.js";
import { writeResearchResultToSpacetime } from "./spacetime/writeback.js";
import { workOneQueuedTask, workQueuedTasks } from "./tasks/taskWorker.js";
import { runRoomSwarm } from "./tasks/swarm.js";
import { runRoomFleet } from "./tasks/fleet.js";
import { ResearchTaskRunner } from "./tasks/researchTaskRunner.js";
import { answerQuickQuestion } from "./tasks/askAgent.js";

type Command =
  | "serve"
  | "health"
  | "smoke"
  | "research"
  | "replay-transcript"
  | "work-once"
  | "work-batch"
  | "fleet"
  | "ask"
  | "help";

interface CliOptions {
  command: Command;
  query?: string;
  nodeId?: string;
  roomId?: string;
  taskId?: string;
  database?: string;
  writeBack: boolean;
  roomCode?: string;
  displayName: string;
  delayMs: number;
  transcript?: string;
  transcriptFile?: string;
  routerModel?: string;
  maxTasks: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    printHelp();
    return;
  }

  const envFile = await loadAiEnv();
  const runtimeEnv = getGatewayRuntimeEnv(envFile);
  const routeTranscript = createTranscriptRouter({
    model: options.routerModel,
  });

  if (options.command === "serve") {
    startHealthServer({
      runtimeEnv,
      port: parsePort(process.env.PORT),
      replayTranscript: async (request) =>
        replayTranscript({
          database: request.database ?? options.database,
          roomCode: request.roomCode,
          displayName: request.displayName ?? options.displayName,
          transcript: request.transcript,
          delayMs: request.delayMs ?? options.delayMs,
          routeTranscript,
        }),
      workRoom: async (request) => {
        const runner = new ResearchTaskRunner(createExaResearchClient());
        return runRoomSwarm({
          database: request.database ?? options.database,
          roomCode: request.roomCode,
          runner,
          workerCount: request.workerCount,
        });
      },
      fleet: async (request) => {
        const runner = new ResearchTaskRunner(createExaResearchClient());
        return runRoomFleet({
          database: request.database ?? options.database,
          roomCode: request.roomCode,
          runner,
        });
      },
      ask: async (request) => {
        const runner = new ResearchTaskRunner(createExaResearchClient());
        return answerQuickQuestion({
          database: request.database ?? options.database,
          roomCode: request.roomCode,
          question: request.question,
          runner,
        });
      },
      realtimeToken: async () => mintRealtimeToken(),
    });
    return;
  }

  if (options.command === "health") {
    console.log(JSON.stringify(buildHealthPayload(runtimeEnv), null, 2));
    return;
  }

  if (options.command === "replay-transcript") {
    const transcript = await readTranscriptInput(options);
    const output = await replayTranscript({
      database: options.database,
      roomCode: options.roomCode ?? buildDefaultRoomCode(),
      displayName: options.displayName,
      transcript,
      delayMs: options.delayMs,
      routeTranscript,
    });
    console.log(JSON.stringify({ ok: true, replay: output }, null, 2));
    return;
  }

  if (options.command === "work-once") {
    const runner = new ResearchTaskRunner(createExaResearchClient());
    const output = await workOneQueuedTask({
      database: options.database,
      roomCode: options.roomCode,
      runner,
    });
    console.log(JSON.stringify({ ok: true, worker: output }, null, 2));
    return;
  }

  if (options.command === "work-batch") {
    const runner = new ResearchTaskRunner(createExaResearchClient());
    const output = await workQueuedTasks({
      database: options.database,
      roomCode: options.roomCode,
      maxTasks: options.maxTasks,
      runner,
    });
    console.log(JSON.stringify({ ok: true, worker: output }, null, 2));
    return;
  }

  if (options.command === "fleet") {
    if (!options.roomCode) {
      throw new Error("fleet requires --room-code <code>");
    }
    const runner = new ResearchTaskRunner(createExaResearchClient());
    const output = await runRoomFleet({
      database: options.database,
      roomCode: options.roomCode,
      runner,
    });
    console.log(JSON.stringify({ ok: true, fleet: output }, null, 2));
    return;
  }

  if (options.command === "ask") {
    if (!options.roomCode) {
      throw new Error("ask requires --room-code <code>");
    }
    if (!options.query) {
      throw new Error("ask requires --query <question>");
    }
    const runner = new ResearchTaskRunner(createExaResearchClient());
    const output = await answerQuickQuestion({
      database: options.database,
      roomCode: options.roomCode,
      question: options.query,
      runner,
    });
    console.log(JSON.stringify({ ok: true, ask: output }, null, 2));
    return;
  }

  if (options.command === "smoke" || options.command === "research") {
    const query = options.query ?? "SpacetimeDB realtime collaborative research demo risks";
    const runner = new ResearchTaskRunner(createExaResearchClient());
    const output = await runner.run({
      taskId: options.taskId ?? (options.command === "smoke" ? "smoke-task" : undefined),
      roomId: options.roomId,
      query,
      connectedNode: {
        id: options.nodeId ?? "demo-node",
        title: "Demo node",
      },
    });

    const router = createOpenAiRealtimeRouter();
    const writeback =
      options.writeBack && options.roomId
        ? await writeResearchResultToSpacetime({
            database: options.database,
            roomId: parseBigIntOption(options.roomId, "--room"),
            nodeId: options.nodeId ? parseBigIntOption(options.nodeId, "--node") : undefined,
            taskId: options.taskId ? parseBigIntOption(options.taskId, "--task") : undefined,
            output,
          })
        : undefined;

    console.log(JSON.stringify({ ok: true, routerPolicy: router.policy, research: output, writeback }, null, 2));
  }
}

function parseArgs(args: string[]): CliOptions {
  const command = normalizeCommand(args[0]);
  let query: string | undefined;
  let nodeId: string | undefined;
  let roomId: string | undefined;
  let taskId: string | undefined;
  let database: string | undefined;
  let writeBack = false;
  let roomCode: string | undefined;
  let displayName = "Gateway Agent";
  let delayMs = 1200;
  let transcript: string | undefined;
  let transcriptFile: string | undefined;
  let routerModel: string | undefined;
  let maxTasks = 1;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--query") {
      query = readOptionValue(args, index, "--query");
      index += 1;
      continue;
    }

    if (arg === "--node") {
      nodeId = readOptionValue(args, index, "--node");
      index += 1;
      continue;
    }

    if (arg === "--room") {
      roomId = readOptionValue(args, index, "--room");
      index += 1;
      continue;
    }

    if (arg === "--task") {
      taskId = readOptionValue(args, index, "--task");
      index += 1;
      continue;
    }

    if (arg === "--database") {
      database = readOptionValue(args, index, "--database");
      index += 1;
      continue;
    }

    if (arg === "--write-back") {
      writeBack = true;
      continue;
    }

    if (arg === "--room-code") {
      roomCode = readOptionValue(args, index, "--room-code");
      index += 1;
      continue;
    }

    if (arg === "--display-name") {
      displayName = readOptionValue(args, index, "--display-name");
      index += 1;
      continue;
    }

    if (arg === "--delay-ms") {
      delayMs = parseDelay(readOptionValue(args, index, "--delay-ms"));
      index += 1;
      continue;
    }

    if (arg === "--transcript") {
      transcript = readOptionValue(args, index, "--transcript");
      index += 1;
      continue;
    }

    if (arg === "--file") {
      const filePath = readOptionValue(args, index, "--file");
      transcriptFile = filePath;
      index += 1;
      continue;
    }

    if (arg === "--router-model") {
      routerModel = readOptionValue(args, index, "--router-model");
      index += 1;
      continue;
    }

    if (arg === "--max-tasks") {
      maxTasks = parseMaxTasks(readOptionValue(args, index, "--max-tasks"));
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    command,
    query,
    nodeId,
    roomId,
    taskId,
    database,
    writeBack,
    roomCode,
    displayName,
    delayMs,
    transcript,
    transcriptFile,
    routerModel,
    maxTasks,
  };
}

function normalizeCommand(command: string | undefined): Command {
  if (command === undefined) {
    return "help";
  }

  if (
    command === "serve" ||
    command === "health" ||
    command === "smoke" ||
    command === "research" ||
    command === "replay-transcript" ||
    command === "work-once" ||
    command === "work-batch" ||
    command === "fleet" ||
    command === "ask" ||
    command === "help"
  ) {
    return command;
  }

  throw new Error(`Unknown command: ${command}`);
}

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  return parsed;
}

function parseBigIntOption(raw: string, name: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an unsigned integer when --write-back is used`);
  }

  return BigInt(raw);
}

function parseDelay(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 30_000) {
    throw new Error("--delay-ms must be an integer from 0 to 30000");
  }
  return parsed;
}

function parseMaxTasks(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("--max-tasks must be an integer from 1 to 10");
  }
  return parsed;
}

async function readTranscriptInput(options: CliOptions): Promise<string> {
  if (options.transcript) {
    return options.transcript;
  }

  if (options.transcriptFile) {
    return readFile(options.transcriptFile, "utf8");
  }

  throw new Error("replay-transcript requires --file <path> or --transcript <text>");
}

function buildDefaultRoomCode(): string {
  return `LIVE-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function printHelp(): void {
  console.log(`Signal Room agent gateway

Commands:
  serve              Start the local health endpoint on /health.
  health             Print sanitized health JSON.
  smoke              Run a deterministic research task smoke check.
  research           Run a research task; uses EXA_API_KEY when available.
  replay-transcript  Replay a transcript into a live room, deriving map nodes and agent tasks.
  work-once          Claim one queued SpacetimeDB agent task, run research, and write back.
  work-batch         Claim up to --max-tasks queued tasks, filtered by --room-code when provided.
  fleet              Run the hierarchical agent fleet over a room's mind map: leaf research, branch and root synthesis.
  ask                Answer a quick "Hey agent" question directly and post it as a finding. Requires --room-code and --query.

Options:
  --query <query>    Research query for smoke/research.
  --node <id>        Connected map node id. Use numeric SpacetimeDB node id with --write-back.
  --room <id>        Numeric SpacetimeDB room id for --write-back.
  --room-code <code> Room code for replay-transcript. Defaults to a unique LIVE-* code.
                     For work-once/work-batch, filters queued tasks to this room code.
  --display-name <n> Display name used for room creation.
  --delay-ms <ms>    Delay between replay steps. Defaults to 1200.
  --file <path>      Transcript file for replay-transcript.
  --router-model <m> OpenRouter model for transcript routing. Defaults to inception/mercury-2.
  --max-tasks <n>    Maximum tasks for work-batch or /work-room. Defaults to 1, max 10.
  --transcript <txt> Inline transcript text for replay-transcript.
  --task <id>        Optional numeric SpacetimeDB task id to complete during --write-back.
  --database <name>  SpacetimeDB database name. Defaults to signal-room.
  --write-back       Write research output and finding rows back to SpacetimeDB.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown gateway error";
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exitCode = 1;
});
