import OpenAI from "openai";

import type { ResearchTaskRunner, SourceLink } from "./researchTaskRunner.js";
import { getSecret } from "../config/env.js";
import { callReducer, jsonString, parseSqlTable, querySql } from "../spacetime/cli.js";

const DEFAULT_DATABASE = "signal-room";
const DEFAULT_OPENROUTER_MODEL = "inception/mercury-2";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CONTEXT_MAX_LENGTH = 2000;
const INSIGHT_MAX_LENGTH = 600;
const LEAF_CONCURRENCY = 5;

const NON_RESEARCHABLE_PATTERN =
  /\b(private|in[- ]person|confidential|personal|our team|internally|off the record|gut feel|opinion|vote|decide together)\b/i;

export type AgentKind = "root" | "branch" | "leaf" | "none";
export type AgentState = "idle" | "working" | "ready";
export type Confidence = "low" | "medium" | "high";

export interface RoomFleetOptions {
  database?: string;
  roomCode: string;
  runner: ResearchTaskRunner;
}

export interface RoomFleetResult {
  database: string;
  roomCode: string;
  roomId: string;
  nodes: number;
  leaves: number;
  noAgent: number;
  rootInsight: string;
}

interface FleetNode {
  id: bigint;
  nodeType: string;
  title: string;
  summary: string;
  childIds: bigint[];
  parentIds: bigint[];
  kind: AgentKind;
  insight: string;
  links: SourceLink[];
  confidence: Confidence;
  depth: number;
}

interface SynthClient {
  client: OpenAI;
  model: string;
}

export async function runRoomFleet(options: RoomFleetOptions): Promise<RoomFleetResult> {
  const database = options.database ?? DEFAULT_DATABASE;
  const roomCode = normalizeRoomCode(options.roomCode);
  const roomId = await resolveRoomId(database, roomCode);

  const nodes = await loadNodes(database, roomId);
  if (nodes.size === 0) {
    throw new Error(`Room ${roomCode} has no map nodes to build a fleet from`);
  }
  applyEdges(nodes, await loadEdges(database, roomId));

  const context = await loadConversationContext(database, roomId);
  const rootId = pickRootId(nodes);
  classifyNodes(nodes, rootId);
  computeDepths(nodes, rootId);

  const list = [...nodes.values()];
  const synth = createSynthClient();

  await phaseInitialStates(database, roomId, list);
  await phaseLeafFleet(database, roomId, list, context, options.runner);
  await phaseSynthesis(database, roomId, nodes, rootId, context, synth);

  const rootNode = nodes.get(rootId.toString());
  const leafCount = list.filter((node) => node.kind === "leaf").length;
  const noAgentCount = list.filter((node) => node.kind === "none").length;

  return {
    database,
    roomCode,
    roomId: roomId.toString(),
    nodes: list.length,
    leaves: leafCount,
    noAgent: noAgentCount,
    rootInsight: rootNode?.insight ?? "",
  };
}

async function phaseInitialStates(database: string, roomId: bigint, list: FleetNode[]): Promise<void> {
  for (const node of list) {
    if (node.kind === "none") {
      node.insight = "Web research won't help here — this needs the room's own input.";
      node.confidence = "low";
      await setNodeAgent(database, roomId, node, "none", "ready");
      continue;
    }
    await setNodeAgent(database, roomId, node, node.kind, "working");
  }
}

async function phaseLeafFleet(
  database: string,
  roomId: bigint,
  list: FleetNode[],
  context: string,
  runner: ResearchTaskRunner
): Promise<void> {
  const leaves = list.filter((node) => node.kind === "leaf");
  await runWithConcurrency(leaves, LEAF_CONCURRENCY, async (node) => {
    await setNodeAgent(database, roomId, node, "leaf", "working");
    try {
      const query = context ? `${node.title}. Meeting context: ${context}` : node.title;
      const output = await runner.run({
        taskId: undefined,
        roomId: roomId.toString(),
        query,
        taskType: "quick_research",
        connectedNode: { id: node.id.toString(), title: node.title },
        urgencyHint: "medium",
      });
      node.insight = capText(output.summary, INSIGHT_MAX_LENGTH);
      node.links = output.sourceLinks;
      node.confidence = output.sourceLinks.length >= 3 ? "high" : "medium";
    } catch {
      node.insight = "Research failed; needs a human follow-up.";
      node.links = [];
      node.confidence = "low";
    }
    await setNodeAgent(database, roomId, node, "leaf", "ready");
  });
}

