export type ScreenId = "room" | "host" | "laptop" | "transcript" | "thread";

export type WorkspaceLayout = "canvas" | "briefing";

export type ChipTone = "default" | "blue" | "green" | "red" | "amber" | "violet";

export type ImpactTone = "up" | "down" | "flat";

export type OwnerKind = "agent" | "human" | "warn";

export interface Chip {
  label: string;
  tone?: ChipTone;
  href?: string;
}

export interface FocusDetail {
  type: string;
  typeTone: ChipTone;
  age: string;
  title: string;
  text: string;
  impact: string;
  action: string;
  source: string;
  connected: string;
}

export interface MapNode {
  id: string;
  title: string;
  summary: string;
  impact: string;
  impactTone: ImpactTone;
  source: string;
  ownerInitial: string;
  ownerKind: OwnerKind;
  positionClass: string;
  x?: number;
  y?: number;
  isRoot?: boolean;
  hasAlert?: boolean;
  focus: FocusDetail;
}

export interface MapEdge {
  id: string;
  path: string;
}

export interface PresencePin {
  id: string;
  label: string;
  positionClass: string;
  tone: "blue" | "green";
}

export interface QueueItem {
  id: string;
  title: string;
  metaChip: Chip;
  body: string;
  chips: Chip[];
}

export interface RoomEvent {
  id: string;
  text: string;
}

export interface TranscriptUtterance {
  id: string;
  speaker: string;
  timestamp: string;
  text: string;
  chips: Chip[];
}

export interface TopicChunk {
  id: string;
  window: string;
  chip: Chip;
  summary: string;
}

export interface AgentStatus {
  id: string;
  name: string;
  summary: string;
  status: "ready" | "busy" | "alert";
}

export interface PersonalMapCard {
  id: string;
  title: string;
  body: string;
  chip: Chip;
  ownerInitial: string;
  ownerKind: OwnerKind;
  ownerLabel: string;
}

export interface ScratchpadEntry {
  id: string;
  title: string;
  body: string;
}

export interface SharedNote {
  id: string;
  author: string;
  body: string;
  connected: string;
}

export interface ThreadStep {
  id: string;
  title: string;
  body: string;
}

export interface AgentThread {
  title: string;
  summary: string;
  impact: string;
  steps: ThreadStep[];
  findingParagraph: string;
  findingBullets: string[];
  humanEdits: string[];
  sourceSummary: string;
  agentQuestion: string;
  nextUpdate: string;
}

export interface SignalRoomState {
  roomCode: string;
  displayName: string;
  question: string;
  questionSubtitle: string;
  synthesisState: string;
  defaultFocusNodeId: string;
  mapNodes: MapNode[];
  mapEdges: MapEdge[];
  presence: PresencePin[];
  roomEvents: RoomEvent[];
  queueItems: QueueItem[];
  transcript: TranscriptUtterance[];
  topicChunks: TopicChunk[];
  agents: AgentStatus[];
  personalCards: PersonalMapCard[];
  scratchpad: ScratchpadEntry[];
  sharedNotes: SharedNote[];
  thread: AgentThread;
}
