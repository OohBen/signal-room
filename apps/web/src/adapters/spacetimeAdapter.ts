import { useEffect, useMemo, useRef } from "react";
import { useSpacetimeDB, useTable } from "spacetimedb/react";
import { SPACETIME_DATABASE, SPACETIME_TOKEN_KEY, SPACETIME_URI } from "../config";
import { DbConnection, tables } from "../module_bindings";
import type {
  AgentTask as DbAgentTask,
  AgentWorker as DbAgentWorker,
  Cursor as DbCursor,
  Finding as DbFinding,
  MapEdge as DbMapEdge,
  MapNode as DbMapNode,
  NodeAgent as DbNodeAgent,
  Participant as DbParticipant,
  QuestionCandidate as DbQuestionCandidate,
  Room as DbRoom,
  RoomEvent as DbRoomEvent,
  RoomFocus as DbRoomFocus,
  SharedNote as DbSharedNote,
  TranscriptChunk as DbTranscriptChunk,
} from "../module_bindings/types";
import type {
  AgentStatus,
  AgentWorker,
  CursorPin,
  MapEdge,
  MapNode,
  NodeAgentView,
  PresencePin,
  QueueItem,
  RoomEvent,
  RoomSignal,
  SharedNote,
  TopicChunk,
  TranscriptUtterance,
} from "../types/signalRoom";

export interface SpacetimeAdapterStatus {
  mode: "bindings-ready" | "spacetime";
  reason: string;
  isActive: boolean;
  isReady: boolean;
  identity?: string;
  connectionError?: string;
  database: string;
  uri: string;
  roomId?: string;
  counts: {
    rooms: number;
    nodes: number;
    notes: number;
    questions: number;
    tasks: number;
    findings: number;
    transcriptChunks: number;
    participants: number;
  };
  bindingSummary?: {
    reducersLoaded: boolean;
    tablesLoaded: boolean;
  };
}

export interface SpacetimeLiveBridge {
  status: SpacetimeAdapterStatus;
  roomTitle?: string;
  roomDescription?: string;
  roomId?: bigint;
  focusedNodeId?: string;
  mapNodes: MapNode[];
  mapEdges: MapEdge[];
  presence: PresencePin[];
  cursors: CursorPin[];
  workers: AgentWorker[];
  signals: RoomSignal[];
  takeaways: string | undefined;
  sharedNotes: SharedNote[];
  queueItems: QueueItem[];
  transcript: TranscriptUtterance[];
  topicChunks: TopicChunk[];
  roomEvents: RoomEvent[];
  agents: AgentStatus[];
  addSharedNote: (body: string, nodeId?: string, sourceDisplayName?: string) => Promise<boolean>;
  addTranscriptChunk: (text: string, source?: string) => Promise<boolean>;
  createAgentTask: (instructions: string, nodeId?: string) => Promise<boolean>;
  updateMapNode: (nodeId: string, patch: { title?: string; summary?: string; x?: number; y?: number }) => Promise<boolean>;
  setRoomFocus: (nodeId: string, label: string) => Promise<boolean>;
  clearRoomFocus: () => Promise<boolean>;
  upsertParticipant: (
    displayName: string,
    status: string,
    cursorNodeId?: string
  ) => Promise<boolean>;
  moveCursor: (x: number, y: number) => void;
}

export function getRequestedRoomCode(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("room") || window.localStorage.getItem("signal-room.current-room") || "LIVE";
    const normalized = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-").slice(0, 32);
    return normalized || "LIVE";
  } catch {
    return "LIVE";
  }
}

function rowId(value: bigint | number | string): string {
  return value.toString();
}

function nodeUiId(nodeId: bigint): string {
  return `db-node-${rowId(nodeId)}`;
}

function nodeIdFromUi(uiNodeId?: string): bigint | undefined {
  if (!uiNodeId?.startsWith("db-node-")) return undefined;

  try {
    return BigInt(uiNodeId.slice("db-node-".length));
  } catch {
    return undefined;
  }
}

