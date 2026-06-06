import { callReducer, jsonString, optionU64, parseSqlTable, querySql } from "../spacetime/cli.js";
import { hasMapworthySignal } from "../spacetime/replayTranscript.js";

const DEFAULT_DATABASE = "signal-room";

export interface RealtimeRoomContext {
  database?: string;
  roomCode?: string;
  displayName?: string;
}

export interface RealtimeRoomToolResult {
  ok: boolean;
  action: string;
  skipped?: boolean;
  roomId?: string;
  nodeId?: string;
  message?: string;
}

export interface RealtimeRoomSnapshot {
  roomId: string;
  rootTitle?: string;
  nodes: Array<{
    title: string;
    summary: string;
    nodeType: string;
  }>;
}

interface NodeRef {
  id: bigint;
  title: string;
  summary: string;
  nodeType: string;
  urgency: string;
}

interface AddMapSignalArgs {
  kind?: unknown;
  title?: unknown;
  summary?: unknown;
  connectedTo?: unknown;
  urgency?: unknown;
  question?: unknown;
  task?: unknown;
  confidence?: unknown;
}

interface AddPassiveQuestionArgs {
  question?: unknown;
  connectedTo?: unknown;
  urgency?: unknown;
  reason?: unknown;
}

interface SummonQuickAgentArgs {
  task?: unknown;
  connectedTo?: unknown;
  urgency?: unknown;
}

interface CorrectMapNodeArgs {
  target?: unknown;
  title?: unknown;
  summary?: unknown;
  urgency?: unknown;
}

export function shouldRunRealtimeOperator(transcript: string): boolean {
  const compact = transcript.trim().replace(/\s+/g, " ");
  if (!compact) return false;

  const lower = compact.toLowerCase();
  const words = compact.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  if (/^(?:um+|uh+|oh|yeah|yep|ok|okay|right|sure|mm+|hmm+|thanks|cool|great)[.!?\s]*$/i.test(compact)) {
    return false;
  }

  if (hasMapworthySignal(compact)) return true;
  return (
    words.length >= 6 &&
    /\b(?:main topic|talk about|trying to|over|under|sanctions?|russian|ukraine|israel|hormuz|nigeria|niger delta|data|agent|because|depends?|causes?|factors?|genetic|environment|school)\b/.test(lower)
  );
}

export async function writeRealtimeTranscriptTurn(
  context: RealtimeRoomContext,
  text: string
): Promise<RealtimeRoomToolResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    return { ok: true, action: "add_transcript_turn", skipped: true, message: "empty transcript" };
  }

  const database = normalizeDatabase(context.database);
  const roomCode = normalizeRoomCode(context.roomCode);
  const displayName = cleanString(context.displayName, "Realtime listener", 80);
  const roomId = await ensureRoom(database, roomCode, displayName);

  if (await transcriptChunkExists(database, roomId, cleanText)) {
    return {
      ok: true,
      action: "add_transcript_turn",
      skipped: true,
      roomId: roomId.toString(),
      message: "duplicate transcript",
    };
  }

  const now = Date.now();
  await ensureOk(
    await callReducer(database, "add_transcript_chunk", [
      roomId.toString(),
      jsonString("Room conversation"),
      jsonString(cleanText),
      BigInt(Math.max(0, now - 5000)).toString(),
      BigInt(now).toString(),
      optionU64(undefined),
    ])
  );

  return {
    ok: true,
    action: "add_transcript_turn",
    roomId: roomId.toString(),
  };
}

export async function handleRealtimeRoomTool(
  context: RealtimeRoomContext,
  toolName: string,
  rawArguments: string
): Promise<RealtimeRoomToolResult> {
  const args = parseToolArguments(rawArguments);
  if (toolName === "add_map_signal") {
    return addMapSignal(context, args as AddMapSignalArgs);
  }
  if (toolName === "add_passive_question") {
    return addPassiveQuestion(context, args as AddPassiveQuestionArgs);
  }
  if (toolName === "summon_quick_agent") {
    return summonQuickAgent(context, args as SummonQuickAgentArgs);
  }
  if (toolName === "correct_map_node") {
    return correctMapNode(context, args as CorrectMapNodeArgs);
  }
  if (toolName === "ignore_turn") {
    return { ok: true, action: "ignore_turn", skipped: true };
  }
  return {
    ok: false,
    action: toolName,
    message: `Unknown Realtime room tool: ${toolName}`,
  };
}

