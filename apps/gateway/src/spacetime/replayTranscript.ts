import { callReducer, jsonString, optionU64, parseSqlTable, querySql } from "./cli.js";

const DEFAULT_DATABASE = "signal-room";

export interface ReplayTranscriptOptions {
  database?: string;
  roomCode: string;
  displayName: string;
  transcript: string;
  delayMs: number;
  routeTranscript?: TranscriptRouter;
}

export interface ReplayTranscriptResult {
  database: string;
  roomCode: string;
  roomId: string;
  chunks: number;
  steps: ReplayTranscriptStep[];
}

export interface ReplayTranscriptStep {
  name: string;
  created?: string;
  note?: string;
}

interface NodeRef {
  id: bigint;
  title: string;
}

export interface RouterTopic {
  key: string;
  parentKey?: string;
  title: string;
  summary: string;
  nodeType: string;
  source: string;
  urgency: string;
  x: number;
  y: number;
  edgeLabel: string;
  question?: string;
  task?: string;
}

export interface TranscriptRoute {
  rootTitle: string;
  rootSummary: string;
  topics: RouterTopic[];
}

export type TranscriptRouter = (transcript: string) => Promise<TranscriptRoute>;

export async function replayTranscript(options: ReplayTranscriptOptions): Promise<ReplayTranscriptResult> {
  const database = options.database ?? DEFAULT_DATABASE;
  const roomCode = normalizeRoomCode(options.roomCode);
  const chunks = splitTranscript(options.transcript);
  if (chunks.length === 0) {
    throw new Error("Transcript replay needs at least one non-empty line or paragraph");
  }

  const steps: ReplayTranscriptStep[] = [];

  await ensureOk(
    await callReducer(database, "create_room", [
      jsonString(roomCode),
      jsonString(`Signal Room ${roomCode}`),
      jsonString(options.displayName),
    ])
  );
  const roomId = await resolveRoomId(database, roomCode);
  const existingNodes = await listNodes(database, roomId);
  let root = existingNodes[0];
  let createdTranscriptChunks = 0;

  for (const [index, chunk] of chunks.entries()) {
    if (await transcriptChunkExists(database, roomId, chunk)) {
      continue;
    }

    const startMs = index * 7000;
    await ensureOk(
      await callReducer(database, "add_transcript_chunk", [
        roomId.toString(),
        jsonString("Room conversation"),
        jsonString(chunk),
        startMs.toString(),
        (startMs + 6500).toString(),
        optionU64(undefined),
      ])
    );
    createdTranscriptChunks += 1;
    steps.push({ name: "transcript_chunk", created: `${index + 1}` });
    await wait(options.delayMs);
  }

  if (!hasMapworthySignal(options.transcript)) {
    return {
      database,
      roomCode,
      roomId: roomId.toString(),
      chunks: chunks.length,
      steps,
    };
  }

  const route = options.routeTranscript
    ? await options.routeTranscript(options.transcript)
    : buildDeterministicTranscriptRoute(options.transcript);

  if (!root) {
    root = await createNode(database, roomId, {
      title: route.rootTitle,
      summary: route.rootSummary,
      nodeType: "root",
      source: "Silent router",
      urgency: "normal",
      x: 500,
      y: 280,
    });
    await focusNode(database, roomId, root);
    steps.push({ name: "root_node", created: root.id.toString() });
    await wait(options.delayMs);
  }

  const topics = route.topics.length > 0 ? route.topics : inferTopics(options.transcript);
  const currentNodes = await listNodes(database, roomId);

  // First create/find ALL topic nodes so parents exist before any edge is drawn.
  const topicNodes = new Map<string, NodeRef>();
  for (const topic of topics) {
    const existing = findExistingNode(currentNodes, topic.title);
    const node =
      existing ??
      (await createNode(database, roomId, {
        title: topic.title,
        summary: topic.summary,
        nodeType: topic.nodeType,
        source: topic.source,
        urgency: topic.urgency,
        x: topic.x,
        y: topic.y,
      }));

    if (!existing) {
      currentNodes.push(node);
      steps.push({ name: "topic_node", created: node.id.toString(), note: topic.title });
      await wait(options.delayMs);
    }

    topicNodes.set(topic.key, node);
  }

  // Then wire edges: nest under a parent topic when parentKey resolves, else under root.
  for (const topic of topics) {
    const node = topicNodes.get(topic.key);
    if (!node) continue;

    const parentTopic =
      topic.parentKey && topic.parentKey !== topic.key ? topicNodes.get(topic.parentKey) : undefined;
    const parent = parentTopic && parentTopic.id !== node.id ? parentTopic : root;

    await createEdge(database, roomId, parent, node, topic.edgeLabel);

    if (topic.question) {
      const exists = await questionExists(database, roomId, topic.question);
      if (!exists) {
        await ensureOk(
          await callReducer(database, "create_question_candidate", [
            roomId.toString(),
            optionU64(node.id),
            jsonString(topic.question),
            jsonString(topic.source),
            jsonString(topic.urgency === "high" ? "high" : "normal"),
            '{"none":{}}',
          ])
        );
        steps.push({ name: "question_candidate", created: node.id.toString(), note: topic.question });
        await wait(options.delayMs);
      }
    }

    if (topic.task) {
      const exists = await taskExists(database, roomId, topic.task);
      if (!exists) {
        // A direct question to the agent gets the fast research lane and top priority,
        // so "hey agent" answers come back quickly and surface above background research.
        const isDirectQuestion = topic.nodeType === "human_question";
        const taskType = isDirectQuestion ? "quick_research" : "research";
        const priority = isDirectQuestion ? "3" : topic.urgency === "high" ? "2" : "1";
        await ensureOk(
          await callReducer(database, "create_agent_task", [
            roomId.toString(),
            optionU64(node.id),
            jsonString(taskType),
            jsonString(topic.task),
            priority,
          ])
        );
        steps.push({ name: "agent_task_queued", created: node.id.toString(), note: topic.task });
        await wait(options.delayMs);
      }
    }
  }

  return {
    database,
    roomCode,
    roomId: roomId.toString(),
    chunks: chunks.length,
    steps,
  };
}

