import type { RealtimeFunctionTool } from "openai/resources/realtime/realtime";

import type { RealtimeRoomContext, RealtimeRoomSnapshot } from "./realtimeRoomTools.js";

export const REALTIME_ROOM_TOOLS: RealtimeFunctionTool[] = [
  {
    type: "function",
    name: "add_map_signal",
    description:
      "Add one meaningful shared map card from the latest room turn. If the latest turn states the main room question and no center exists, add that question as kind=topic. If the latest turn lists several material factors, call this once per factor with kind=factor and connectedTo set to the current center. Never call this for filler, acknowledgements, or tiny utterances.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "title", "summary"],
      properties: {
        kind: {
          type: "string",
          enum: ["topic", "factor", "question", "claim", "topic_shift", "summary"],
          description: "What kind of map item this is.",
        },
        title: {
          type: "string",
          minLength: 4,
          maxLength: 72,
          description: "Short card title. No speaker labels.",
        },
        summary: {
          type: "string",
          minLength: 18,
          maxLength: 220,
          description: "What changed or what the room should preserve.",
        },
        connectedTo: {
          type: "string",
          maxLength: 72,
          description: "Existing nearby topic title to connect this signal to, if obvious.",
        },
        urgency: {
          type: "string",
          enum: ["normal", "high"],
          description: "Use high only if the room should notice soon.",
        },
        question: {
          type: "string",
          maxLength: 180,
          description: "Optional passive question to put on screen for humans to choose from.",
        },
        task: {
          type: "string",
          maxLength: 240,
          description: "Optional quick research task if the topic can be checked from public/current sources.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "How confident you are that this belongs on the map.",
        },
      },
    },
  },
  {
    type: "function",
    name: "add_passive_question",
    description:
      "Put a quiet suggested question on screen. It must not interrupt the room; humans decide whether to discuss it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string", minLength: 8, maxLength: 180 },
        connectedTo: { type: "string", maxLength: 72 },
        urgency: { type: "string", enum: ["normal", "high"] },
        reason: { type: "string", maxLength: 160 },
      },
    },
  },
  {
    type: "function",
    name: "summon_quick_agent",
    description:
      "Queue a fast background research task when the room explicitly asks the agent to look something up or when a public/current check is clearly useful.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: {
        task: { type: "string", minLength: 12, maxLength: 240 },
        connectedTo: { type: "string", maxLength: 72 },
        urgency: { type: "string", enum: ["normal", "high"] },
      },
    },
  },
  {
    type: "function",
    name: "correct_map_node",
    description:
      "Correct an existing map card when the latest turn fixes a transcription mistake, clarifies the main question, or says an existing card is wrong. Prefer this over adding a new topic_shift for direct corrections.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["target"],
      properties: {
        target: {
          type: "string",
          maxLength: 72,
          description: "Existing map title to correct, or 'center' for the root/current main question.",
        },
        title: {
          type: "string",
          maxLength: 72,
          description: "Corrected card title, if the title changed.",
        },
        summary: {
          type: "string",
          maxLength: 220,
          description: "Corrected summary, if the card meaning changed.",
        },
        urgency: { type: "string", enum: ["normal", "high"] },
      },
    },
  },
  {
    type: "function",
    name: "ignore_turn",
    description:
      "Use when the latest transcript is filler, too short, a backchannel, or not useful for transcript-derived room state.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        reason: { type: "string", maxLength: 120 },
      },
    },
  },
];

export const ACTION_REALTIME_ROOM_TOOLS: RealtimeFunctionTool[] = REALTIME_ROOM_TOOLS.filter(
  (tool) => tool.name !== "ignore_turn"
);

