import type { ResearchTaskOutput, Urgency } from "../tasks/researchTaskRunner.js";
import { callReducer, jsonString, optionU64, type ReducerCallResult } from "./cli.js";

const DEFAULT_DATABASE = "signal-room";

export interface SpacetimeWritebackInput {
  database?: string;
  roomId: bigint;
  nodeId?: bigint;
  taskId?: bigint;
  output: ResearchTaskOutput;
}

export interface SpacetimeWritebackResult {
  database: string;
  roomId: string;
  nodeId?: string;
  taskId?: string;
  calls: ReducerCallResult[];
}

export async function writeResearchResultToSpacetime(
  input: SpacetimeWritebackInput
): Promise<SpacetimeWritebackResult> {
  const database = input.database ?? DEFAULT_DATABASE;
  const linksJson = JSON.stringify(input.output.sourceLinks);
  const urgency = toSpacetimeUrgency(input.output.urgency);
  const calls: ReducerCallResult[] = [];

  calls.push(
    await callReducer(database, "add_agent_output", [
      input.roomId.toString(),
      optionU64(input.taskId),
      optionU64(input.nodeId),
      jsonString("research"),
      jsonString(input.output.summary),
      jsonString(buildDetails(input.output)),
      jsonString(linksJson),
      jsonString(urgency),
      jsonString(input.output.suggestedMapUpdate.title),
      jsonString(input.output.suggestedMapUpdate.summary),
    ])
  );

  calls.push(
    await callReducer(database, "add_finding", [
      input.roomId.toString(),
      optionU64(input.nodeId),
      optionU64(undefined),
      jsonString(input.output.suggestedMapUpdate.title),
      jsonString(input.output.summary),
      jsonString(linksJson),
      jsonString(urgency),
    ])
  );

  if (input.taskId !== undefined) {
    calls.push(
      await callReducer(database, "complete_agent_task", [
        input.taskId.toString(),
        jsonString("completed"),
        jsonString(input.output.summary),
      ])
    );
  }

  const failed = calls.find((call) => !call.ok);
  if (failed) {
    throw new Error(
      `SpacetimeDB writeback failed in ${failed.reducer}: ${failed.stderr || failed.stdout}`
    );
  }

  return {
    database,
    roomId: input.roomId.toString(),
    nodeId: input.nodeId?.toString(),
    taskId: input.taskId?.toString(),
    calls,
  };
}

function toSpacetimeUrgency(urgency: Urgency): string {
  if (urgency === "high") return "high";
  if (urgency === "medium") return "watch";
  return "normal";
}

function buildDetails(output: ResearchTaskOutput): string {
  const links = output.sourceLinks
    .map((source, index) => `${index + 1}. ${source.title} - ${source.url}`)
    .join("\n");

  return [`Provider: ${output.provider}`, `Mode: ${output.mode}`, `Completed: ${output.completedAt}`, "", links].join(
    "\n"
  );
}