export function hasMapworthySignal(transcript: string): boolean {
  const compact = transcript.trim().replace(/\s+/g, " ");
  if (!compact) return false;
  const words = compact.split(/\s+/).filter(Boolean);
  const lower = compact.toLowerCase();

  if (words.length >= 22) return true;
  if (/[?]/.test(compact) && words.length >= 6) return true;
  if (/\b(?:agent|look up|research|find out|figure out|source|evidence|consider)\b/.test(lower)) return true;
  if (/\b(?:let'?s talk|trying to predict|what will|will .* be|how might|impact|affect|risk|price|stock|market|oil|tariff|nvidia|nvda|bitcoin|hormuz|ukraine|russia|iran|china|india)\b/.test(lower)) {
    return words.length >= 8;
  }

  return false;
}

function splitTranscript(transcript: string): string[] {
  const chunks = transcript
    .split(/\n{2,}|\r?\n(?=(?:[A-Z][a-z]+|Agent|Host|Michelle|Victor|Ben):)/)
    .map((chunk) => chunk.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 12);

  if (chunks.length !== 1 || chunks[0].length < 360) {
    return chunks;
  }

  return groupSentences(chunks[0]).slice(0, 12);
}

function inferRootTitle(transcript: string): string {
  const lower = transcript.toLowerCase();
  if (/\b(strait of hormuz|hormuz)\b/.test(lower)) return "Strait of Hormuz reopening";
  if (/\b(oil prices?|ceasefire|iran war)\b/.test(lower)) return "Oil shock working question";
  if (/\b(nvidia|nvda)\b/.test(lower)) return "NVIDIA working estimate";
  if (/\b(bitcoin|btc)\b/.test(lower)) return "Bitcoin working estimate";
  if (/\b(phone|cake|diet coke|stole|steal|hide|missing)\b/.test(lower)) {
    return "Room investigation";
  }
  const question = transcript.match(/([^.!?\n]{12,120}\?)/);
  return question ? cleanTitle(question[1]) : "Working question";
}

function summarizeTranscript(transcript: string): string {
  const compact = transcript.trim().replace(/\s+/g, " ");
  if (compact.length <= 132) return compact;
  return `${compact.slice(0, 129)}...`;
}

function inferTopics(transcript: string): RouterTopic[] {
  const lower = transcript.toLowerCase();
  const topics: RouterTopic[] = [];

  if (/\b(sovereign ai|ai demand|hyperscaler|capex|compute|gpu|renting)\b/.test(lower)) {
    topics.push({
      key: "ai-demand",
      title: "AI demand split",
      summary: "Room asked whether sovereign AI demand and hyperscaler capex should be modeled separately.",
      nodeType: "question",
      source: "Replay router",
      urgency: "high",
      x: 165,
      y: 130,
      edgeLabel: "demand",
      question: "Should sovereign AI demand be separated from hyperscaler capex?",
      task: "Research current signals on sovereign AI demand versus hyperscaler AI capex.",
    });
  }

  if (/\b(oil|iran|nigeria|russia|ukraine|rates|inflation|geopolitics|strait)\b/.test(lower)) {
    topics.push({
      key: "macro-risk",
      title: /\b(strait of hormuz|hormuz)\b/.test(lower) ? "Oil price shock path" : "Geopolitics and rates",
      summary: /\b(strait of hormuz|hormuz)\b/.test(lower)
        ? "Room tied Strait reopening and regional conflict to oil prices and downstream market pressure."
        : "Room connected geopolitical or oil shocks to rates, inflation, and valuation multiple risk.",
      nodeType: "research",
      source: "Replay router",
      urgency: "high",
      x: 835,
      y: 130,
      edgeLabel: "macro risk",
      question: "Would this macro risk change the room's base estimate?",
      task: "Research whether current oil or geopolitical shocks could affect inflation, rates, or valuation multiples.",
    });
  }

  if (/\b(ceasefire|negotiations?|reopen|reopening)\b/.test(lower)) {
    topics.push({
      key: "ceasefire-path",
      title: "Ceasefire negotiations",
      summary: "Room identified ceasefire progress as the key near-term condition for reopening the Strait and easing oil prices.",
      nodeType: "question",
      source: "Replay router",
      urgency: "high",
      x: 170,
      y: 445,
      edgeLabel: "reopening condition",
      question: "Who is actually mediating the ceasefire, and is any channel credible enough to move oil prices?",
      task: "Research current ceasefire negotiation channels around Iran and the Strait of Hormuz conflict.",
    });
  }

  if (/\b(china|india|pakistan|russia|third part(?:y|ies))\b/.test(lower)) {
    topics.push({
      key: "third-party-pressure",
      title: "Third-party pressure",
      summary: "Room asked whether China, India, Pakistan, Russia, or the US can pressure Iran more effectively than direct US action.",
      nodeType: "research",
      source: "Replay router",
      urgency: "normal",
      x: 835,
      y: 445,
      edgeLabel: "mediators",
      question: "Which outside actor has the most leverage over Iran in this situation?",
      task: "Research the latest public positions from China, India, Pakistan, Russia, and the US on the Iran conflict.",
    });
  }

  if (/\b(agent|look up|research|find out|figure out|source|evidence)\b/.test(lower)) {
    topics.push({
      key: "explicit-agent-request",
      title: "Explicit agent request",
      summary: "A participant asked the agent to gather evidence instead of interrupting the room.",
      nodeType: "human_question",
      source: "Replay router",
      urgency: "normal",
      x: 500,
      y: 568,
      edgeLabel: "requested research",
      task: buildExplicitAgentTask(transcript),
    });
  }

  return dedupeTopics(topics);
}

export function buildDeterministicTranscriptRoute(transcript: string): TranscriptRoute {
  return {
    rootTitle: inferRootTitle(transcript),
    rootSummary: summarizeTranscript(transcript),
    topics: inferTopics(transcript),
  };
}

function buildExplicitAgentTask(transcript: string): string {
  const command = transcript.match(/\b(?:agent|look up|research|find out|figure out)\b[^.!?\n]{0,160}/i);
  if (!command) return "Research the explicit agent request from the room transcript.";
  return cleanSentence(command[0]);
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

async function createEdge(
  database: string,
  roomId: bigint,
  from: NodeRef,
  to: NodeRef,
  label: string
): Promise<void> {
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

async function focusNode(database: string, roomId: bigint, node: NodeRef): Promise<void> {
  await ensureOk(
    await callReducer(database, "set_room_focus", [
      roomId.toString(),
      optionU64(node.id),
      jsonString(node.title),
    ])
  );
}

async function resolveRoomId(database: string, roomCode: string): Promise<bigint> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, code FROM room"));
  const match = rows.find((row) => row[1] === roomCode);
  if (!match) throw new Error(`Room ${roomCode} was not found after create_room`);
  return BigInt(match[0]);
}

async function resolveNodeByTitle(
  database: string,
  roomId: bigint,
  title: string
): Promise<NodeRef> {
  const matches = (await listNodes(database, roomId)).filter((row) => row.title === title);
  const match = matches[matches.length - 1];
  if (!match) throw new Error(`Node ${title} was not found after create_map_node`);
  return match;
}

async function listNodes(database: string, roomId: bigint): Promise<NodeRef[]> {
  const rows = parseSqlTable(await querySql(database, "SELECT node_id, room_id, title FROM map_node"));
  return rows
    .filter((row) => row[1] === roomId.toString())
    .map((row) => ({
      id: BigInt(row[0]),
      title: row[2],
    }));
}

async function questionExists(database: string, roomId: bigint, question: string): Promise<boolean> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, question FROM question_candidate"));
  return rows.some((row) => row[0] === roomId.toString() && row[1] === question);
}

async function taskExists(database: string, roomId: bigint, instructions: string): Promise<boolean> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, instructions FROM agent_task"));
  return rows.some((row) => row[0] === roomId.toString() && row[1] === instructions);
}