async function addMapSignal(
  context: RealtimeRoomContext,
  args: AddMapSignalArgs
): Promise<RealtimeRoomToolResult> {
  const title = cleanString(args.title, "", 72);
  const summary = cleanString(args.summary, "", 220);
  if (!title || !summary) {
    return { ok: true, action: "add_map_signal", skipped: true, message: "missing title or summary" };
  }

  const database = normalizeDatabase(context.database);
  const roomCode = normalizeRoomCode(context.roomCode);
  const roomId = await ensureRoom(database, roomCode, cleanString(context.displayName, "Realtime listener", 80));
  const nodes = await listNodes(database, roomId);
  if (isWeakMapSignal(title, summary, args.confidence, { allowLowConfidence: nodes.length === 0 })) {
    return { ok: true, action: "add_map_signal", skipped: true, message: "weak map signal" };
  }
  const kind = cleanEnum(args.kind, ["topic", "factor", "question", "claim", "topic_shift", "summary"], "topic");
  const urgency = cleanEnum(args.urgency, ["normal", "high"], "normal");
  const root = await ensureRootNode(database, roomId, nodes, { title, summary, urgency }, args.connectedTo);
  const existing = findSimilarNode(nodes, title);

  const node =
    existing ??
    (await createNode(database, roomId, {
      title,
      summary,
      nodeType: kind,
      source: "Realtime operator",
      urgency,
      x: 500,
      y: 280,
    }));

  if (root.id !== node.id) {
    await createEdge(database, roomId, root, node, kind === "topic_shift" ? "topic shift" : kind);
  }

  const question = cleanOptionalString(args.question, 180);
  if (question && !(await questionExists(database, roomId, question))) {
    await createQuestion(database, roomId, node.id, question, urgency);
  }

  const requestedTask = cleanOptionalString(args.task, 240);
  const task =
    requestedTask && isPublicResearchableTask(requestedTask, title, summary)
      ? requestedTask
      : defaultTaskForSignal(kind, title, summary);
  if (task && !(await taskExists(database, roomId, task))) {
    await createTask(database, roomId, node.id, task, urgency === "high" ? 2 : 1);
  }

  return {
    ok: true,
    action: "add_map_signal",
    roomId: roomId.toString(),
    nodeId: node.id.toString(),
    message: title,
  };
}

async function addPassiveQuestion(
  context: RealtimeRoomContext,
  args: AddPassiveQuestionArgs
): Promise<RealtimeRoomToolResult> {
  const question = cleanString(args.question, "", 180);
  if (!question) {
    return { ok: true, action: "add_passive_question", skipped: true, message: "missing question" };
  }

  const database = normalizeDatabase(context.database);
  const roomCode = normalizeRoomCode(context.roomCode);
  const roomId = await ensureRoom(database, roomCode, cleanString(context.displayName, "Realtime listener", 80));
  const nodes = await listNodes(database, roomId);
  const node = findSimilarNode(nodes, cleanString(args.connectedTo, "", 72)) ?? nodes[0];
  const urgency = cleanEnum(args.urgency, ["normal", "high"], "normal");

  if (!(await questionExists(database, roomId, question))) {
    await createQuestion(database, roomId, node?.id, question, urgency);
  }

  return {
    ok: true,
    action: "add_passive_question",
    roomId: roomId.toString(),
    nodeId: node?.id.toString(),
    message: question,
  };
}

async function summonQuickAgent(
  context: RealtimeRoomContext,
  args: SummonQuickAgentArgs
): Promise<RealtimeRoomToolResult> {
  const task = cleanString(args.task, "", 240);
  if (!task) {
    return { ok: true, action: "summon_quick_agent", skipped: true, message: "missing task" };
  }

  const database = normalizeDatabase(context.database);
  const roomCode = normalizeRoomCode(context.roomCode);
  const roomId = await ensureRoom(database, roomCode, cleanString(context.displayName, "Realtime listener", 80));
  const nodes = await listNodes(database, roomId);
  const node = findSimilarNode(nodes, cleanString(args.connectedTo, "", 72)) ?? nodes[0];
  const urgency = cleanEnum(args.urgency, ["normal", "high"], "normal");

  if (!(await taskExists(database, roomId, task))) {
    await createTask(database, roomId, node?.id, task, urgency === "high" ? 2 : 1);
  }

  return {
    ok: true,
    action: "summon_quick_agent",
    roomId: roomId.toString(),
    nodeId: node?.id.toString(),
    message: task,
  };
}

