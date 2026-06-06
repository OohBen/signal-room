import { useCallback, useEffect, useMemo, useState } from "react";
import { seedRoomState } from "../data/seedRoom";
import type { ScratchpadEntry, SharedNote, SignalRoomState } from "../types/signalRoom";
import {
  getRequestedRoomCode,
  useSpacetimeLiveBridge,
  type SpacetimeAdapterStatus,
} from "./spacetimeAdapter";

interface PersistedRoomState {
  displayName: string;
  scratchpad: ScratchpadEntry[];
  sharedNotes: SharedNote[];
}

export interface SignalRoomActions {
  setFocusNode: (nodeId: string) => void;
  clearFocusNode: () => void;
  setDisplayName: (displayName: string) => void;
  addPrivatePrompt: (text: string) => void;
  addSharedNote: (text: string) => void;
  addTranscriptChunk: (text: string) => Promise<boolean>;
  redirectAgent: (text: string) => void;
  updateMapNode: (nodeId: string, patch: { title?: string; summary?: string }) => Promise<boolean>;
}

export interface SignalRoomSnapshot {
  state: SignalRoomState;
  focusNodeId: string;
  focusedNode: SignalRoomState["mapNodes"][number];
  adapterStatus: SpacetimeAdapterStatus;
  actions: SignalRoomActions;
}

const STORAGE_KEY = "signal-room.web.local-state.v1";

function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneSeedRoomState(): SignalRoomState {
  return {
    ...seedRoomState,
    mapNodes: seedRoomState.mapNodes.map((node) => ({
      ...node,
      focus: { ...node.focus },
    })),
    mapEdges: seedRoomState.mapEdges.map((edge) => ({ ...edge })),
    presence: seedRoomState.presence.map((pin) => ({ ...pin })),
    roomEvents: seedRoomState.roomEvents.map((event) => ({ ...event })),
    queueItems: seedRoomState.queueItems.map((item) => ({
      ...item,
      metaChip: { ...item.metaChip },
      chips: item.chips.map((chip) => ({ ...chip })),
    })),
    transcript: seedRoomState.transcript.map((utterance) => ({
      ...utterance,
      chips: utterance.chips.map((chip) => ({ ...chip })),
    })),
    topicChunks: seedRoomState.topicChunks.map((chunk) => ({
      ...chunk,
      chip: { ...chunk.chip },
    })),
    agents: seedRoomState.agents.map((agent) => ({ ...agent })),
    personalCards: seedRoomState.personalCards.map((card) => ({
      ...card,
      chip: { ...card.chip },
    })),
    scratchpad: seedRoomState.scratchpad.map((entry) => ({ ...entry })),
    sharedNotes: seedRoomState.sharedNotes.map((note) => ({ ...note })),
    thread: {
      ...seedRoomState.thread,
      steps: seedRoomState.thread.steps.map((step) => ({ ...step })),
      findingBullets: [...seedRoomState.thread.findingBullets],
      humanEdits: [...seedRoomState.thread.humanEdits],
    },
  };
}

function readPersistedState(): Partial<PersistedRoomState> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedRoomState>) : {};
  } catch {
    return {};
  }
}