async function phaseSynthesis(
  database: string,
  roomId: bigint,
  nodes: Map<string, FleetNode>,
  rootId: bigint,
  context: string,
  synth: SynthClient
): Promise<void> {
  const synthNodes = [...nodes.values()].filter((node) => node.kind === "branch" || node.kind === "root");
  // Deepest branches first so a parent always synthesizes after its children are ready.
  synthNodes.sort((a, b) => {
    if (a.kind === "root" && b.kind !== "root") return 1;
    if (b.kind === "root" && a.kind !== "root") return -1;
    return b.depth - a.depth;
  });

  for (const node of synthNodes) {
    await setNodeAgent(database, roomId, node, node.kind, "working");

    const children = node.childIds
      .map((childId) => nodes.get(childId.toString()))
      .filter((child): child is FleetNode => child !== undefined && child.kind !== "none");

    const childLines = children.map((child) => `Child factor: ${child.title} -> ${child.insight}`);
    const highChildren = children.filter((child) => child.confidence === "high").length;

    try {
      node.insight = await synthesize(synth, node, childLines, context);
    } catch {
      node.insight = buildDeterministicSynthesis(node, children);
    }

    node.confidence = children.length > 0 && highChildren * 2 >= children.length ? "high" : "medium";
    await setNodeAgent(database, roomId, node, node.kind, "ready");
  }
}

