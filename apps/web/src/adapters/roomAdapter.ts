import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScratchpadEntry, SignalRoomState } from "../types/signalRoom";
import {
  getRequestedRoomCode,
  useSpacetimeLiveBridge,
  type SpacetimeAdapterStatus,
} from "./spacetimeAdapter";

interface PersistedRoomState {
  displayName: string;
  scratchpad: ScratchpadEntry[];
}

export interface SignalRoomActions {
  setFocusNode: (nodeId: string) => void;
  clearFocusNode: () => void;
  setDisplayName: (displayName: string) => void;
  addPrivatePrompt: (text: string) => void;
  addSharedNote: (text: string) => Promise<boolean>;
  addTranscriptChunk: (text: string) => Promise<boolean>;
  redirectAgent: (text: string) => Promise<boolean>;
  updateMapNode: (nodeId: string, patch: { title?: string; summary?: string }) => Promise<boolean>;
  moveMapNode: (nodeId: string, x: number, y: number) => Promise<boolean>;
  moveCursor: (x: number, y: number) => void;
}

export interface SignalRoomSnapshot {
  state: SignalRoomState;
  focusNodeId: string;
  focusedNode: SignalRoomState["mapNodes"][number];
  adapterStatus: SpacetimeAdapterStatus;
  actions: SignalRoomActions;
}

const STORAGE_KEY = "signal-room.web.local-state.v1";
const DEFAULT_DISPLAY_NAME_PREFIX = "Guest";

function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readPersistedState(): Partial<PersistedRoomState> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedRoomState>) : {};
  } catch {
    return {};
  }
}

function createGuestDisplayName(): string {
  const bytes = new Uint8Array(2);
  const cryptoApi = globalThis.crypto;
  const suffix = cryptoApi
    ? Array.from(cryptoApi.getRandomValues(bytes))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    : Date.now().toString(36).slice(-4).toUpperCase();
  return `${DEFAULT_DISPLAY_NAME_PREFIX} ${suffix}`;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "You") return undefined;
  return trimmed;
}

function createInitialState(): SignalRoomState {
  const persisted = readPersistedState();
  const roomCode = getRequestedRoomCode();
  const displayName = normalizeDisplayName(persisted.displayName) ?? createGuestDisplayName();
  const blank = createBlankRoomState(roomCode, displayName);

  return {
    ...blank,
    scratchpad: persisted.scratchpad?.length ? persisted.scratchpad : blank.scratchpad,
  };
}

function createBlankRoomState(roomCode: string, displayName: string): SignalRoomState {
  return {
    roomCode,
    displayName,
    question: `Signal Room ${roomCode}`,
    questionSubtitle: `${roomCode} · live SpacetimeDB room · waiting for conversation and agents`,
    synthesisState: "Live",
    defaultFocusNodeId: "empty-room",
    mapNodes: [],
    mapEdges: [],
    presence: [],
    cursors: [],
    workers: [],
    signals: [],
    roomEvents: [
      {
        id: "room-ready",
        text: "Fresh room ready. Transcript chunks, quiet notes, and agent findings will appear live.",
      },
    ],
    queueItems: [],
    transcript: [],
    topicChunks: [],
    agents: [
      {
        id: "router",
        name: "Room router",
        summary: "Listening for transcript chunks and quiet notes.",
        status: "ready",
      },
      {
        id: "research",
        name: "Research worker",
        summary: "Waiting for a queued research task.",
        status: "ready",
      },
    ],
    personalCards: [],
    scratchpad: [
      {
        id: "scratchpad-empty",
        title: "Private notes",
        body: "Test an idea privately, then add it to the shared map when it is useful.",
      },
    ],
    sharedNotes: [],
    thread: {
      title: "Waiting for first thread",
      summary: "Open a map node after the room has live branches.",
      impact: "No active finding yet.",
      steps: [],
      findingParagraph: "The room has not produced a finding yet.",
      findingBullets: [],
      humanEdits: [],
      sourceSummary: "No sources attached yet.",
      agentQuestion: "What should the room investigate first?",
      nextUpdate: "After the first transcript chunk or quiet note.",
    },
  };
}