async function transcriptChunkExists(database: string, roomId: bigint, text: string): Promise<boolean> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, text FROM transcript_chunk"));
  return rows.some((row) => row[0] === roomId.toString() && row[1] === text);
}

async function ensureOk(result: { ok: boolean; reducer: string; stderr: string; stdout: string }) {
  if (!result.ok) {
    throw new Error(`${result.reducer} failed: ${result.stderr || result.stdout}`);
  }
}

function dedupeTopics(topics: RouterTopic[]): RouterTopic[] {
  const seen = new Set<string>();
  return topics.filter((topic) => {
    if (seen.has(topic.key)) return false;
    seen.add(topic.key);
    return true;
  });
}

function findExistingNode(nodes: NodeRef[], title: string): NodeRef | undefined {
  const normalizedTitle = normalizeComparableText(title);
  return nodes.find((node) => {
    const normalizedNodeTitle = normalizeComparableText(node.title);
    if (normalizedNodeTitle === normalizedTitle) return true;
    return textSimilarity(normalizedNodeTitle, normalizedTitle) >= 0.55;
  });
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

function cleanTitle(value: string): string {
  return cleanSentence(value).replace(/[?!.]+$/, "").slice(0, 72);
}

function cleanSentence(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function groupSentences(text: string): string[] {
  const sentences = text
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((sentence) => cleanSentence(sentence))
    .filter(Boolean);
  if (!sentences?.length) return [text];

  const groups: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > 300 && current) {
      groups.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function normalizeRoomCode(raw: string): string {
  const normalized = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-").slice(0, 32);
  if (!normalized) throw new Error("room code is required");
  return normalized;
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