function createInitialState(): SignalRoomState {
  const persisted = readPersistedState();
  const roomCode = getRequestedRoomCode();
  const seed = cloneSeedRoomState();
  const displayName = persisted.displayName || seed.displayName;
  const blank = createBlankRoomState(roomCode, displayName);

  return {
    ...blank,
    scratchpad: persisted.scratchpad?.length ? persisted.scratchpad : blank.scratchpad,
    sharedNotes: persisted.sharedNotes || blank.sharedNotes,
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
        title: "Your private AI",
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

function mergeLiveState(seed: SignalRoomState, live: ReturnType<typeof useSpacetimeLiveBridge>): SignalRoomState {
  const hasLiveRoomData =
    live.status.mode === "spacetime" && live.status.isReady && live.status.roomId !== undefined;

  return {
    ...seed,
    roomCode: seed.roomCode,
    question: hasLiveRoomData ? displayRoomTitle(live.roomTitle, seed.roomCode) : seed.question,
    questionSubtitle: hasLiveRoomData
      ? `${seed.roomCode} · live SpacetimeDB room · watch it fill from conversation and agents`
      : seed.questionSubtitle,
    synthesisState: hasLiveRoomData ? "Live" : seed.synthesisState,
    defaultFocusNodeId: live.focusedNodeId ?? seed.defaultFocusNodeId,
    mapNodes: hasLiveRoomData ? live.mapNodes : seed.mapNodes,
    mapEdges: hasLiveRoomData ? live.mapEdges : seed.mapEdges,
    presence: hasLiveRoomData ? live.presence : seed.presence,
    roomEvents: hasLiveRoomData ? live.roomEvents : seed.roomEvents,
    queueItems: hasLiveRoomData ? live.queueItems : seed.queueItems,
    transcript: hasLiveRoomData ? live.transcript : seed.transcript,
    topicChunks: hasLiveRoomData ? live.topicChunks : seed.topicChunks,
    agents: hasLiveRoomData ? live.agents : seed.agents,
    sharedNotes: hasLiveRoomData ? live.sharedNotes : seed.sharedNotes,
  };
}

function displayRoomTitle(title: string | undefined, roomCode: string): string {
  const trimmed = title?.trim();
  if (!trimmed || /^Signal replay room\b/i.test(trimmed)) {
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
      sharedNotes: state.sharedNotes,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [state.displayName, state.scratchpad, state.sharedNotes]);

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
          console.warn("Unable to sync room focus", error);
        });
      }
    },
    [live, visibleState.mapNodes]
  );

  const clearFocusNode = useCallback(() => {
    setFocusNodeId("");
    void live.clearRoomFocus().catch((error: unknown) => {
      console.warn("Unable to clear room focus", error);
    });
  }, [live]);

  const setDisplayName = useCallback((displayName: string) => {
    const normalized = displayName.trim() || seedRoomState.displayName;
    setState((current) => ({ ...current, displayName: normalized }));
    void live.upsertParticipant(normalized, "online", focusNodeId).catch((error: unknown) => {
      console.warn("Unable to sync participant", error);
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
          title: "Private AI queued",
          body:
            "I will keep this private unless you add it to the shared room map or it crosses the interruption threshold.",
        },
        ...current.scratchpad,
      ],
    }));
  }, []);

  const addSharedNote = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body) return;

      const addLocalNote = () => {
        setState((current) => {
        const focused =
          visibleState.mapNodes.find((node) => node.id === focusNodeId) ??
          visibleState.mapNodes[0] ??
          current.mapNodes[0];
        const note: SharedNote = {
          id: createId("shared"),
          author: current.displayName,
          body,
          connected: focused.title,
        };

        return {
          ...current,
          sharedNotes: [note, ...current.sharedNotes],
          roomEvents: [
            {
              id: createId("event"),
              text: `${current.displayName} added a quiet note to ${focused.title}.`,
            },
            ...current.roomEvents,
          ],
        };
        });
      };

      void live
        .addSharedNote(body, focusNodeId, state.displayName)
        .then((synced) => {
          if (!synced) addLocalNote();
        })
        .catch((error: unknown) => {
          console.warn("Unable to sync shared note", error);
          addLocalNote();
        });
    },
    [focusNodeId, live, state.displayName]
  );

  const addTranscriptChunk = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body) return false;

      const addLocalTranscript = () => {
        setState((current) => ({
          ...current,
          transcript: [
            {
              id: createId("transcript"),
              speaker: "Room conversation",
              timestamp: "live",
              text: body,
              chips: [
                { label: "manual", tone: "blue" },
                { label: "map input", tone: "green" },
              ],
            },
            ...current.transcript,
          ],
          topicChunks: [
            {
              id: createId("topic"),
              window: "Live chunk",
              chip: { label: "Room conversation", tone: "blue" },
              summary: body,
            },
            ...current.topicChunks,
          ],
        }));
      };

      try {
        const synced = await live.addTranscriptChunk(body);
        if (!synced) addLocalTranscript();
        return synced;
      } catch (error: unknown) {
        console.warn("Unable to sync transcript chunk", error);
        addLocalTranscript();
        return false;
      }
    },
    [live]
  );

  const redirectAgent = useCallback((text: string) => {
    const body = text.trim();
    if (!body) return;

    void live.createAgentTask(body, focusNodeId).catch((error: unknown) => {
      console.warn("Unable to sync agent redirect", error);
    });

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
      thread: {
        ...current.thread,
        nextUpdate: "Agent is checking production-volume evidence and the old CPI sensitivity note.",
      },
    }));
  }, [focusNodeId, live]);

  const updateMapNode = useCallback(
    async (nodeId: string, patch: { title?: string; summary?: string }) => {
      const title = patch.title?.trim();
      const summary = patch.summary?.trim();
      if (!title && !summary) return false;

      const applyLocalPatch = () => {
        setState((current) => ({
          ...current,
          mapNodes: current.mapNodes.map((node) => {
            if (node.id !== nodeId) return node;
            const nextTitle = title || node.title;
            const nextSummary = summary || node.summary;
            return {
              ...node,
              title: nextTitle,
              summary: nextSummary,
              focus: {
                ...node.focus,
                title: nextTitle,
                text: nextSummary,
              },
            };
          }),
        }));
      };

      try {
        const synced = await live.updateMapNode(nodeId, { title, summary });
        if (!synced) applyLocalPatch();
        return synced;
      } catch (error: unknown) {
        console.warn("Unable to update map node", error);
        applyLocalPatch();
        return false;
      }
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
    }),
    [
      addPrivatePrompt,
      addSharedNote,
      addTranscriptChunk,
      clearFocusNode,
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