async function correctMapNode(
  context: RealtimeRoomContext,
  args: CorrectMapNodeArgs
): Promise<RealtimeRoomToolResult> {
  const target = cleanString(args.target, "", 72);
  const title = cleanOptionalString(args.title, 72);
  const summary = cleanOptionalString(args.summary, 220);
  if (!target || (!title && !summary)) {
    return { ok: true, action: "correct_map_node", skipped: true, message: "missing target or correction" };
  }

  const database = normalizeDatabase(context.database);
  const roomCode = normalizeRoomCode(context.roomCode);
  const roomId = await ensureRoom(database, roomCode, cleanString(context.displayName, "Realtime listener", 80));
  const nodes = await listNodes(database, roomId);
  const node = findSimilarNode(nodes, target) ?? (/\bcenter|root|main\b/i.test(target) ? findRootNode(nodes) : undefined);
  if (!node) {
    return { ok: true, action: "correct_map_node", skipped: true, message: "target node not found" };
  }

  const urgency = cleanEnum(args.urgency, ["normal", "high"], node.urgency === "high" ? "high" : "normal");
  await updateNode(database, node.id, {
    title: title ?? node.title,
    summary: summary ?? node.summary,
    nodeType: node.nodeType,
    source: "Realtime correction",
    urgency,
    x: 500,
    y: 280,
  });

  return {
    ok: true,
    action: "correct_map_node",
    roomId: roomId.toString(),
    nodeId: node.id.toString(),
    message: title ?? summary,
  };
}

export async function readRealtimeRoomSnapshot(context: RealtimeRoomContext): Promise<RealtimeRoomSnapshot> {
  const database = normalizeDatabase(context.database);
  const roomCode = normalizeRoomCode(context.roomCode);
  const roomId = await ensureRoom(database, roomCode, cleanString(context.displayName, "Realtime listener", 80));
  const nodes = await listNodes(database, roomId);
  const root = findRootNode(nodes);
  return {
    roomId: roomId.toString(),
    rootTitle: root?.title,
    nodes: nodes.slice(0, 12).map((node) => ({
      title: node.title,
      summary: node.summary,
      nodeType: node.nodeType,
    })),
  };
}

async function ensureRoom(database: string, roomCode: string, displayName: string): Promise<bigint> {
  await ensureOk(
    await callReducer(database, "create_room", [
      jsonString(roomCode),
      jsonString(`Signal Room ${roomCode}`),
      jsonString(displayName),
    ])
  );
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, code FROM room"));
  const match = rows.find((row) => row[1] === roomCode);
  if (!match) throw new Error(`Room ${roomCode} was not found after create_room`);
  return BigInt(match[0]);
}

async function ensureRootNode(
  database: string,
  roomId: bigint,
  nodes: NodeRef[],
  seed: { title: string; summary: string; urgency: string },
  connectedTo: unknown
): Promise<NodeRef> {
  const connectedTitle = cleanString(connectedTo, "", 72);
  const connectedNode = findSimilarNode(nodes, connectedTitle);
  if (connectedNode) return connectedNode;

  const root = findRootNode(nodes);
  if (root) {
    if (isGenericRoot(root) && !isWeakMapSignal(seed.title, seed.summary, 0.9)) {
      await updateNode(database, root.id, {
        title: seed.title,
        summary: seed.summary,
        nodeType: "root",
        source: "Realtime operator",
        urgency: seed.urgency,
        x: 500,
        y: 280,
      });
      root.title = seed.title;
      root.summary = seed.summary;
      root.nodeType = "root";
      root.urgency = seed.urgency;
    }
    return root;
  }

  const createdRoot = await createNode(database, roomId, {
    title: connectedTitle || seed.title,
    summary: seed.summary || "Live topic detected by the Realtime room operator.",
    nodeType: "root",
    source: "Realtime operator",
    urgency: seed.urgency,
    x: 500,
    y: 280,
  });

  await ensureOk(
    await callReducer(database, "set_room_focus", [
      roomId.toString(),
      optionU64(createdRoot.id),
      jsonString(createdRoot.title),
    ])
  );
  nodes.push(createdRoot);
  return createdRoot;
}