async function synthesize(
  synth: SynthClient,
  node: FleetNode,
  childLines: string[],
  context: string
): Promise<string> {
  const completion = await synth.client.chat.completions.create({
    model: synth.model,
    temperature: 0.2,
    max_tokens: 280,
    messages: [
      { role: "system", content: buildSynthSystemPrompt(node.kind === "root") },
      { role: "user", content: buildSynthUserPrompt(node, childLines, context) },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter synthesis returned no content");
  }
  return capText(content.trim().replace(/\s+/g, " "), INSIGHT_MAX_LENGTH);
}

function buildSynthSystemPrompt(isRoot: boolean): string {
  if (isRoot) {
    return [
      "You are the root agent of a live meeting research fleet.",
      "Synthesize the child factor insights and the meeting context into a direct, decision-useful answer to the core room question.",
      "Be 2-4 sentences. State your assessment plainly, explicitly note your confidence, and name the single biggest open uncertainty.",
      "Do not invent facts that are not supported by the child insights or context.",
    ].join(" ");
  }
  return [
    "You are a branch agent in a live meeting research fleet.",
    "Synthesize this factor from its child factor insights and the meeting context into 2-4 sentences of useful insight.",
    "Be specific and evidence-grounded. Do not invent facts beyond the child insights or context.",
  ].join(" ");
}

function buildSynthUserPrompt(node: FleetNode, childLines: string[], context: string): string {
  return [
    `Factor: ${node.title}`,
    node.summary ? `Factor summary: ${node.summary}` : "",
    childLines.length > 0 ? `Child insights:\n${childLines.join("\n")}` : "No child insights are available.",
    context ? `Meeting context: ${context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildDeterministicSynthesis(node: FleetNode, children: FleetNode[]): string {
  const top = children
    .slice(0, 3)
    .map((child) => `${child.title}: ${child.insight}`)
    .join(" ");
  const prefix = `${node.title}.`;
  const body = top || node.summary || "No child insights were available to synthesize.";
  return capText(`${prefix} ${body}`.trim(), INSIGHT_MAX_LENGTH);
}

export function createSynthClient(): SynthClient {
  const apiKey = getSecret("OPENROUTER_API_KEY");
  const model = getSecret("SIGNAL_ROOM_ROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for fleet synthesis");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "X-Title": "Signal Room",
    },
  });

  return { client, model };
}

async function setNodeAgent(
  database: string,
  roomId: bigint,
  node: FleetNode,
  agentKind: AgentKind,
  agentState: AgentState
): Promise<void> {
  await callReducer(database, "set_node_agent", [
    node.id.toString(),
    roomId.toString(),
    jsonString(agentKind),
    jsonString(agentState),
    jsonString(node.insight),
    jsonString(JSON.stringify(node.links)),
    jsonString(node.confidence),
  ]);
}

function classifyNodes(nodes: Map<string, FleetNode>, rootId: bigint): void {
  for (const node of nodes.values()) {
    if (node.id === rootId) {
      node.kind = "root";
      continue;
    }
    if (node.childIds.length > 0) {
      node.kind = "branch";
      continue;
    }
    node.kind = isNonResearchable(node) ? "none" : "leaf";
  }
}

function isNonResearchable(node: FleetNode): boolean {
  // Default to giving a node a research agent. Only mark "none" on a STRONG private
  // signal — an explicit private/in-person cue or a human note. Proper nouns
  // (countries, companies) must never trigger this; web research helps there.
  const type = node.nodeType.toLowerCase();
  if (type === "human_note" || type === "note") return true;

  const text = `${node.title} ${node.summary}`;
  if (NON_RESEARCHABLE_PATTERN.test(text)) return true;

  return false;
}

function pickRootId(nodes: Map<string, FleetNode>): bigint {
  for (const node of nodes.values()) {
    if (node.nodeType.toLowerCase() === "root") return node.id;
  }

  for (const node of nodes.values()) {
    if (node.parentIds.length === 0) return node.id;
  }

  return [...nodes.values()][0].id;
}

function computeDepths(nodes: Map<string, FleetNode>, rootId: bigint): void {
  const queue: { id: bigint; depth: number }[] = [{ id: rootId, depth: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const key = current.id.toString();
    if (seen.has(key)) continue;
    seen.add(key);

    const node = nodes.get(key);
    if (!node) continue;
    node.depth = current.depth;

    for (const childId of node.childIds) {
      queue.push({ id: childId, depth: current.depth + 1 });
    }
  }
}

function applyEdges(nodes: Map<string, FleetNode>, edges: { from: bigint; to: bigint }[]): void {
  for (const edge of edges) {
    const parent = nodes.get(edge.from.toString());
    const child = nodes.get(edge.to.toString());
    if (!parent || !child) continue;
    if (!parent.childIds.some((id) => id === edge.to)) parent.childIds.push(edge.to);
    if (!child.parentIds.some((id) => id === edge.from)) child.parentIds.push(edge.from);
  }
}

async function loadNodes(database: string, roomId: bigint): Promise<Map<string, FleetNode>> {
  const rows = parseSqlTable(
    await querySql(database, "SELECT node_id, room_id, node_type, title, summary FROM map_node")
  );
  const nodes = new Map<string, FleetNode>();
  for (const row of rows) {
    if (row.length < 5 || row[1] !== roomId.toString()) continue;
    const id = BigInt(row[0]);
    nodes.set(id.toString(), {
      id,
      nodeType: row[2],
      title: row[3],
      summary: row[4],
      childIds: [],
      parentIds: [],
      kind: "leaf",
      insight: "",
      links: [],
      confidence: "low",
      depth: 0,
    });
  }
  return nodes;
}

async function loadEdges(database: string, roomId: bigint): Promise<{ from: bigint; to: bigint }[]> {
  const rows = parseSqlTable(
    await querySql(database, "SELECT room_id, from_node_id, to_node_id FROM map_edge")
  );
  return rows
    .filter((row) => row.length >= 3 && row[0] === roomId.toString())
    .map((row) => ({ from: BigInt(row[1]), to: BigInt(row[2]) }));
}

async function loadConversationContext(database: string, roomId: bigint): Promise<string> {
  const rows = parseSqlTable(
    await querySql(database, "SELECT room_id, text FROM transcript_chunk")
  );
  const text = rows
    .filter((row) => row.length >= 2 && row[0] === roomId.toString())
    .map((row) => row[1])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return capText(text, CONTEXT_MAX_LENGTH);
}

async function resolveRoomId(database: string, roomCode: string): Promise<bigint> {
  const rows = parseSqlTable(await querySql(database, "SELECT room_id, code FROM room"));
  const match = rows.find((row) => row[1] === roomCode);
  if (!match) throw new Error(`Room ${roomCode} not found`);
  return BigInt(match[0]);
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const poolSize = Math.max(1, Math.min(limit, queue.length || 1));
  const runners = Array.from({ length: poolSize }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function capText(value: string, maxLength: number): string {
  const compact = value.trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function normalizeRoomCode(raw: string): string {
  const normalized = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-").slice(0, 32);
  if (!normalized) throw new Error("room code is required");
  return normalized;
}
