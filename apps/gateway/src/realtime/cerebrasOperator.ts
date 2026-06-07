import { getSecret } from "../config/env.js";
import {
  ACTION_REALTIME_ROOM_TOOLS,
  buildOperatorInput,
  buildOperatorInstructions,
} from "./operatorConfig.js";
import {
  handleRealtimeRoomTool,
  readRealtimeRoomSnapshot,
  type RealtimeRoomContext,
} from "./realtimeRoomTools.js";

const QUICK_QUESTION_GUIDANCE =
  "QUICK QUESTIONS: If the latest turn is a standalone quick factual question the room wants answered (e.g. 'how did people die in World War II?', 'what is X', 'when did Y happen') rather than a question that frames the room's ongoing debate, call summon_quick_agent with that question as the task so it gets researched and answered in the feed. Do NOT create a kind='question' map card for such quick lookups. Reserve kind='question' for open questions that genuinely structure the discussion.";

interface ChatToolFunction {
  name: string;
  description?: string;
  parameters: unknown;
}

interface ChatTool {
  type: "function";
  function: ChatToolFunction;
}

interface ChatToolChoice {
  type: "function";
  function: { name: string };
}

interface ChatToolCall {
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      tool_calls?: ChatToolCall[];
    };
  }>;
}

export async function runCerebrasOperator(input: {
  database?: string;
  roomCode: string;
  transcript: string;
  recentContext?: string;
}): Promise<{
  model: string;
  provider: string;
  executed: Array<{ action?: string; ok: boolean; skipped?: boolean; message?: string; nodeId?: string }>;
}> {
  const apiKey = getSecret("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for the Cerebras operator");
  }

  const model = getSecret("SIGNAL_ROOM_OPERATOR_MODEL") ?? "openai/gpt-oss-120b";
  const providerName = getSecret("SIGNAL_ROOM_OPERATOR_PROVIDER") ?? "cerebras";

  const context: RealtimeRoomContext = { database: input.database, roomCode: input.roomCode };
  const snapshot = await readRealtimeRoomSnapshot(context);

  const tools: ChatTool[] = ACTION_REALTIME_ROOM_TOOLS.filter((tool) => Boolean(tool.name)).map((tool) => ({
    type: "function",
    function: {
      name: tool.name as string,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  const toolChoice: ChatToolChoice | "required" =
    snapshot.nodes.length === 0 ? { type: "function", function: { name: "add_map_signal" } } : "required";

  const systemPrompt = `${buildOperatorInstructions()}\n\n${QUICK_QUESTION_GUIDANCE}`;
  const userPrompt = buildOperatorInput(context, {
    latestTranscript: input.transcript,
    recentContext: input.recentContext ?? "",
    snapshot,
  });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Signal Room",
    },
    body: JSON.stringify({
      model,
      provider: { order: [providerName], allow_fallbacks: false },
      temperature: 0.1,
      parallel_tool_calls: true,
      tool_choice: toolChoice,
      tools,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter operator request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const toolCalls = data.choices?.[0]?.message?.tool_calls ?? [];

  const executed: Array<{
    action?: string;
    ok: boolean;
    skipped?: boolean;
    message?: string;
    nodeId?: string;
  }> = [];

  for (const toolCall of toolCalls) {
    const name = typeof toolCall.function?.name === "string" ? toolCall.function.name : "";
    if (!name) continue;
    const args = typeof toolCall.function?.arguments === "string" ? toolCall.function.arguments : "{}";
    const result = await handleRealtimeRoomTool(context, name, args);
    executed.push({
      action: result.action,
      ok: result.ok,
      skipped: result.skipped,
      message: result.message,
      nodeId: result.nodeId,
    });
  }

  return { model, provider: providerName, executed };
}