async function createNode(
  database: string,
  roomId: bigint,
  input: {
    title: string;
    summary: string;
    nodeType: string;
    source: string;
    urgency: string;
    x: number;
    y: number;
  }
): Promise<NodeRef> {
  await ensureOk(
    await callReducer(database, "create_map_node", [
      roomId.toString(),
      jsonString(input.title),
      jsonString(input.summary),
      jsonString(input.nodeType),
      jsonString(input.source),
      jsonString(input.urgency),
      optionU64(undefined),
      input.x.toString(),
      input.y.toString(),
    ])
  );
  return resolveNodeByTitle(database, roomId, input.title);
}

async function updateNode(
  database: string,
  nodeId: bigint,
  input: {
    title: string;
    summary: string;
    nodeType: string;
    source: string;
    urgency: string;
    x: number;
    y: number;
  }
): Promise<void> {
  await ensureOk(
    await callReducer(database, "update_map_node", [
      nodeId.toString(),
      optionString(input.title),
      optionString(input.summary),
      optionString(input.nodeType),
      optionString(input.source),
      optionString(input.urgency),
      optionF64(input.x),
      optionF64(input.y),
    ])
  );
}

async function createEdge(
  database: string,
  roomId: bigint,
  from: NodeRef,
  to: NodeRef,
  label: string
): Promise<void> {
  if (from.id === to.id) return;
  await ensureOk(
    await callReducer(database, "add_map_edge", [
      roomId.toString(),
      from.id.toString(),
      to.id.toString(),
      jsonString(label),
      jsonString("related"),
      "1",
    ])
  );
}

async function createQuestion(
  database: string,
  roomId: bigint,
  nodeId: bigint | undefined,
  question: string,
  urgency: string
): Promise<void> {
  await ensureOk(
    await callReducer(database, "create_question_candidate", [
      roomId.toString(),
      optionU64(nodeId),
      jsonString(question),
      jsonString("Realtime operator"),
      jsonString(urgency),
      '{"none":{}}',
    ])
  );
}

async function createTask(
  database: string,
  roomId: bigint,
  nodeId: bigint | undefined,
  task: string,
  priority: number
): Promise<void> {
  await ensureOk(
    await callReducer(database, "create_agent_task", [
      roomId.toString(),
      optionU64(nodeId),
      jsonString("quick_research"),
      jsonString(task),
      priority.toString(),
    ])
  );
}

async function listNodes(database: string, roomId: bigint): Promise<NodeRef[]> {
  const rows = parseSqlTable(await querySql(database, "SELECT node_id, room_id, title, summary, node_type, urgency FROM map_node"));
  return rows
    .filter((row) => row[1] === roomId.toString())
    .map((row) => ({ id: BigInt(row[0]), title: row[2], summary: row[3], nodeType: row[4], urgency: row[5] }));
}

async function resolveNodeByTitle(database: string, roomId: bigint, title: string): Promise<NodeRef> {
  const matches = (await listNodes(database, roomId)).filter((node) => node.title === title);
  const match = matches[matches.length - 1];
  if (!match) throw new Error(`Node ${title} was not found after create_map_node`);
  return match;
}

async function transcriptChunkExists(database: string, roomId: bigint, text: string): Promise<boolean> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, text FROM transcript_chunk"));
  return rows.some((row) => row[0] === roomId.toString() && row[1] === text);
}

async function questionExists(database: string, roomId: bigint, question: string): Promise<boolean> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, question FROM question_candidate"));
  return rows.some((row) => row[0] === roomId.toString() && row[1] === question);
}

async function taskExists(database: string, roomId: bigint, instructions: string): Promise<boolean> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, instructions FROM agent_task"));
  return rows.some((row) => row[0] === roomId.toString() && row[1] === instructions);
}

async function ensureOk(result: { ok: boolean; reducer: string; stderr: string; stdout: string }) {
  if (!result.ok) {
    throw new Error(`${result.reducer} failed: ${result.stderr || result.stdout}`);
  }
}

function findSimilarNode(nodes: NodeRef[], title: string): NodeRef | undefined {
  if (!title) return undefined;
  const normalizedTitle = normalizeComparableText(title);
  return nodes.find((node) => {
    const normalizedNodeTitle = normalizeComparableText(node.title);
    if (normalizedNodeTitle === normalizedTitle) return true;
    return textSimilarity(normalizedNodeTitle, normalizedTitle) >= 0.86;
  });
}