export function buildOperatorInstructions(): string {
  return [
    "You are Signal Room's silent realtime operator.",
    "You are not a chatbot. Do not answer the meeting. Do not interrupt. Do not produce user-facing prose.",
    "Your only job is to make small tool calls that keep a shared research map useful while people keep talking.",
    "This operator is called only after a deterministic prefilter selected a map-worthy turn. Make one useful state update; do not no-op.",
    "Judge the LATEST TRANSCRIPT TURN first. Use recent context only to resolve pronouns like 'it' or 'that'.",
    "The map has one center. If Current map center is empty, generic, or missing, and the latest turn names the main question, call add_map_signal once with kind='topic'. The title must be the actual question or target, not a vague discussion label.",
    "If the latest turn says a main topic is coming but does not actually name the target yet, add a passive question only if it gives humans a useful next prompt.",
    "If there is no usable center yet and the latest turn only lists factors, do not invent a center from those factors. Add a passive question only if one factor is clearly worth preserving.",
    "If a real center already exists, do not create another card that merely restates it. Add new cards only for new factors, claims, questions, shifts, or agent requests.",
    "If the latest turn corrects a prior mishearing or says 'not X, Y', use correct_map_node on the existing card. Example: if the center says 'spot at Scrabble' and the room says 'not spot, bot', correct the center/title to 'Ben's bot at Scrabble'.",
    "When the latest turn enumerates factors, e.g. 'it is going to be about A, B, C', create separate kind='factor' map signals for each material factor. Connect each to the exact Current map center title.",
    "When a participant asks for data or says 'agent, look up/research/find/figure out', create a map signal for the request and include a task on that same signal only when it is public/current-source researchable.",
    "If the latest turn materially contradicts the current center, changes the expected answer, or sounds game-changing for the room, set urgency='high' and make the title/action specific.",
    "Only use summon_quick_agent without add_map_signal when the room asks for a quick check that does not deserve a card.",
    "Only set connectedTo to an exact title listed in Current map. If unsure, omit it.",
    "Use add_passive_question for quiet questions that humans may choose to discuss. AI never asks these aloud.",
    "Filler, acknowledgements, jokes, repetition, or turns too small to preserve should not reach this operator. If one does, add the least intrusive passive question only when it is genuinely useful.",
    "Do not create a card titled 'Brief utterance', 'Conversation summary', 'Current discussion', 'NVIDIA discussion', or similar low-information generic labels.",
    "Bad center titles: 'Gas discussion', 'NVIDIA interest', 'Current discussion'. Good center titles: 'Gas prices this month vs $100', 'NVIDIA Q4 2026 outlook'.",
    "Bad factor handling: one card named 'Geopolitical events'. Good factor handling: separate cards like 'Russian sanctions', 'Ukraine war', 'Strait of Hormuz risk', each connected to the center.",
    "Do not preserve turns like 'oh, that', 'um', 'yeah', or short acknowledgements as map cards.",
    "Do not invent sources, facts, countries, companies, or dates that were not in the transcript.",
    "If a topic is not researchable from public/current sources, preserve it as a map signal or passive question and omit the task.",
    "Private-room claims about people in the room, e.g. who worked harder, who drank caffeine, who stole a phone, or a Scrabble matchup, should usually be preserved as claims/questions without web research tasks unless the room explicitly asks for general outside evidence.",
    "Prefer one strong tool call over many weak ones. Exception: a factor-list turn may create up to five factor cards.",
  ].join("\n");
}

export interface RealtimeOperatorInput {
  latestTranscript: string;
  recentContext: string;
  snapshot: RealtimeRoomSnapshot;
}

export function buildOperatorInput(context: RealtimeRoomContext, input: RealtimeOperatorInput): string {
  return [
    `Room code: ${cleanOperatorContext(context.roomCode)}`,
    `Participant name: ${cleanOperatorContext(context.displayName)}`,
    "Current map:",
    formatSnapshot(input.snapshot),
    "",
    "Recent prior context:",
    input.recentContext.trim().slice(-1400) || "(none)",
    "",
    "LATEST TRANSCRIPT TURN TO ROUTE:",
    input.latestTranscript.trim().slice(-900),
    "",
    "Decide whether the shared state needs a map signal, passive question, quick-agent task, or no action.",
  ].join("\n");
}

export function formatSnapshot(snapshot: RealtimeRoomSnapshot): string {
  const lines = [`center: ${snapshot.rootTitle ?? "(none)"}`];
  if (snapshot.nodes.length === 0) {
    lines.push("nodes: (none)");
    return lines.join("\n");
  }

  lines.push("nodes:");
  for (const node of snapshot.nodes) {
    lines.push(`- [${node.nodeType}] ${node.title}: ${node.summary}`);
  }
  return lines.join("\n");
}

export function cleanOperatorContext(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) || "unknown" : "unknown";
}