function timestampMillis(value: unknown): number {
  if (value && typeof value === "object") {
    const maybeTimestamp = value as {
      toDate?: () => Date;
      toMillis?: () => bigint;
      __timestamp_micros_since_unix_epoch__?: bigint;
    };
    if (typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate().getTime();
    if (typeof maybeTimestamp.toMillis === "function") return Number(maybeTimestamp.toMillis());
    if (typeof maybeTimestamp.__timestamp_micros_since_unix_epoch__ === "bigint") {
      return Number(maybeTimestamp.__timestamp_micros_since_unix_epoch__ / 1000n);
    }
  }

  return 0;
}

function sortNewest<T>(rows: readonly T[], createdAt: (row: T) => unknown): T[] {
  return [...rows].sort((a, b) => timestampMillis(createdAt(b)) - timestampMillis(createdAt(a)));
}

function initialFromName(name: string): string {
  return (name.trim()[0] || "A").toUpperCase();
}

function sourceKind(source: string): "agent" | "human" | "warn" {
  const lower = source.toLowerCase();
  if (lower.includes("deep") || lower.includes("alert")) return "warn";
  if (lower.includes("ai") || lower.includes("agent") || lower.includes("research")) return "agent";
  return "human";
}

function colorForKey(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return `hsl(${hash % 360} 72% 52%)`;
}

function impactForUrgency(urgency: string): Pick<MapNode, "impact" | "impactTone" | "hasAlert"> {
  if (urgency === "high" || urgency === "urgent") {
    return { impact: "review", impactTone: "down", hasAlert: true };
  }
  if (urgency === "watch") {
    return { impact: "watch", impactTone: "flat", hasAlert: false };
  }
  return { impact: "open", impactTone: "flat", hasAlert: false };
}

function mapNodeAgent(row: DbNodeAgent): NodeAgentView {
  return {
    kind: row.agentKind,
    state: row.agentState,
    insight: row.insight,
    sources: parseSourceChips(row.linksJson),
    confidence: row.confidence,
  };
}

function mapDbNode(row: DbMapNode, agent: DbNodeAgent | undefined): MapNode {
  const impact = impactForUrgency(row.urgency);
  const kind = sourceKind(row.source);
  const isRoot = row.nodeType === "root" || row.title.toLowerCase().includes("estimate");
  const agentView = agent ? mapNodeAgent(agent) : undefined;

  return {
    id: nodeUiId(row.nodeId),
    title: row.title,
    summary: row.summary,
    impact: impact.impact,
    impactTone: impact.impactTone,
    source: row.source,
    ownerInitial: initialFromName(row.source),
    ownerKind: kind,
    positionClass: "",
    x: row.x,
    y: row.y,
    isRoot,
    hasAlert: impact.hasAlert,
    agent: agentView,
    focus: {
      type: row.nodeType.replace(/_/g, " "),
      typeTone: impact.hasAlert ? "red" : kind === "human" ? "green" : "blue",
      age: "live",
      title: row.title,
      text: row.summary,
      impact: impact.impact,
      action: impact.hasAlert ? "Review" : "Keep open",
      source: `Source: ${row.source}`,
      connected: "Connected to: live SpacetimeDB room",
    },
  };
}

function mapDbEdge(edge: DbMapEdge, nodeById: Map<string, DbMapNode>): MapEdge | undefined {
  const from = nodeById.get(rowId(edge.fromNodeId));
  const to = nodeById.get(rowId(edge.toNodeId));
  if (!from || !to) return undefined;
  return {
    id: `db-edge-${rowId(edge.edgeId)}`,
    fromId: nodeUiId(edge.fromNodeId),
    toId: nodeUiId(edge.toNodeId),
    label: edge.label,
  };
}

function connectedNodeName(nodeId: bigint | undefined, nodeById: Map<string, DbMapNode>): string {
  if (nodeId === undefined) return "Room";
  return nodeById.get(rowId(nodeId))?.title ?? "Room";
}

function mapQuestion(row: DbQuestionCandidate, nodeById: Map<string, DbMapNode>): QueueItem {
  return {
    id: `db-question-${rowId(row.questionId)}`,
    title: "Question candidate",
    metaChip: {
      label: row.urgency === "high" ? "needs room choice" : row.status,
      tone: row.urgency === "high" ? "amber" : "default",
    },
    body: row.question,
    chips: [
      { label: `Source: ${row.source}`, tone: sourceKind(row.source) === "human" ? "green" : "violet" },
      { label: `Connected: ${connectedNodeName(row.nodeId, nodeById)}` },
    ],
  };
}

function mapFinding(row: DbFinding, nodeById: Map<string, DbMapNode>): QueueItem {
  const sourceChips = parseSourceChips(row.linksJson);
  const connected = connectedNodeName(row.nodeId, nodeById);
  if (isLikelyRoomPrivateFinding(row.title, row.summary, connected)) {
    return {
      id: `db-finding-${rowId(row.findingId)}`,
      title: "Research not reliable here",
      metaChip: { label: "needs human context", tone: "amber" },
      body:
        "This looks like a room-private claim. Public web search cannot confirm it reliably, so keep it as a claim or ask a narrower general-evidence question.",
      chips: [
        { label: "Source: Research agent", tone: "blue" },
        { label: `Connected: ${connected}` },
      ],
    };
  }
  return {
    id: `db-finding-${rowId(row.findingId)}`,
    title: row.urgency === "high" ? "Important finding" : "Agent finding",
    metaChip: { label: row.status, tone: row.urgency === "high" ? "red" : "blue" },
    body: `${row.title}: ${row.summary}`,
    chips: [
      { label: "Source: Research agent", tone: "blue" },
      { label: `Connected: ${connected}` },
      ...sourceChips,
    ],
  };
}

function isLikelyRoomPrivateFinding(title: string, summary: string, connected: string): boolean {
  const text = `${title} ${summary} ${connected}`.toLowerCase();
  const promptText = `${title} ${connected}`.toLowerCase();
  const hasPrivateCue = /\b(?:victor|ben|michelle|friend|friends|scrabble|diet coke|stole|phone|cake|caffeine|hard work|grades)\b/.test(text);
  const hasPublicCue = /\b(?:linkedin|profile|professional|researcher|university|github|stock|market|company|revenue|filing|earnings|bitcoin|oil|tariff|election|country|government|policy|latest|news|public company)\b/.test(promptText);
  return hasPrivateCue && !hasPublicCue;
}

function parseSourceChips(linksJson: string): QueueItem["chips"] {
  try {
    const parsed = JSON.parse(linksJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 2)
      .map((link) => {
        const title =
          link && typeof link === "object" && "title" in link && typeof link.title === "string"
            ? link.title
            : "source";
        const href =
          link && typeof link === "object" && "url" in link && typeof link.url === "string"
            ? link.url
            : undefined;
        return { label: truncateLabel(title, 34), tone: "default" as const, href };
      });
  } catch {
    return [];
  }
}

function truncateLabel(label: string, maxLength: number): string {
  const clean = label.trim().replace(/\s+/g, " ");
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}...`;
}

function mapSignal(row: DbFinding, nodeById: Map<string, DbMapNode>): RoomSignal {
  const node = row.nodeId === undefined ? undefined : nodeById.get(rowId(row.nodeId));
  // A node-less "Hey agent:" finding is a direct quick-question answer (fast /ask lane).
  const directAsk = /^hey agent:/i.test(row.title.trim());
  if (directAsk) {
    return {
      id: `db-signal-${rowId(row.findingId)}`,
      kind: "answer",
      title: row.title.replace(/^hey agent:\s*/i, "").trim() || "Your question",
      body: row.summary,
      sources: parseSourceChips(row.linksJson),
      connectedNodeId: undefined,
      connectedNodeTitle: "You asked",
    };
  }
  const isAnswer = node?.nodeType === "human_question" || node?.nodeType === "question";
  const connectedNodeTitle = connectedNodeName(row.nodeId, nodeById);
  if (isLikelyRoomPrivateFinding(row.title, row.summary, connectedNodeTitle)) {
    return {
      id: `db-signal-${rowId(row.findingId)}`,
      kind: "important",
      title: "Needs room context",
      body:
        "This prompt depends on private room context or personal framing, so public web research cannot verify it reliably. Ask a narrower public question or add the missing context before treating it as evidence.",
      sources: [],
      connectedNodeId: row.nodeId === undefined ? undefined : nodeUiId(row.nodeId),
      connectedNodeTitle,
    };
  }
  const kind: RoomSignal["kind"] = isAnswer ? "answer" : row.urgency === "high" ? "important" : "finding";
  return {
    id: `db-signal-${rowId(row.findingId)}`,
    kind,
    // Answer cards headline with the question that was asked, not the research directive.
    title: isAnswer && node ? node.title : row.title,
    body: row.summary,
    sources: parseSourceChips(row.linksJson),
    connectedNodeId: row.nodeId === undefined ? undefined : nodeUiId(row.nodeId),
    connectedNodeTitle,
  };
}

function isTakeawaysFinding(row: DbFinding): boolean {
  return row.title.trim().toLowerCase() === "meeting takeaways";
}

function signalRank(kind: RoomSignal["kind"]): number {
  if (kind === "answer") return 0;
  if (kind === "important") return 1;
  return 2;
}

function mapTask(row: DbAgentTask, nodeById: Map<string, DbMapNode>): QueueItem {
  return {
    id: `db-task-${rowId(row.taskId)}`,
    title: `Agent task · ${row.status}`,
    metaChip: { label: row.taskType, tone: row.status === "queued" ? "amber" : "blue" },
    body: row.resultSummary || row.instructions,
    chips: [
      { label: `Priority ${row.priority}` },
      { label: `Connected: ${connectedNodeName(row.nodeId, nodeById)}` },
    ],
  };
}

function mapSharedNote(row: DbSharedNote, nodeById: Map<string, DbMapNode>): SharedNote {
  return {
    id: `db-note-${rowId(row.noteId)}`,
    author: safeDisplayName(row.sourceDisplayName),
    body: row.body,
    connected: connectedNodeName(row.nodeId, nodeById),
  };
}

function mapTranscript(row: DbTranscriptChunk): TranscriptUtterance {
  const timestamp = formatTranscriptTimestamp(row.startMs);

  return {
    id: `db-transcript-${rowId(row.chunkId)}`,
    speaker: row.source,
    timestamp,
    text: row.text,
    chips: [
      { label: "live chunk", tone: "blue" },
      { label: "map input", tone: "green" },
    ],
  };
}

function formatTranscriptTimestamp(startMs: bigint): string {
  if (startMs > 946684800000n) {
    return "live";
  }

  const seconds = Number(startMs / 1000n);
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function mapTopicChunk(row: DbTranscriptChunk): TopicChunk {
  return {
    id: `db-topic-${rowId(row.chunkId)}`,
    window: `Chunk ${rowId(row.chunkId)}`,
    chip: { label: row.source, tone: "blue" },
    summary: row.text,
  };
}

function mapRoomEvent(row: DbRoomEvent): RoomEvent {
  return {
    id: `db-event-${rowId(row.eventId)}`,
    text: row.message,
  };
}

function mapPresence(row: DbParticipant, selfHex: string, nodeById: Map<string, DbMapNode>): PresencePin {
  const idHex = row.identity.toHexString();
  const displayName = safeDisplayName(row.displayName, idHex);
  const viewing = connectedNodeName(row.cursorNodeId, nodeById);
  return {
    id: `db-participant-${rowId(row.participantId)}`,
    label: displayName,
    initial: initialFromName(displayName),
    color: colorForKey(idHex),
    viewing: viewing === "Room" ? "in room" : `viewing ${viewing}`,
    isSelf: idHex === selfHex,
  };
}

function mapCursor(row: DbCursor, selfHex: string): CursorPin {
  const idHex = row.identity.toHexString();
  const displayName = safeDisplayName(row.displayName, idHex);
  return {
    id: `db-cursor-${rowId(row.cursorId)}`,
    label: displayName,
    initial: initialFromName(displayName),
    x: row.x,
    y: row.y,
    color: colorForKey(idHex),
    isSelf: idHex === selfHex,
  };
}

function safeDisplayName(displayName: string, identityHex = ""): string {
  const trimmed = displayName.trim();
  if (trimmed && trimmed.toLowerCase() !== "you") return trimmed;
  const suffix = identityHex ? identityHex.slice(-4).toUpperCase() : "";
  return suffix ? `Guest ${suffix}` : "Guest";
}

function mapWorker(row: DbAgentWorker, nodeById: Map<string, DbMapNode>): AgentWorker {
  return {
    id: `db-worker-${rowId(row.workerId)}`,
    name: row.name,
    persona: row.persona,
    status: row.status,
    detail: row.detail,
    currentNodeId:
      row.currentNodeId === undefined || nodeById.get(rowId(row.currentNodeId)) === undefined
        ? undefined
        : nodeUiId(row.currentNodeId),
    completedCount: row.completedCount,
    active: row.status !== "idle" && row.status !== "done",
  };
}

function mapAgentStatus(tasks: readonly DbAgentTask[], findings: readonly DbFinding[]): AgentStatus[] {
  const queued = tasks.filter((task) => task.status === "queued").length;
  const running = tasks.filter((task) => task.status === "claimed").length;
  const alerts = findings.filter((finding) => finding.urgency === "high").length;

  return [
    {
      id: "router",
      name: "Router",
      summary: "Listening silently and routing transcript chunks into map work.",
      status: running ? "busy" : "ready",
    },
    {
      id: "research",
      name: "Research",
      summary: queued ? `${queued} queued task${queued === 1 ? "" : "s"}` : "No queued research.",
      status: queued ? "busy" : "ready",
    },
    {
      id: "alerts",
      name: "Findings",
      summary: alerts ? `${alerts} red-dot finding${alerts === 1 ? "" : "s"}` : "No urgent findings.",
      status: alerts ? "alert" : "ready",
    },
  ];
}

export function useSpacetimeLiveBridge(displayName: string, roomCode: string): SpacetimeLiveBridge {
  const connectionState = useSpacetimeDB();
  const conn = connectionState.getConnection() as DbConnection | null;
  const roomEnsureRef = useRef(false);
  const joinedKeyRef = useRef("");
  const cursorSendRef = useRef(0);

  const [rooms, roomsReady] = useTable(tables.room);
  const [nodes, nodesReady] = useTable(tables.mapNode);
  const [edges, edgesReady] = useTable(tables.mapEdge);
  const [notes, notesReady] = useTable(tables.sharedNote);
  const [questions, questionsReady] = useTable(tables.questionCandidate);
  const [tasks, tasksReady] = useTable(tables.agentTask);
  const [findings, findingsReady] = useTable(tables.finding);
  const [transcripts, transcriptsReady] = useTable(tables.transcriptChunk);
  const [participants, participantsReady] = useTable(tables.participant);
  const [focusRows, focusReady] = useTable(tables.roomFocus);
  const [events, eventsReady] = useTable(tables.roomEvent);
  const [cursorRows, cursorsReady] = useTable(tables.cursor);
  const [workerRows, workersReady] = useTable(tables.agentWorker);
  const [nodeAgentRows, nodeAgentsReady] = useTable(tables.nodeAgent);

  const selfHex = connectionState.identity?.toHexString() ?? "";

  const roomRow = useMemo(
    () => (rooms as readonly DbRoom[]).find((room) => room.code === roomCode),
    [roomCode, rooms]
  );

  const roomId = roomRow?.roomId;

  useEffect(() => {
    if (connectionState.token) {
      window.localStorage.setItem(SPACETIME_TOKEN_KEY, connectionState.token);
    }
  }, [connectionState.token]);

  useEffect(() => {
    window.localStorage.setItem("signal-room.current-room", roomCode);
  }, [roomCode]);

  useEffect(() => {
    if (!conn || !connectionState.isActive || !roomsReady) return;

    if (!roomRow && !roomEnsureRef.current) {
      roomEnsureRef.current = true;
      void conn.reducers.createRoom({
        code: roomCode,
        title: `Signal Room ${roomCode}`,
        displayName,
      })
        .catch((error: unknown) => {
          roomEnsureRef.current = false;
          console.error("Unable to create Signal Room", error);
        });
      return;
    }

    if (roomRow) {
      const joinKey = `${rowId(roomRow.roomId)}:${displayName}`;
      if (joinedKeyRef.current !== joinKey) {
        joinedKeyRef.current = joinKey;
        void conn.reducers.joinRoom({ code: roomCode, displayName }).catch(
          (error: unknown) => {
            console.error("Unable to join Signal Room", error);
          }
        );
      }
    }
  }, [conn, connectionState.isActive, roomRow, displayName, roomCode, roomsReady]);

  const roomRows = useMemo(() => {
    if (roomId === undefined) {
      return {
        nodes: [] as DbMapNode[],
        edges: [] as DbMapEdge[],
        notes: [] as DbSharedNote[],
        questions: [] as DbQuestionCandidate[],
        tasks: [] as DbAgentTask[],
        findings: [] as DbFinding[],
        transcripts: [] as DbTranscriptChunk[],
        participants: [] as DbParticipant[],
        focusRows: [] as DbRoomFocus[],
        events: [] as DbRoomEvent[],
        cursors: [] as DbCursor[],
        workers: [] as DbAgentWorker[],
        nodeAgents: [] as DbNodeAgent[],
      };
    }

    return {
      nodes: (nodes as readonly DbMapNode[]).filter((row) => row.roomId === roomId),
      edges: (edges as readonly DbMapEdge[]).filter((row) => row.roomId === roomId),
      notes: (notes as readonly DbSharedNote[]).filter((row) => row.roomId === roomId),
      questions: (questions as readonly DbQuestionCandidate[]).filter((row) => row.roomId === roomId),
      tasks: (tasks as readonly DbAgentTask[]).filter((row) => row.roomId === roomId),
      findings: (findings as readonly DbFinding[]).filter((row) => row.roomId === roomId),
      transcripts: (transcripts as readonly DbTranscriptChunk[]).filter((row) => row.roomId === roomId),
      participants: (participants as readonly DbParticipant[]).filter((row) => row.roomId === roomId),
      focusRows: (focusRows as readonly DbRoomFocus[]).filter((row) => row.roomId === roomId),
      events: (events as readonly DbRoomEvent[]).filter((row) => row.roomId === roomId),
      cursors: (cursorRows as readonly DbCursor[]).filter((row) => row.roomId === roomId),
      workers: (workerRows as readonly DbAgentWorker[]).filter((row) => row.roomId === roomId),
      nodeAgents: (nodeAgentRows as readonly DbNodeAgent[]).filter((row) => row.roomId === roomId),
    };
  }, [
    cursorRows,
    edges,
    events,
    findings,
    focusRows,
    nodeAgentRows,
    nodes,
    notes,
    participants,
    questions,
    roomId,
    tasks,
    transcripts,
    workerRows,
  ]);

  const nodeById = useMemo(() => {
    return new Map(roomRows.nodes.map((node) => [rowId(node.nodeId), node]));
  }, [roomRows.nodes]);

  const nodeAgentById = useMemo(() => {
    return new Map(roomRows.nodeAgents.map((agent) => [rowId(agent.nodeId), agent]));
  }, [roomRows.nodeAgents]);

  const liveReady =
    roomsReady &&
    nodesReady &&
    edgesReady &&
    notesReady &&
    questionsReady &&
    tasksReady &&
    findingsReady &&
    transcriptsReady &&
    participantsReady &&
    focusReady &&
    eventsReady &&
    cursorsReady &&
    workersReady &&
    nodeAgentsReady;

  const status: SpacetimeAdapterStatus = useMemo(
    () => ({
      mode: connectionState.isActive && liveReady ? "spacetime" : "bindings-ready",
      reason:
        connectionState.isActive && liveReady
          ? "Connected to the published Signal Room SpacetimeDB database."
          : "Generated bindings are ready; the app is connecting or showing the local preview state.",
      isActive: connectionState.isActive,
      isReady: liveReady,
      identity: connectionState.identity?.toHexString(),
      connectionError: connectionState.connectionError?.message,
      database: SPACETIME_DATABASE,
      uri: SPACETIME_URI,
      roomId: roomId === undefined ? undefined : rowId(roomId),
      counts: {
        rooms: rooms.length,
        nodes: roomRows.nodes.length,
        notes: roomRows.notes.length,
        questions: roomRows.questions.length,
        tasks: roomRows.tasks.length,
        findings: roomRows.findings.length,
        transcriptChunks: roomRows.transcripts.length,
        participants: roomRows.participants.length,
      },
      bindingSummary: {
        reducersLoaded: Boolean(conn?.reducers),
        tablesLoaded: Boolean(tables),
      },
    }),
    [
      conn?.reducers,
      connectionState.connectionError?.message,
      connectionState.identity,
      connectionState.isActive,
      liveReady,
      roomId,
      roomRows.findings.length,
      roomRows.nodes.length,
      roomRows.notes.length,
      roomRows.participants.length,
      roomRows.questions.length,
      roomRows.tasks.length,
      roomRows.transcripts.length,
      rooms.length,
    ]
  );

  const focusedNodeId = roomRows.focusRows[0]?.nodeId;

  return {
    status,
    roomTitle: roomRow?.title,
    roomDescription: roomRow?.description,
    roomId,
    focusedNodeId: focusedNodeId === undefined ? undefined : nodeUiId(focusedNodeId),
    mapNodes: roomRows.nodes.map((node) => mapDbNode(node, nodeAgentById.get(rowId(node.nodeId)))),
    mapEdges: roomRows.edges
      .map((edge) => mapDbEdge(edge, nodeById))
      .filter((edge): edge is MapEdge => Boolean(edge)),
    presence: roomRows.participants.map((participant) =>
      mapPresence(participant, selfHex, nodeById)
    ),
    cursors: roomRows.cursors
      .filter((cursor) => cursor.identity.toHexString() !== selfHex)
      .filter((cursor) => Date.now() - timestampMillis(cursor.updatedAt) < 15000)
      .map((cursor) => mapCursor(cursor, selfHex)),
    workers: sortNewest(roomRows.workers, (row) => row.updatedAt).map((worker) =>
      mapWorker(worker, nodeById)
    ),
    signals: sortNewest(roomRows.findings, (row) => row.createdAt)
      .filter((finding) => !isTakeawaysFinding(finding))
      .map((finding) => mapSignal(finding, nodeById))
      .sort((a, b) => signalRank(a.kind) - signalRank(b.kind))
      .slice(0, 8),
    takeaways: sortNewest(roomRows.findings, (row) => row.createdAt).find(isTakeawaysFinding)?.summary,
    sharedNotes: sortNewest(roomRows.notes, (row) => row.createdAt)
      .slice(0, 8)
      .map((note) => mapSharedNote(note, nodeById)),
    queueItems: [
      ...sortNewest(roomRows.findings, (row) => row.createdAt)
        .slice(0, 4)
        .map((finding) => mapFinding(finding, nodeById)),
      ...sortNewest(roomRows.questions, (row) => row.createdAt)
        .filter((question) => question.status === "open")
        .slice(0, 4)
        .map((question) => mapQuestion(question, nodeById)),
      ...sortNewest(roomRows.tasks, (row) => row.createdAt)
        .filter((task) => task.status !== "completed")
        .slice(0, 3)
        .map((task) => mapTask(task, nodeById)),
    ],
    transcript: sortNewest(roomRows.transcripts, (row) => row.createdAt).map(mapTranscript),
    topicChunks: sortNewest(roomRows.transcripts, (row) => row.createdAt).map(mapTopicChunk),
    roomEvents: sortNewest(roomRows.events, (row) => row.createdAt)
      .slice(0, 5)
      .map(mapRoomEvent),
    agents: mapAgentStatus(roomRows.tasks, roomRows.findings),
    addSharedNote: async (body: string, nodeId?: string, sourceDisplayName = displayName) => {
      if (!conn || !connectionState.isActive || roomId === undefined) return false;
      await conn.reducers.addSharedNote({
        roomId,
        nodeId: nodeIdFromUi(nodeId),
        body,
        sourceDisplayName,
      });
      return true;
    },
    addTranscriptChunk: async (text: string, source = "Room conversation") => {
      if (!conn || !connectionState.isActive || roomId === undefined) return false;
      const now = Date.now();
      await conn.reducers.addTranscriptChunk({
        roomId,
        source,
        text,
        startMs: BigInt(Math.max(0, now - 5000)),
        endMs: BigInt(now),
        sourceParticipantId: undefined,
      });
      return true;
    },
    createAgentTask: async (instructions: string, nodeId?: string) => {
      if (!conn || !connectionState.isActive || roomId === undefined) return false;
      await conn.reducers.createAgentTask({
        roomId,
        nodeId: nodeIdFromUi(nodeId),
        taskType: "human_redirect",
        instructions,
        priority: 1,
      });
      return true;
    },
    updateMapNode: async (nodeId: string, patch: { title?: string; summary?: string; x?: number; y?: number }) => {
      if (!conn || !connectionState.isActive || roomId === undefined) return false;
      const dbNodeId = nodeIdFromUi(nodeId);
      if (dbNodeId === undefined) return false;
      await conn.reducers.updateMapNode({
        nodeId: dbNodeId,
        title: patch.title,
        summary: patch.summary,
        nodeType: undefined,
        source: undefined,
        urgency: undefined,
        x: patch.x,
        y: patch.y,
      });
      return true;
    },
    setRoomFocus: async (nodeId: string, label: string) => {
      if (!conn || !connectionState.isActive || roomId === undefined) return false;
      await conn.reducers.setRoomFocus({
        roomId,
        nodeId: nodeIdFromUi(nodeId),
        label,
      });
      return true;
    },
    clearRoomFocus: async () => {
      if (!conn || !connectionState.isActive || roomId === undefined) return false;
      await conn.reducers.setRoomFocus({
        roomId,
        nodeId: undefined,
        label: "Room synthesis",
      });
      return true;
    },
    upsertParticipant: async (name: string, statusText: string, cursorNodeId?: string) => {
      if (!conn || !connectionState.isActive || roomId === undefined) return false;
      await conn.reducers.upsertParticipant({
        roomId,
        displayName: name,
        role: "participant",
        status: statusText,
        cursorNodeId: nodeIdFromUi(cursorNodeId),
      });
      return true;
    },
    moveCursor: (x: number, y: number) => {
      if (!conn || !connectionState.isActive || roomId === undefined) return;
      const now = Date.now();
      if (now - cursorSendRef.current < 55) return;
      cursorSendRef.current = now;
      conn.reducers.updateCursor({ roomId, x, y, displayName }).catch(() => {
        // Cursor frames are ephemeral; dropping one is harmless.
      });
    },
  };
}