function findRootNode(nodes: NodeRef[]): NodeRef | undefined {
  return nodes.find((node) => node.nodeType === "root") ?? nodes[0];
}

function isGenericRoot(node: NodeRef): boolean {
  const normalizedTitle = normalizeComparableText(node.title);
  const normalizedSummary = normalizeComparableText(node.summary);
  if (/\b(?:current discussion|working question|room discussion|general discussion)\b/.test(normalizedTitle)) {
    return true;
  }
  if (/\blive topic detected by realtime room operator\b/.test(normalizedSummary)) {
    return true;
  }
  return false;
}

function isWeakMapSignal(
  title: string,
  summary: string,
  confidence: unknown,
  options: { allowLowConfidence?: boolean } = {}
): boolean {
  const normalizedTitle = normalizeComparableText(title);
  const normalizedSummary = normalizeComparableText(summary);
  const numericConfidence = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : undefined;

  if (!options.allowLowConfidence && numericConfidence !== undefined && numericConfidence < 0.58) return true;
  if (/\b(?:brief utterance|tiny utterance|short utterance|filler|acknowledgement|acknowledgment)\b/.test(normalizedTitle)) {
    return true;
  }
  if (/\b(?:conversation summary|current discussion|general discussion|room discussion)\b/.test(normalizedTitle)) {
    return true;
  }
  if (/^(?:um|uh|oh|yeah|ok|okay|right|that|sure|mm|hmm)\b/.test(normalizedTitle)) return true;
  if (normalizedSummary.length < 28) return true;
  if (/\b(?:only|just)\b.*\b(?:spoken|said|mentioned)\b/.test(normalizedSummary)) return true;
  if (/\b(?:no further discussion|brief conversation|nothing substantive)\b/.test(normalizedSummary)) return true;

  return false;
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(?:the|and|or|on|of|to|for|a|an|public|current|overall)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  if (!rawArguments.trim()) return {};
  const parsed = JSON.parse(rawArguments) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function normalizeDatabase(value: unknown): string {
  return cleanString(value, DEFAULT_DATABASE, 80);
}

function normalizeRoomCode(value: unknown): string {
  const normalized = cleanString(value, "", 32)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-");
  if (!normalized) throw new Error("roomCode is required for Realtime room tools");
  return normalized;
}

function cleanString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const clean = value
    .trim()
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
  return clean ? clean.slice(0, maxLength) : fallback;
}

function cleanOptionalString(value: unknown, maxLength: number): string | undefined {
  const clean = cleanString(value, "", maxLength);
  return clean || undefined;
}

function cleanEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function defaultTaskForSignal(kind: string, title: string, summary: string): string | undefined {
  if (kind !== "topic" && kind !== "factor" && kind !== "claim" && kind !== "question" && kind !== "topic_shift") {
    return undefined;
  }
  if (!isPublicResearchableTask(title, title, summary)) return undefined;
  return cleanString(
    `Fact-check and monitor current public evidence for "${title}" in this room context: ${summary}`,
    "",
    240
  );
}

function isPublicResearchableTask(task: string, title: string, summary: string): boolean {
  const text = normalizeComparableText(`${task} ${title} ${summary}`);
  if (/\b(?:my|me|our|friend|friends|room|scrabble|diet coke|phone|cake|victor|ben|michelle)\b/.test(text)) {
    return /\b(?:agent|look up|research|find current|public evidence|current evidence)\b/.test(text) &&
      /\b(?:study|research|market|stock|company|news|filing|price|revenue|sales|evidence)\b/.test(text);
  }
  return /\b(?:stock|market|price|bitcoin|election|revenue|sales|filing|earnings|company|tariff|oil|energy|geopolitic|war|trade|climate|policy|inflation|rates|news|public evidence|current evidence|latest|source|data|transported|shipping|strait|hormuz|iran|india|pakistan|russia|putin|ayatollah|regime|domestic politics|mediation|diplomacy|sanction|blockade|ceasefire|reopen|closed|closure)\b/.test(text);
}

function optionString(value: string | undefined): string {
  return value === undefined ? '{"none":{}}' : `{"some":${JSON.stringify(value)}}`;
}

function optionF64(value: number | undefined): string {
  return value === undefined ? '{"none":{}}' : `{"some":${value.toString()}}`;
}