function mergeLiveState(base: SignalRoomState, live: ReturnType<typeof useSpacetimeLiveBridge>): SignalRoomState {
  const hasLiveRoomData =
    live.status.mode === "spacetime" && live.status.isReady && live.status.roomId !== undefined;

  if (!hasLiveRoomData) {
    return base;
  }

  return {
    ...base,
    question: displayRoomTitle(live.roomTitle, base.roomCode),
    questionSubtitle: `${base.roomCode} · live SpacetimeDB room · watch it fill from conversation and agents`,
    synthesisState: "Live",
    defaultFocusNodeId: live.focusedNodeId ?? base.defaultFocusNodeId,
    mapNodes: live.mapNodes,
    mapEdges: live.mapEdges,
    presence: live.presence,
    cursors: live.cursors,
    workers: live.workers,
    signals: live.signals,
    roomEvents: live.roomEvents,
    queueItems: live.queueItems,
    transcript: live.transcript,
    topicChunks: live.topicChunks,
    agents: live.agents,
    sharedNotes: live.sharedNotes,
  };
}

function displayRoomTitle(title: string | undefined, roomCode: string): string {
  const trimmed = title?.trim();
  if (!trimmed) {
    return `Signal Room ${roomCode}`;
  }
  return trimmed;
}

export function useRoomState(): SignalRoomSnapshot {
  const [state, setState] = useState<SignalRoomState>(() => createInitialState());
  const [focusNodeId, setFocusNodeId] = useState(state.defaultFocusNodeId);
  const live = useSpacetimeLiveBridge(state.displayName, state.roomCode);
  const visibleState = useMemo(() => mergeLiveState(state, live), [live, state]);

  useEffect(() => {
    const persisted: PersistedRoomState = {
      displayName: state.displayName,
      scratchpad: state.scratchpad,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [state.displayName, state.scratchpad]);

  useEffect(() => {
    if (state.displayName.trim().toLowerCase() !== "you") return;
    const normalized = createGuestDisplayName();
    setState((current) => ({ ...current, displayName: normalized }));
    void live.upsertParticipant(normalized, "online", focusNodeId).catch((error: unknown) => {
      console.error("Unable to migrate participant name", error);
    });
  }, [focusNodeId, live, state.displayName]);

  const focusedNode = useMemo(() => {
    return (
      visibleState.mapNodes.find((node) => node.id === focusNodeId) ??
      visibleState.mapNodes[0] ?? {
        id: "empty-room",
        title: "Waiting for first signal",
        summary: "Start talking or replay a transcript and this room will build itself.",
        impact: "ready",
        impactTone: "flat" as const,
        source: "Room router",
        ownerInitial: "R",
        ownerKind: "agent" as const,
        positionClass: "",
        focus: {
          type: "empty room",
          typeTone: "blue" as const,
          age: "live",
          title: "Waiting for first signal",
          text: "The room exists in SpacetimeDB. Transcript chunks, human notes, and agent findings will appear here as reducers write shared state.",
          impact: "Ready",
          action: "Listen",
          source: "Source: Room router",
          connected: "Connected to: live SpacetimeDB room",
        },
      }
    );
  }, [focusNodeId, visibleState.mapNodes]);

  useEffect(() => {
    if (!live.focusedNodeId || focusNodeId === live.focusedNodeId) return;
    if (visibleState.mapNodes.some((node) => node.id === live.focusedNodeId)) {
      setFocusNodeId(live.focusedNodeId);
    }
  }, [focusNodeId, live.focusedNodeId, visibleState.mapNodes]);

  const setFocusNode = useCallback(
    (nodeId: string) => {
      const node = visibleState.mapNodes.find((candidate) => candidate.id === nodeId);
      if (node) {
        setFocusNodeId(nodeId);
        void live.setRoomFocus(nodeId, node.title).catch((error: unknown) => {
          console.error("Unable to sync room focus", error);
        });
      }
    },
    [live, visibleState.mapNodes]
  );

  const clearFocusNode = useCallback(() => {
    setFocusNodeId("");
    void live.clearRoomFocus().catch((error: unknown) => {
      console.error("Unable to clear room focus", error);
    });
  }, [live]);

  const setDisplayName = useCallback((displayName: string) => {
    const normalized = displayName.trim() || createGuestDisplayName();
    setState((current) => ({ ...current, displayName: normalized }));
    void live.upsertParticipant(normalized, "online", focusNodeId).catch((error: unknown) => {
      console.error("Unable to sync participant", error);
    });
  }, [focusNodeId, live]);

  const addPrivatePrompt = useCallback((text: string) => {
    const body = text.trim();
    if (!body) return;

    setState((current) => ({
      ...current,
      scratchpad: [
        {
          id: createId("scratch"),
          title: `${current.displayName} typed`,
          body,
        },
        {
          id: createId("scratch-ai"),
          title: "Private note saved",
          body: "This stays local unless you add it to the shared room map.",
        },
        ...current.scratchpad,
      ],
    }));
  }, []);

  const addSharedNote = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body) return false;

      try {
        return await live.addSharedNote(body, focusNodeId, state.displayName);
      } catch (error: unknown) {
        console.error("Unable to sync shared note", error);
        return false;
      }
    },
    [focusNodeId, live, state.displayName]
  );

  const addTranscriptChunk = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body) return false;

      try {
        return await live.addTranscriptChunk(body);
      } catch (error: unknown) {
        console.error("Unable to sync transcript chunk", error);
        return false;
      }
    },
    [live]
  );

  const redirectAgent = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body) return false;

    try {
      const synced = await live.createAgentTask(body, focusNodeId);
      if (!synced) return false;
    } catch (error: unknown) {
      console.error("Unable to sync agent redirect", error);
      return false;
    }

    setState((current) => ({
      ...current,
      scratchpad: [
        {
          id: createId("redirect"),
          title: "Agent redirected",
          body,
        },
        ...current.scratchpad,
      ],
    }));
    return true;
  }, [focusNodeId, live]);

  const updateMapNode = useCallback(
    async (nodeId: string, patch: { title?: string; summary?: string }) => {
      const title = patch.title?.trim();
      const summary = patch.summary?.trim();
      if (!title && !summary) return false;

      try {
        return await live.updateMapNode(nodeId, { title, summary });
      } catch (error: unknown) {
        console.error("Unable to update map node", error);
        return false;
      }
    },
    [live]
  );

  const moveMapNode = useCallback(
    async (nodeId: string, x: number, y: number) => {
      try {
        return await live.updateMapNode(nodeId, { x, y });
      } catch (error: unknown) {
        console.error("Unable to move map node", error);
        return false;
      }
    },
    [live]
  );

  const moveCursor = useCallback(
    (x: number, y: number) => {
      live.moveCursor(x, y);
    },
    [live]
  );

  const actions = useMemo<SignalRoomActions>(
    () => ({
      setFocusNode,
      clearFocusNode,
      setDisplayName,
      addPrivatePrompt,
      addSharedNote,
      addTranscriptChunk,
      redirectAgent,
      updateMapNode,
      moveMapNode,
      moveCursor,
    }),
    [
      addPrivatePrompt,
      addSharedNote,
      addTranscriptChunk,
      clearFocusNode,
      moveMapNode,
      moveCursor,
      redirectAgent,
      setDisplayName,
      setFocusNode,
      updateMapNode,
    ]
  );

  return {
    state: visibleState,
    focusNodeId,
    focusedNode,
    adapterStatus: live.status,
    actions,
  };
}
