import { callReducer, jsonString, optionU64, parseSqlTable, querySql } from "../spacetime/cli.js";
import type { ResearchTaskRunner } from "./researchTaskRunner.js";

const DEFAULT_DATABASE = "signal-room";

export interface AskAgentOptions {
  database?: string;
  roomCode: string;
  question: string;
  runner: ResearchTaskRunner;
}

export interface AskAgentResult {
  database: string;
  roomCode: string;
  roomId: string;
  question: string;
  answer: string;
}

export async function answerQuickQuestion(options: AskAgentOptions): Promise<AskAgentResult> {
  const database = options.database ?? DEFAULT_DATABASE;
  const question = options.question.trim();
  if (!question) {
    throw new Error("question is required");
  }

  const roomId = await resolveRoomIdByCode(database, options.roomCode);

  const output = await options.runner.run({
    taskId: undefined,
    roomId: roomId.toString(),
    query: question,
    taskType: "quick_research",
    connectedNode: { id: "room", title: "Direct question" },
    urgencyHint: "high",
  });

  const answer = clean(output.summary);
  const linksJson = JSON.stringify(output.sourceLinks);

  const result = await callReducer(database, "add_finding", [
    roomId.toString(),
    optionU64(undefined),
    optionU64(undefined),
    jsonString(`Hey agent: ${capQuestion(question)}`),
    jsonString(answer),
    jsonString(linksJson),
    jsonString("high"),
  ]);

  if (!result.ok) {
    throw new Error(`add_finding failed: ${result.stderr || result.stdout}`);
  }

  return {
    database,
    roomCode: options.roomCode,
    roomId: roomId.toString(),
    question,
    answer,
  };
}

function clean(text: string): string {
  return text
    .replace(/\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capQuestion(question: string): string {
  if (question.length <= 80) return question;
  return `${question.slice(0, 77)}...`;
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
