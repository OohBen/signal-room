import OpenAI from "openai";

import { getSecret } from "../config/env.js";
import {
  hasMapworthySignal,
  type RouterTopic,
  type TranscriptRoute,
  type TranscriptRouter,
} from "../spacetime/replayTranscript.js";

const DEFAULT_OPENROUTER_MODEL = "inception/mercury-2";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface TranscriptRouterOptions {
  model?: string;
}

interface RawTranscriptRoute {
  rootTitle?: unknown;
  rootSummary?: unknown;
  topics?: unknown;
}

interface RawRouterTopic {
  key?: unknown;
  title?: unknown;
  summary?: unknown;
  nodeType?: unknown;
  source?: unknown;
  urgency?: unknown;
  x?: unknown;
  y?: unknown;
  edgeLabel?: unknown;
  question?: unknown;
  task?: unknown;
}

export function createTranscriptRouter(options: TranscriptRouterOptions = {}): TranscriptRouter {
  const apiKey = getSecret("OPENROUTER_API_KEY");
  const model = options.model ?? getSecret("SIGNAL_ROOM_ROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for transcript routing");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "X-Title": "Signal Room",
    },
  });

  return async (transcript) => routeWithOpenRouter({ client, model, transcript });
}

async function routeWithOpenRouter(input: {
  client: OpenAI;
  model: string;
  transcript: string;
}): Promise<TranscriptRoute> {
  const content = await callOpenRouter(input);
  return sanitizeRoute(parseJsonObject(content), input.transcript, input.model);
}

async function callOpenRouter(input: { client: OpenAI; model: string; transcript: string }): Promise<string> {
  const completion = await input.client.chat.completions.create({
    model: input.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: `Meeting transcript:\n${input.transcript}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter router returned no content");
  }
  return content;
}

function buildSystemPrompt(): string {
  return [
    "You are Signal Room's silent meeting router.",
    "Your job is not to answer the meeting. Your job is to turn transcript into passive shared state for a live research map.",
    "AI must not interrupt, speak, or decide for the room. It may create map nodes, passive questions, and queued research tasks.",
    "If an idea is researchable with public/current sources, include a concise task.",
    "Tasks must use public web/current-news sources only. Do not request private records, leaked documents, diplomatic cables, or inaccessible sources.",
    "Do not invent examples, countries, dates, sources, or named institutions that are not in the transcript.",
    "If the transcript is only a filler, acknowledgement, correction, or tiny aside, return an empty topics array. Do not create a 'brief utterance' node.",
    "If the transcript opens with a main room topic such as 'let's talk about X', 'we are trying to predict X', or 'what will X be', put that in rootTitle/rootSummary. Do not also add a side topic that merely restates X.",
    "The root is the center of the map. Topics are only meaningful branches under that center.",
    "Use specific titles like 'NVIDIA Q4 2026 outlook' or 'Oil price shock path', never vague titles like 'NVIDIA discussion', 'NVIDIA interest', 'Conversation summary', or 'Brief utterance'.",
    "If an idea is not researchable, preserve it as a summary/question and omit task.",
    "If the transcript includes an explicit request like 'agent, look up...' or 'agent, what is...', create an Explicit agent request topic with a task matching that request.",
    "Return only JSON with this schema:",
    '{"rootTitle":"short topic title","rootSummary":"one sentence","topics":[{"key":"stable-slug","title":"short node title","summary":"one sentence","nodeType":"research|question|human_question|summary","source":"Router AI","urgency":"high|normal","x":500,"y":280,"edgeLabel":"short label","question":"optional passive question","task":"optional queued research task"}]}',
    "Use at most 5 topics. Keep titles under 56 characters. Keep summaries under 180 characters.",
  ].join("\n");
}

function parseJsonObject(content: string): RawTranscriptRoute {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Router response did not contain a JSON object");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as RawTranscriptRoute;
}

function sanitizeRoute(raw: RawTranscriptRoute, transcript: string, model: string): TranscriptRoute {
  if (!hasMapworthySignal(transcript)) {
    return {
      rootTitle: "",
      rootSummary: "",
      topics: [],
    };
  }

  const rootTitle = cleanText(raw.rootTitle, "", 72);
  const rootSummary = cleanText(raw.rootSummary, "", 220);
  if (!rootTitle || !rootSummary) {
    throw new Error("Transcript router returned no rootTitle/rootSummary");
  }

  const rawTopics = Array.isArray(raw.topics) ? raw.topics : [];
  const topics = rawTopics
    .map((topic, index) => sanitizeTopic(topic as RawRouterTopic, index, model))
    .filter((topic): topic is RouterTopic => topic !== undefined)
    .filter((topic) => !isWeakTopic(topic, rootTitle))
    .slice(0, 5);

  return {
    rootTitle,
    rootSummary,
    topics,
  };
}

function sanitizeTopic(raw: RawRouterTopic, index: number, model: string): RouterTopic | undefined {
  const title = cleanText(raw.title, "", 72);
  if (!title) return undefined;

  const positions = defaultPosition(index);
  const nodeType = cleanEnum(raw.nodeType, ["research", "question", "human_question", "summary"], "research");
  const urgency = cleanEnum(raw.urgency, ["high", "normal"], "normal");

  return {
    key: cleanSlug(raw.key, title),
    title,
    summary: cleanText(raw.summary, "Router marked this as relevant to the room conversation.", 220),
    nodeType,
    source: cleanText(raw.source, `Router AI (${model})`, 80),
    urgency,
    x: cleanNumber(raw.x, positions.x),
    y: cleanNumber(raw.y, positions.y),
    edgeLabel: cleanText(raw.edgeLabel, "related", 32),
    question: cleanOptionalText(raw.question, 180),
    task: cleanOptionalText(raw.task, 220),
  };
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
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

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  const clean = cleanText(value, "", maxLength);
  if (/^(?:none|null|n\/a|no task|human clarification needed)\b/i.test(clean)) {
    return undefined;
  }
  const publicSafe = clean
    .replace(/\bdiplomatic communications?\b/gi, "public diplomatic statements")
    .replace(/\b(?:diplomatic cables?|leaked documents?|private records?)\b/gi, "public reports");
  return publicSafe || undefined;
}

function cleanEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function cleanNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function cleanSlug(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function defaultPosition(index: number): { x: number; y: number } {
  const positions = [
    { x: 170, y: 130 },
    { x: 835, y: 130 },
    { x: 170, y: 445 },
    { x: 835, y: 445 },
    { x: 500, y: 568 },
  ];
  return positions[index] ?? positions[positions.length - 1];
}

function isWeakTopic(topic: RouterTopic, rootTitle: string): boolean {
  const normalizedTitle = normalizeComparableText(topic.title);
  const normalizedSummary = normalizeComparableText(topic.summary);
  const normalizedRoot = normalizeComparableText(rootTitle);

  if (!normalizedTitle || !normalizedSummary) return true;
  if (textSimilarity(normalizedTitle, normalizedRoot) >= 0.58) return true;
  if (/\b(?:brief utterance|tiny utterance|short utterance|filler|acknowledgement|acknowledgment)\b/.test(normalizedTitle)) {
    return true;
  }
  if (/\b(?:conversation summary|current discussion|general discussion|room discussion)\b/.test(normalizedTitle)) {
    return true;
  }
  if (/\b(?:nvidia discussion|nvidia interest|nvda discussion|bitcoin discussion)\b/.test(normalizedTitle)) {
    return true;
  }
  if (/^(?:um|uh|oh|yeah|ok|okay|right|that|sure|mm|hmm)\b/.test(normalizedTitle)) return true;
  if (normalizedSummary.length < 28) return true;
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
