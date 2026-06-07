import { schema, SenderError, table, t } from 'spacetimedb/server';

const room = table(
  { name: 'room', public: true },
  {
    roomId: t.u64().primaryKey().autoInc(),
    code: t.string().unique(),
    title: t.string(),
    description: t.string(),
    createdBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const participant = table(
  {
    name: 'participant',
    public: true,
    indexes: [
      {
        accessor: 'by_room_identity',
        algorithm: 'btree',
        columns: ['roomId', 'identity'] as const,
      },
    ] as const,
  },
  {
    participantId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    identity: t.identity().index('btree'),
    displayName: t.string(),
    role: t.string(),
    status: t.string(),
    cursorNodeId: t.option(t.u64()),
    joinedAt: t.timestamp(),
    lastSeenAt: t.timestamp(),
  }
);

const mapNode = table(
  { name: 'map_node', public: true },
  {
    nodeId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    title: t.string(),
    summary: t.string(),
    nodeType: t.string(),
    source: t.string(),
    urgency: t.string(),
    sourceRefId: t.option(t.u64()),
    x: t.f64(),
    y: t.f64(),
    createdBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const mapEdge = table(
  {
    name: 'map_edge',
    public: true,
    indexes: [
      {
        accessor: 'by_room_nodes',
        algorithm: 'btree',
        columns: ['roomId', 'fromNodeId', 'toNodeId'] as const,
      },
    ] as const,
  },
  {
    edgeId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    fromNodeId: t.u64().index('btree'),
    toNodeId: t.u64().index('btree'),
    label: t.string(),
    edgeType: t.string(),
    strength: t.f32(),
    createdBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
  }
);

const transcriptChunk = table(
  { name: 'transcript_chunk', public: true },
  {
    chunkId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    source: t.string(),
    text: t.string(),
    startMs: t.u64(),
    endMs: t.u64(),
    sourceParticipantId: t.option(t.u64()),
    createdBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
  }
);

const sharedNote = table(
  { name: 'shared_note', public: true },
  {
    noteId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    nodeId: t.option(t.u64()),
    body: t.string(),
    sourceDisplayName: t.string(),
    createdBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
  }
);

const questionCandidate = table(
  { name: 'question_candidate', public: true },
  {
    questionId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    nodeId: t.option(t.u64()),
    question: t.string(),
    source: t.string(),
    urgency: t.string(),
    status: t.string(),
    createdBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
    expiresAt: t.option(t.timestamp()),
  }
);

const agentTask = table(
  { name: 'agent_task', public: true },
  {
    taskId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    nodeId: t.option(t.u64()),
    taskType: t.string(),
    instructions: t.string(),
    status: t.string(),
    priority: t.u32(),
    resultSummary: t.string(),
    createdBy: t.identity().index('btree'),
    claimedBy: t.option(t.identity()),
    createdAt: t.timestamp(),
    claimedAt: t.option(t.timestamp()),
    completedAt: t.option(t.timestamp()),
    updatedAt: t.timestamp(),
  }
);

const agentOutput = table(
  { name: 'agent_output', public: true },
  {
    outputId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    taskId: t.option(t.u64()),
    nodeId: t.option(t.u64()),
    outputType: t.string(),
    summary: t.string(),
    details: t.string(),
    linksJson: t.string(),
    urgency: t.string(),
    suggestedNodeTitle: t.string(),
    suggestedNodeSummary: t.string(),
    createdBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
  }
);

const finding = table(
  { name: 'finding', public: true },
  {
    findingId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    nodeId: t.option(t.u64()),
    outputId: t.option(t.u64()),
    title: t.string(),
    summary: t.string(),
    linksJson: t.string(),
    urgency: t.string(),
    status: t.string(),
    createdBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const roomFocus = table(
  { name: 'room_focus', public: true },
  {
    roomId: t.u64().primaryKey(),
    nodeId: t.option(t.u64()),
    label: t.string(),
    setBy: t.identity().index('btree'),
    updatedAt: t.timestamp(),
  }
);

const roomEvent = table(
  { name: 'room_event', public: true, event: true },
  {
    eventId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    eventType: t.string(),
    message: t.string(),
    nodeId: t.option(t.u64()),
    taskId: t.option(t.u64()),
    actor: t.identity().index('btree'),
    createdAt: t.timestamp(),
  }
);

const cursor = table(
  {
    name: 'cursor',
    public: true,
    indexes: [
      {
        accessor: 'by_room_identity',
        algorithm: 'btree',
        columns: ['roomId', 'identity'] as const,
      },
    ] as const,
  },
  {
    cursorId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    identity: t.identity(),
    displayName: t.string(),
    x: t.f64(),
    y: t.f64(),
    updatedAt: t.timestamp(),
  }
);

const agentWorker = table(
  {
    name: 'agent_worker',
    public: true,
    indexes: [
      {
        accessor: 'by_room_name',
        algorithm: 'btree',
        columns: ['roomId', 'name'] as const,
      },
    ] as const,
  },
  {
    workerId: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    name: t.string(),
    persona: t.string(),
    status: t.string(),
    detail: t.string(),
    currentTaskId: t.option(t.u64()),
    currentNodeId: t.option(t.u64()),
    completedCount: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const nodeAgent = table(
  {
    name: 'node_agent',
    public: true,
  },
  {
    nodeId: t.u64().primaryKey(),
    roomId: t.u64().index('btree'),
    agentKind: t.string(),
    agentState: t.string(),
    insight: t.string(),
    linksJson: t.string(),
    confidence: t.string(),
    updatedAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  room,
  participant,
  mapNode,
  mapEdge,
  transcriptChunk,
  sharedNote,
  questionCandidate,
  agentTask,
  agentOutput,
  finding,
  roomFocus,
  roomEvent,
  cursor,
  agentWorker,
  nodeAgent,
});

export default spacetimedb;

const ROOM_MIC_STARTING_STATUS = 'mic_starting';
const ROOM_MIC_LIVE_STATUS = 'mic_live';
const ROOM_MIC_TTL_MICROS = 30_000_000n;

function cleanText(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function timestampMicros(value: any): bigint {
  if (typeof value?.microsSinceUnixEpoch === 'bigint') {
    return value.microsSinceUnixEpoch;
  }
  if (typeof value?.__timestamp_micros_since_unix_epoch__ === 'bigint') {
    return value.__timestamp_micros_since_unix_epoch__;
  }
  return 0n;
}

function isRoomMicStatus(status: string): boolean {
  return status === ROOM_MIC_STARTING_STATUS || status === ROOM_MIC_LIVE_STATUS;
}

function cleanRoomMicStatus(status: string): string {
  return status === ROOM_MIC_LIVE_STATUS ? ROOM_MIC_LIVE_STATUS : ROOM_MIC_STARTING_STATUS;
}

function shortTitle(value: string, fallback: string): string {
  const trimmed = cleanText(value, fallback);
  return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
}

function first(values: Iterable<any>): any | undefined {
  for (const value of values) {
    return value;
  }
  return undefined;
}

function requireRoom(ctx: any, roomId: bigint) {
  const existing = ctx.db.room.roomId.find(roomId);
  if (existing === null) {
    throw new SenderError('room not found');
  }
  return existing;
}

function touchRoom(ctx: any, roomId: bigint): void {
  const existing = requireRoom(ctx, roomId);
  ctx.db.room.roomId.update({ ...existing, updatedAt: ctx.timestamp });
}

function emitRoomEvent(
  ctx: any,
  roomId: bigint,
  eventType: string,
  message: string,
  nodeId: bigint | undefined = undefined,
  taskId: bigint | undefined = undefined
): void {
  ctx.db.roomEvent.insert({
    eventId: 0n,
    roomId,
    eventType,
    message,
    nodeId,
    taskId,
    actor: ctx.sender,
    createdAt: ctx.timestamp,
  });
}

function upsertParticipantForSender(
  ctx: any,
  roomId: bigint,
  displayName: string,
  role: string,
  status: string,
  cursorNodeId: bigint | undefined
): void {
  const existing = first(
    ctx.db.participant.by_room_identity.filter([roomId, ctx.sender])
  );
  const cleanDisplayName = cleanText(displayName, 'Participant');

  if (existing !== undefined) {
    ctx.db.participant.participantId.update({
      ...existing,
      displayName: cleanDisplayName,
      role: cleanText(role, existing.role),
      status: cleanText(status, existing.status),
      cursorNodeId,
      lastSeenAt: ctx.timestamp,
    });
    return;
  }

  ctx.db.participant.insert({
    participantId: 0n,
    roomId,
    identity: ctx.sender,
    displayName: cleanDisplayName,
    role: cleanText(role, 'participant'),
    status: cleanText(status, 'online'),
    cursorNodeId,
    joinedAt: ctx.timestamp,
    lastSeenAt: ctx.timestamp,
  });
}

function updateParticipantStatusForSender(
  ctx: any,
  roomId: bigint,
  displayName: string,
  status: string,
  cursorNodeId: bigint | undefined
): void {
  const existing = first(
    ctx.db.participant.by_room_identity.filter([roomId, ctx.sender])
  );
  const cleanDisplayName = cleanText(displayName, 'Participant');

  if (existing !== undefined) {
    ctx.db.participant.participantId.update({
      ...existing,
      displayName: cleanDisplayName,
      status: cleanText(status, existing.status),
      cursorNodeId,
      lastSeenAt: ctx.timestamp,
    });
    return;
  }

  ctx.db.participant.insert({
    participantId: 0n,
    roomId,
    identity: ctx.sender,
    displayName: cleanDisplayName,
    role: 'participant',
    status: cleanText(status, 'online'),
    cursorNodeId,
    joinedAt: ctx.timestamp,
    lastSeenAt: ctx.timestamp,
  });
}

function activeRoomMicHolder(ctx: any, roomId: bigint): any | undefined {
  const nowMicros = timestampMicros(ctx.timestamp);
  for (const row of ctx.db.participant.roomId.filter(roomId)) {
    if (!isRoomMicStatus(row.status)) continue;
    if (row.identity.equals(ctx.sender)) continue;

    const lastSeenMicros = timestampMicros(row.lastSeenAt);
    if (lastSeenMicros === 0n || nowMicros - lastSeenMicros <= ROOM_MIC_TTL_MICROS) {
      return row;
    }
  }
  return undefined;
}

function participantDisplayName(ctx: any, roomId: bigint, fallback: string): string {
  const existing = first(
    ctx.db.participant.by_room_identity.filter([roomId, ctx.sender])
  );
  return existing === undefined
    ? cleanText(fallback, 'Participant')
    : cleanText(existing.displayName, fallback);
}

function assertNodeInRoom(ctx: any, roomId: bigint, nodeId: bigint): void {
  const existing = ctx.db.mapNode.nodeId.find(nodeId);
  if (existing === null || existing.roomId !== roomId) {
    throw new SenderError('map node not found in room');
  }
}

export const init = spacetimedb.init(_ctx => {
  // Rooms are created live through createRoom; there is no seeded state.
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  console.info(`Signal Room client connected: ${ctx.sender}`);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  console.info(`Signal Room client disconnected: ${ctx.sender}`);
});

export const createRoom = spacetimedb.reducer(
  {
    code: t.string(),
    title: t.string(),
    displayName: t.string(),
  },
  (ctx, { code, title, displayName }) => {
    const roomCode = cleanText(code, 'DEMO').toUpperCase();
    const roomTitle = cleanText(title, `${roomCode} room`);
    let existing = ctx.db.room.code.find(roomCode);

    if (existing === null) {
      existing = ctx.db.room.insert({
        roomId: 0n,
        code: roomCode,
        title: roomTitle,
        description: '',
        createdBy: ctx.sender,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
      });
    } else {
      ctx.db.room.roomId.update({
        ...existing,
        title: roomTitle,
        updatedAt: ctx.timestamp,
      });
    }

    upsertParticipantForSender(
      ctx,
      existing.roomId,
      displayName,
      'host',
      'online',
      undefined
    );
    emitRoomEvent(ctx, existing.roomId, 'room_created', `Room ${roomCode} ready`);
  }
);

export const joinRoom = spacetimedb.reducer(
  {
    code: t.string(),
    displayName: t.string(),
  },
  (ctx, { code, displayName }) => {
    const roomCode = cleanText(code, 'DEMO').toUpperCase();
    const existing = ctx.db.room.code.find(roomCode);
    if (existing === null) {
      throw new SenderError(`room ${roomCode} not found`);
    }

    upsertParticipantForSender(
      ctx,
      existing.roomId,
      displayName,
      'participant',
      'online',
      undefined
    );
    touchRoom(ctx, existing.roomId);
    emitRoomEvent(ctx, existing.roomId, 'participant_joined', `${displayName} joined`);
  }
);

export const renameRoom = spacetimedb.reducer(
  {
    roomId: t.u64(),
    title: t.string(),
  },
  (ctx, { roomId, title }) => {
    const existing = requireRoom(ctx, roomId);
    const roomTitle = cleanText(title, existing.title).slice(0, 96);
    ctx.db.room.roomId.update({
      ...existing,
      title: roomTitle,
      updatedAt: ctx.timestamp,
    });
    emitRoomEvent(ctx, roomId, 'room_renamed', `Room renamed to ${roomTitle}`);
  }
);

export const upsertParticipant = spacetimedb.reducer(
  {
    roomId: t.u64(),
    displayName: t.string(),
    role: t.string(),
    status: t.string(),
    cursorNodeId: t.option(t.u64()),
  },
  (ctx, { roomId, displayName, role, status, cursorNodeId }) => {
    requireRoom(ctx, roomId);
    upsertParticipantForSender(ctx, roomId, displayName, role, status, cursorNodeId);
    touchRoom(ctx, roomId);
    emitRoomEvent(ctx, roomId, 'participant_updated', `${displayName} updated`);
  }
);

export const claimRoomMic = spacetimedb.reducer(
  {
    roomId: t.u64(),
    displayName: t.string(),
    status: t.string(),
    cursorNodeId: t.option(t.u64()),
  },
  (ctx, { roomId, displayName, status, cursorNodeId }) => {
    requireRoom(ctx, roomId);
    const holder = activeRoomMicHolder(ctx, roomId);
    if (holder !== undefined) {
      throw new SenderError(`${cleanText(holder.displayName, 'Someone')} is already using the room mic`);
    }

    updateParticipantStatusForSender(
      ctx,
      roomId,
      displayName,
      cleanRoomMicStatus(status),
      cursorNodeId
    );
    touchRoom(ctx, roomId);
  }
);

export const releaseRoomMic = spacetimedb.reducer(
  {
    roomId: t.u64(),
    displayName: t.string(),
    cursorNodeId: t.option(t.u64()),
  },
  (ctx, { roomId, displayName, cursorNodeId }) => {
    requireRoom(ctx, roomId);
    updateParticipantStatusForSender(ctx, roomId, displayName, 'online', cursorNodeId);
    touchRoom(ctx, roomId);
  }
);

export const createMapNode = spacetimedb.reducer(
  {
    roomId: t.u64(),
    title: t.string(),
    summary: t.string(),
    nodeType: t.string(),
    source: t.string(),
    urgency: t.string(),
    sourceRefId: t.option(t.u64()),
    x: t.f64(),
    y: t.f64(),
  },
  (ctx, { roomId, title, summary, nodeType, source, urgency, sourceRefId, x, y }) => {
    requireRoom(ctx, roomId);
    const inserted = ctx.db.mapNode.insert({
      nodeId: 0n,
      roomId,
      title: cleanText(title, 'Untitled node'),
      summary: cleanText(summary, ''),
      nodeType: cleanText(nodeType, 'topic'),
      source: cleanText(source, 'human'),
      urgency: cleanText(urgency, 'normal'),
      sourceRefId,
      x,
      y,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    touchRoom(ctx, roomId);
    emitRoomEvent(ctx, roomId, 'map_node_created', inserted.title, inserted.nodeId);
  }
);

export const updateMapNode = spacetimedb.reducer(
  {
    nodeId: t.u64(),
    title: t.option(t.string()),
    summary: t.option(t.string()),
    nodeType: t.option(t.string()),
    source: t.option(t.string()),
    urgency: t.option(t.string()),
    x: t.option(t.f64()),
    y: t.option(t.f64()),
  },
  (ctx, { nodeId, title, summary, nodeType, source, urgency, x, y }) => {
    const existing = ctx.db.mapNode.nodeId.find(nodeId);
    if (existing === null) {
      throw new SenderError('map node not found');
    }

    const updated = {
      ...existing,
      title: title === undefined ? existing.title : cleanText(title, existing.title),
      summary:
        summary === undefined ? existing.summary : cleanText(summary, existing.summary),
      nodeType:
        nodeType === undefined ? existing.nodeType : cleanText(nodeType, existing.nodeType),
      source: source === undefined ? existing.source : cleanText(source, existing.source),
      urgency:
        urgency === undefined ? existing.urgency : cleanText(urgency, existing.urgency),
      x: x === undefined ? existing.x : x,
      y: y === undefined ? existing.y : y,
      updatedAt: ctx.timestamp,
    };

    ctx.db.mapNode.nodeId.update(updated);
    touchRoom(ctx, existing.roomId);
    emitRoomEvent(ctx, existing.roomId, 'map_node_updated', updated.title, nodeId);
  }
);

export const addMapEdge = spacetimedb.reducer(
  {
    roomId: t.u64(),
    fromNodeId: t.u64(),
    toNodeId: t.u64(),
    label: t.string(),
    edgeType: t.string(),
    strength: t.f32(),
  },
  (ctx, { roomId, fromNodeId, toNodeId, label, edgeType, strength }) => {
    requireRoom(ctx, roomId);
    assertNodeInRoom(ctx, roomId, fromNodeId);
    assertNodeInRoom(ctx, roomId, toNodeId);

    const existing = first(
      ctx.db.mapEdge.by_room_nodes.filter([roomId, fromNodeId, toNodeId])
    );
    if (existing !== undefined) {
      return;
    }

    ctx.db.mapEdge.insert({
      edgeId: 0n,
      roomId,
      fromNodeId,
      toNodeId,
      label: cleanText(label, ''),
      edgeType: cleanText(edgeType, 'related'),
      strength,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    touchRoom(ctx, roomId);
    emitRoomEvent(ctx, roomId, 'map_edge_created', cleanText(label, 'Map edge'));
  }
);

export const addTranscriptChunk = spacetimedb.reducer(
  {
    roomId: t.u64(),
    source: t.string(),
    text: t.string(),
    startMs: t.u64(),
    endMs: t.u64(),
    sourceParticipantId: t.option(t.u64()),
  },
  (ctx, { roomId, source, text, startMs, endMs, sourceParticipantId }) => {
    requireRoom(ctx, roomId);
    const inserted = ctx.db.transcriptChunk.insert({
      chunkId: 0n,
      roomId,
      source: cleanText(source, 'Room conversation'),
      text: cleanText(text, ''),
      startMs,
      endMs,
      sourceParticipantId,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });

    touchRoom(ctx, roomId);
    emitRoomEvent(
      ctx,
      roomId,
      'transcript_chunk_added',
      shortTitle(inserted.text, 'Transcript chunk')
    );
  }
);

export const addSharedNote = spacetimedb.reducer(
  {
    roomId: t.u64(),
    nodeId: t.option(t.u64()),
    body: t.string(),
    sourceDisplayName: t.string(),
  },
  (ctx, { roomId, nodeId, body, sourceDisplayName }) => {
    requireRoom(ctx, roomId);
    let attachedNodeId = nodeId;
    if (attachedNodeId !== undefined) {
      assertNodeInRoom(ctx, roomId, attachedNodeId);
    } else {
      const noteNode = ctx.db.mapNode.insert({
        nodeId: 0n,
        roomId,
        title: shortTitle(body, 'Shared note'),
        summary: cleanText(body, ''),
        nodeType: 'note',
        source: 'shared_note',
        urgency: 'normal',
        sourceRefId: undefined,
        x: 0,
        y: 0,
        createdBy: ctx.sender,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
      });
      attachedNodeId = noteNode.nodeId;
    }

    const actorName = participantDisplayName(ctx, roomId, sourceDisplayName);
    const inserted = ctx.db.sharedNote.insert({
      noteId: 0n,
      roomId,
      nodeId: attachedNodeId,
      body: cleanText(body, ''),
      sourceDisplayName: actorName,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });

    touchRoom(ctx, roomId);
    emitRoomEvent(ctx, roomId, 'shared_note_added', actorName, inserted.nodeId);
  }
);

export const createQuestionCandidate = spacetimedb.reducer(
  {
    roomId: t.u64(),
    nodeId: t.option(t.u64()),
    question: t.string(),
    source: t.string(),
    urgency: t.string(),
    expiresAt: t.option(t.timestamp()),
  },
  (ctx, { roomId, nodeId, question, source, urgency, expiresAt }) => {
    requireRoom(ctx, roomId);
    if (nodeId !== undefined) {
      assertNodeInRoom(ctx, roomId, nodeId);
    }

    ctx.db.questionCandidate.insert({
      questionId: 0n,
      roomId,
      nodeId,
      question: cleanText(question, 'Open question'),
      source: cleanText(source, 'router'),
      urgency: cleanText(urgency, 'normal'),
      status: 'open',
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      expiresAt,
    });

    touchRoom(ctx, roomId);
    emitRoomEvent(ctx, roomId, 'question_candidate_created', shortTitle(question, 'Question'));
  }
);

export const createAgentTask = spacetimedb.reducer(
  {
    roomId: t.u64(),
    nodeId: t.option(t.u64()),
    taskType: t.string(),
    instructions: t.string(),
    priority: t.u32(),
  },
  (ctx, { roomId, nodeId, taskType, instructions, priority }) => {
    requireRoom(ctx, roomId);
    if (nodeId !== undefined) {
      assertNodeInRoom(ctx, roomId, nodeId);
    }

    const inserted = ctx.db.agentTask.insert({
      taskId: 0n,
      roomId,
      nodeId,
      taskType: cleanText(taskType, 'research'),
      instructions: cleanText(instructions, ''),
      status: 'queued',
      priority,
      resultSummary: '',
      createdBy: ctx.sender,
      claimedBy: undefined,
      createdAt: ctx.timestamp,
      claimedAt: undefined,
      completedAt: undefined,
      updatedAt: ctx.timestamp,
    });

    touchRoom(ctx, roomId);
    emitRoomEvent(
      ctx,
      roomId,
      'agent_task_created',
      shortTitle(inserted.instructions, 'Agent task'),
      nodeId,
      inserted.taskId
    );
  }
);

export const claimAgentTask = spacetimedb.reducer(
  {
    taskId: t.u64(),
  },
  (ctx, { taskId }) => {
    const existing = ctx.db.agentTask.taskId.find(taskId);
    if (existing === null) {
      throw new SenderError('agent task not found');
    }
    if (existing.status === 'completed' || existing.status === 'failed') {
      throw new SenderError('agent task is already finished');
    }
    if (
      existing.claimedBy !== undefined &&
      !existing.claimedBy.equals(ctx.sender)
    ) {
      throw new SenderError('agent task already claimed');
    }

    ctx.db.agentTask.taskId.update({
      ...existing,
      status: 'claimed',
      claimedBy: ctx.sender,
      claimedAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    touchRoom(ctx, existing.roomId);
    emitRoomEvent(
      ctx,
      existing.roomId,
      'agent_task_claimed',
      existing.taskType,
      existing.nodeId,
      taskId
    );
  }
);

export const completeAgentTask = spacetimedb.reducer(
  {
    taskId: t.u64(),
    status: t.string(),
    resultSummary: t.string(),
  },
  (ctx, { taskId, status, resultSummary }) => {
    const existing = ctx.db.agentTask.taskId.find(taskId);
    if (existing === null) {
      throw new SenderError('agent task not found');
    }
    if (
      existing.claimedBy !== undefined &&
      !existing.claimedBy.equals(ctx.sender)
    ) {
      throw new SenderError('only the claiming actor can complete this task');
    }

    const finalStatus = cleanText(status, 'completed');
    ctx.db.agentTask.taskId.update({
      ...existing,
      status: finalStatus,
      claimedBy: existing.claimedBy ?? ctx.sender,
      claimedAt: existing.claimedAt ?? ctx.timestamp,
      completedAt: ctx.timestamp,
      resultSummary: cleanText(resultSummary, ''),
      updatedAt: ctx.timestamp,
    });
    touchRoom(ctx, existing.roomId);
    emitRoomEvent(
      ctx,
      existing.roomId,
      'agent_task_completed',
      cleanText(resultSummary, finalStatus),
      existing.nodeId,
      taskId
    );
  }
);

export const addAgentOutput = spacetimedb.reducer(
  {
    roomId: t.u64(),
    taskId: t.option(t.u64()),
    nodeId: t.option(t.u64()),
    outputType: t.string(),
    summary: t.string(),
    details: t.string(),
    linksJson: t.string(),
    urgency: t.string(),
    suggestedNodeTitle: t.string(),
    suggestedNodeSummary: t.string(),
  },
  (
    ctx,
    {
      roomId,
      taskId,
      nodeId,
      outputType,
      summary,
      details,
      linksJson,
      urgency,
      suggestedNodeTitle,
      suggestedNodeSummary,
    }
  ) => {
    requireRoom(ctx, roomId);
    if (nodeId !== undefined) {
      assertNodeInRoom(ctx, roomId, nodeId);
    }
    if (taskId !== undefined) {
      const task = ctx.db.agentTask.taskId.find(taskId);
      if (task === null || task.roomId !== roomId) {
        throw new SenderError('agent task not found in room');
      }
    }

    const inserted = ctx.db.agentOutput.insert({
      outputId: 0n,
      roomId,
      taskId,
      nodeId,
      outputType: cleanText(outputType, 'research'),
      summary: cleanText(summary, ''),
      details: cleanText(details, ''),
      linksJson: cleanText(linksJson, '[]'),
      urgency: cleanText(urgency, 'normal'),
      suggestedNodeTitle: cleanText(suggestedNodeTitle, ''),
      suggestedNodeSummary: cleanText(suggestedNodeSummary, ''),
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });

    touchRoom(ctx, roomId);
    emitRoomEvent(
      ctx,
      roomId,
      'agent_output_added',
      shortTitle(inserted.summary, 'Agent output'),
      nodeId,
      taskId
    );
  }
);

export const addFinding = spacetimedb.reducer(
  {
    roomId: t.u64(),
    nodeId: t.option(t.u64()),
    outputId: t.option(t.u64()),
    title: t.string(),
    summary: t.string(),
    linksJson: t.string(),
    urgency: t.string(),
  },
  (ctx, { roomId, nodeId, outputId, title, summary, linksJson, urgency }) => {
    requireRoom(ctx, roomId);
    if (nodeId !== undefined) {
      assertNodeInRoom(ctx, roomId, nodeId);
    }
    if (outputId !== undefined) {
      const output = ctx.db.agentOutput.outputId.find(outputId);
      if (output === null || output.roomId !== roomId) {
        throw new SenderError('agent output not found in room');
      }
    }

    const inserted = ctx.db.finding.insert({
      findingId: 0n,
      roomId,
      nodeId,
      outputId,
      title: cleanText(title, 'Finding'),
      summary: cleanText(summary, ''),
      linksJson: cleanText(linksJson, '[]'),
      urgency: cleanText(urgency, 'normal'),
      status: 'new',
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });

    touchRoom(ctx, roomId);
    emitRoomEvent(
      ctx,
      roomId,
      'finding_added',
      inserted.title,
      nodeId,
      undefined
    );
  }
);

export const setRoomFocus = spacetimedb.reducer(
  {
    roomId: t.u64(),
    nodeId: t.option(t.u64()),
    label: t.string(),
  },
  (ctx, { roomId, nodeId, label }) => {
    requireRoom(ctx, roomId);
    if (nodeId !== undefined) {
      assertNodeInRoom(ctx, roomId, nodeId);
    }

    const existing = ctx.db.roomFocus.roomId.find(roomId);
    const focus = {
      roomId,
      nodeId,
      label: cleanText(label, ''),
      setBy: ctx.sender,
      updatedAt: ctx.timestamp,
    };

    if (existing === null) {
      ctx.db.roomFocus.insert(focus);
    } else {
      ctx.db.roomFocus.roomId.update(focus);
    }

    touchRoom(ctx, roomId);
    emitRoomEvent(ctx, roomId, 'room_focus_set', cleanText(label, 'Room focus'), nodeId);
  }
);

export const updateCursor = spacetimedb.reducer(
  {
    roomId: t.u64(),
    x: t.f64(),
    y: t.f64(),
    displayName: t.string(),
  },
  (ctx, { roomId, x, y, displayName }) => {
    requireRoom(ctx, roomId);
    const name = cleanText(displayName, 'Participant');
    const existing = first(ctx.db.cursor.by_room_identity.filter([roomId, ctx.sender]));

    if (existing === undefined) {
      ctx.db.cursor.insert({
        cursorId: 0n,
        roomId,
        identity: ctx.sender,
        displayName: name,
        x,
        y,
        updatedAt: ctx.timestamp,
      });
      return;
    }

    ctx.db.cursor.cursorId.update({
      ...existing,
      displayName: name,
      x,
      y,
      updatedAt: ctx.timestamp,
    });
  }
);

export const upsertAgentWorker = spacetimedb.reducer(
  {
    roomId: t.u64(),
    name: t.string(),
    persona: t.string(),
    status: t.string(),
    detail: t.string(),
    currentTaskId: t.option(t.u64()),
    currentNodeId: t.option(t.u64()),
    completedCount: t.u32(),
  },
  (ctx, { roomId, name, persona, status, detail, currentTaskId, currentNodeId, completedCount }) => {
    requireRoom(ctx, roomId);
    const workerName = cleanText(name, 'Agent');
    const existing = first(ctx.db.agentWorker.by_room_name.filter([roomId, workerName]));

    if (existing === undefined) {
      ctx.db.agentWorker.insert({
        workerId: 0n,
        roomId,
        name: workerName,
        persona: cleanText(persona, 'research'),
        status: cleanText(status, 'idle'),
        detail: cleanText(detail, ''),
        currentTaskId,
        currentNodeId,
        completedCount,
        updatedAt: ctx.timestamp,
      });
      return;
    }

    ctx.db.agentWorker.workerId.update({
      ...existing,
      persona: cleanText(persona, existing.persona),
      status: cleanText(status, existing.status),
      detail: cleanText(detail, existing.detail),
      currentTaskId,
      currentNodeId,
      completedCount,
      updatedAt: ctx.timestamp,
    });
  }
);

export const setNodeAgent = spacetimedb.reducer(
  {
    nodeId: t.u64(),
    roomId: t.u64(),
    agentKind: t.string(),
    agentState: t.string(),
    insight: t.string(),
    linksJson: t.string(),
    confidence: t.string(),
  },
  (ctx, { nodeId, roomId, agentKind, agentState, insight, linksJson, confidence }) => {
    requireRoom(ctx, roomId);
    assertNodeInRoom(ctx, roomId, nodeId);

    const row = {
      nodeId,
      roomId,
      agentKind: cleanText(agentKind, 'leaf'),
      agentState: cleanText(agentState, 'idle'),
      insight: cleanText(insight, ''),
      linksJson: cleanText(linksJson, '[]'),
      confidence: cleanText(confidence, 'medium'),
      updatedAt: ctx.timestamp,
    };

    const existing = ctx.db.nodeAgent.nodeId.find(nodeId);
    if (existing === null) {
      ctx.db.nodeAgent.insert(row);
    } else {
      ctx.db.nodeAgent.nodeId.update(row);
    }
  }
);

// ---------------------------------------------------------------------------
// Realtime operator reducers
//
// Browser-executed realtime operator tools write through these reducers directly
// instead of shelling out through the gateway's `spacetime` CLI. All helpers below
// are deterministic, dedup is done via in-module table reads, and inserts return
// the row carrying the autoInc id used to chain edges.
// ---------------------------------------------------------------------------

interface RealtimeNodeRef {
  id: bigint;
  title: string;
  summary: string;
  nodeType: string;
  urgency: string;
}

function rtCleanString(value: string | undefined, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const clean = value
    .trim()
    .normalize('NFKC')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
  return clean ? clean.slice(0, maxLength) : fallback;
}

function rtCleanOptionalString(value: string | undefined, maxLength: number): string | undefined {
  const clean = rtCleanString(value, '', maxLength);
  return clean || undefined;
}

function rtCleanEnum<T extends string>(value: string | undefined, allowed: T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function rtNormalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(?:the|and|or|on|of|to|for|a|an|public|current|overall)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rtTextSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function rtFindSimilarNode(nodes: RealtimeNodeRef[], title: string): RealtimeNodeRef | undefined {
  if (!title) return undefined;
  const normalizedTitle = rtNormalizeComparableText(title);
  return nodes.find((node) => {
    const normalizedNodeTitle = rtNormalizeComparableText(node.title);
    if (normalizedNodeTitle === normalizedTitle) return true;
    return rtTextSimilarity(normalizedNodeTitle, normalizedTitle) >= 0.86;
  });
}

function rtFindRootNode(nodes: RealtimeNodeRef[]): RealtimeNodeRef | undefined {
  return nodes.find((node) => node.nodeType === 'root') ?? nodes[0];
}

function rtIsGenericRoot(node: RealtimeNodeRef): boolean {
  const normalizedTitle = rtNormalizeComparableText(node.title);
  const normalizedSummary = rtNormalizeComparableText(node.summary);
  if (/\b(?:current discussion|working question|room discussion|general discussion)\b/.test(normalizedTitle)) {
    return true;
  }
  if (/\blive topic detected by realtime room operator\b/.test(normalizedSummary)) {
    return true;
  }
  return false;
}

function rtIsWeakMapSignal(
  title: string,
  summary: string,
  confidence: number | undefined,
  options: { allowLowConfidence?: boolean } = {}
): boolean {
  const normalizedTitle = rtNormalizeComparableText(title);
  const normalizedSummary = rtNormalizeComparableText(summary);
  const numericConfidence =
    typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : undefined;

  if (!options.allowLowConfidence && numericConfidence !== undefined && numericConfidence < 0.58) return true;
  if (/\b(?:brief utterance|tiny utterance|short utterance|filler|acknowledgement|acknowledgment)\b/.test(normalizedTitle)) {
    return true;
  }
  if (/\b(?:conversation summary|current discussion|general discussion|room discussion)\b/.test(normalizedTitle)) {
    return true;
  }
  if (rtIsGenericClarificationSignal(title, summary)) return true;
  if (/^(?:um|uh|oh|yeah|ok|okay|right|that|sure|mm|hmm)\b/.test(normalizedTitle)) return true;
  if (normalizedSummary.length < 28) return true;
  if (/\b(?:only|just)\b.*\b(?:spoken|said|mentioned)\b/.test(normalizedSummary)) return true;
  if (/\b(?:no further discussion|brief conversation|nothing substantive)\b/.test(normalizedSummary)) return true;

  return false;
}

function rtIsGenericClarificationSignal(title: string, summary: string): boolean {
  const text = rtNormalizeComparableText(`${title} ${summary}`);
  if (/\b(?:clarify|clarifying|refine|restate|define)\b.*\b(?:main question|room question|central question|current question|topic)\b/.test(text)) {
    return true;
  }
  if (/\b(?:main question|room question|central question|current question)\b/.test(text) && /\b(?:generic|unclear|unknown|not specified|needs clarification)\b/.test(text)) {
    return true;
  }
  return false;
}

function rtCanReplaceGenericRoot(nodes: RealtimeNodeRef[], seed: { title: string; summary: string }): boolean {
  if (nodes.length > 1) return false;
  return !rtIsGenericClarificationSignal(seed.title, seed.summary);
}

function rtSemanticGroupForSignal(
  title: string,
  summary: string
): { title: string; summary: string; label: string } | undefined {
  const text = rtNormalizeComparableText(`${title} ${summary}`);
  if (/\b(?:environments?|school|high school|stuyvesant|classmate|friend|peer|teacher|upbringing|education)\b/.test(text)) {
    return {
      title: 'Environment and upbringing',
      summary: 'School, peers, family setting, and other surrounding conditions that may shape the outcome.',
      label: 'environment',
    };
  }
  if (/\b(?:genetic|gene|inherited|parent|sibling|family|cousin|aunt|relative)\b/.test(text)) {
    return {
      title: 'Genetics and family background',
      summary: 'Inherited traits and family patterns that may explain part of the outcome.',
      label: 'genetics',
    };
  }
  if (/\b(?:hard work|effort|practice|discipline|studying|study habit|work ethic|motivation)\b/.test(text)) {
    return {
      title: 'Effort and work habits',
      summary: 'Practice, discipline, and repeated effort as a separate explanation path.',
      label: 'effort',
    };
  }
  return undefined;
}

function rtIsPublicResearchableTask(task: string, title: string, summary: string): boolean {
  const text = rtNormalizeComparableText(`${task} ${title} ${summary}`);
  if (/\b(?:my|me|our|friend|friends|room|scrabble|diet coke|phone|cake|victor|ben|michelle)\b/.test(text)) {
    return (
      /\b(?:agent|look up|research|find current|public evidence|current evidence)\b/.test(text) &&
      /\b(?:study|research|market|stock|company|news|filing|price|revenue|sales|evidence)\b/.test(text)
    );
  }
  return /\b(?:stock|market|price|bitcoin|election|revenue|sales|filing|earnings|company|tariff|oil|energy|geopolitic|war|trade|climate|policy|inflation|rates|news|public evidence|current evidence|latest|source|data|transported|shipping|strait|hormuz|iran|india|pakistan|russia|putin|ayatollah|regime|domestic politics|mediation|diplomacy|sanction|blockade|ceasefire|reopen|closed|closure)\b/.test(text);
}

function rtDefaultTaskForSignal(kind: string, title: string, summary: string): string | undefined {
  if (kind !== 'topic' && kind !== 'factor' && kind !== 'claim' && kind !== 'question' && kind !== 'topic_shift') {
    return undefined;
  }
  if (!rtIsPublicResearchableTask(title, title, summary)) return undefined;
  return rtCleanString(
    `Fact-check and monitor current public evidence for "${title}" in this room context: ${summary}`,
    '',
    240
  );
}

function rtListNodes(ctx: any, roomId: bigint): RealtimeNodeRef[] {
  return [...ctx.db.mapNode.roomId.filter(roomId)].map((node: any) => ({
    id: node.nodeId,
    title: node.title,
    summary: node.summary,
    nodeType: node.nodeType,
    urgency: node.urgency,
  }));
}

function rtQuestionExists(ctx: any, roomId: bigint, question: string): boolean {
  return [...ctx.db.questionCandidate.roomId.filter(roomId)].some(
    (row: any) => row.question === question
  );
}

function rtTaskExists(ctx: any, roomId: bigint, instructions: string): boolean {
  return [...ctx.db.agentTask.roomId.filter(roomId)].some(
    (row: any) => row.instructions === instructions
  );
}

function rtCreateNode(
  ctx: any,
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
): RealtimeNodeRef {
  const inserted = ctx.db.mapNode.insert({
    nodeId: 0n,
    roomId,
    title: input.title,
    summary: input.summary,
    nodeType: input.nodeType,
    source: input.source,
    urgency: input.urgency,
    sourceRefId: undefined,
    x: input.x,
    y: input.y,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
  touchRoom(ctx, roomId);
  emitRoomEvent(ctx, roomId, 'map_node_created', inserted.title, inserted.nodeId);
  return {
    id: inserted.nodeId,
    title: inserted.title,
    summary: inserted.summary,
    nodeType: inserted.nodeType,
    urgency: inserted.urgency,
  };
}

function rtUpdateNode(
  ctx: any,
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
): void {
  const existing = ctx.db.mapNode.nodeId.find(nodeId);
  if (existing === null) {
    throw new SenderError('map node not found');
  }
  const updated = {
    ...existing,
    title: input.title,
    summary: input.summary,
    nodeType: input.nodeType,
    source: input.source,
    urgency: input.urgency,
    x: input.x,
    y: input.y,
    updatedAt: ctx.timestamp,
  };
  ctx.db.mapNode.nodeId.update(updated);
  touchRoom(ctx, existing.roomId);
  emitRoomEvent(ctx, existing.roomId, 'map_node_updated', updated.title, nodeId);
}

function rtCreateEdge(
  ctx: any,
  roomId: bigint,
  from: RealtimeNodeRef,
  to: RealtimeNodeRef,
  label: string
): void {
  if (from.id === to.id) return;
  const existing = first(ctx.db.mapEdge.by_room_nodes.filter([roomId, from.id, to.id]));
  if (existing !== undefined) return;
  ctx.db.mapEdge.insert({
    edgeId: 0n,
    roomId,
    fromNodeId: from.id,
    toNodeId: to.id,
    label,
    edgeType: 'related',
    strength: 1,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
  });
  touchRoom(ctx, roomId);
  emitRoomEvent(ctx, roomId, 'map_edge_created', label || 'Map edge');
}

function rtSetRoomFocus(ctx: any, roomId: bigint, nodeId: bigint | undefined, label: string): void {
  const existing = ctx.db.roomFocus.roomId.find(roomId);
  const focus = {
    roomId,
    nodeId,
    label,
    setBy: ctx.sender,
    updatedAt: ctx.timestamp,
  };
  if (existing === null) {
    ctx.db.roomFocus.insert(focus);
  } else {
    ctx.db.roomFocus.roomId.update(focus);
  }
  touchRoom(ctx, roomId);
  emitRoomEvent(ctx, roomId, 'room_focus_set', label || 'Room focus', nodeId);
}

function rtCreateQuestion(
  ctx: any,
  roomId: bigint,
  nodeId: bigint | undefined,
  question: string,
  urgency: string
): void {
  ctx.db.questionCandidate.insert({
    questionId: 0n,
    roomId,
    nodeId,
    question,
    source: 'Realtime operator',
    urgency,
    status: 'open',
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    expiresAt: undefined,
  });
  touchRoom(ctx, roomId);
  emitRoomEvent(ctx, roomId, 'question_candidate_created', shortTitle(question, 'Question'));
}

function rtCreateTask(
  ctx: any,
  roomId: bigint,
  nodeId: bigint | undefined,
  task: string,
  priority: number
): void {
  const inserted = ctx.db.agentTask.insert({
    taskId: 0n,
    roomId,
    nodeId,
    taskType: 'quick_research',
    instructions: task,
    status: 'queued',
    priority,
    resultSummary: '',
    createdBy: ctx.sender,
    claimedBy: undefined,
    createdAt: ctx.timestamp,
    claimedAt: undefined,
    completedAt: undefined,
    updatedAt: ctx.timestamp,
  });
  touchRoom(ctx, roomId);
  emitRoomEvent(
    ctx,
    roomId,
    'agent_task_created',
    shortTitle(inserted.instructions, 'Agent task'),
    nodeId,
    inserted.taskId
  );
}

function rtEnsureRootNode(
  ctx: any,
  roomId: bigint,
  nodes: RealtimeNodeRef[],
  seed: { title: string; summary: string; urgency: string },
  connectedTo: string | undefined
): RealtimeNodeRef {
  const connectedTitle = rtCleanString(connectedTo, '', 72);
  const connectedNode = rtFindSimilarNode(nodes, connectedTitle);
  if (connectedNode) return connectedNode;

  const root = rtFindRootNode(nodes);
  if (root) {
    if (rtIsGenericRoot(root) && rtCanReplaceGenericRoot(nodes, seed) && !rtIsWeakMapSignal(seed.title, seed.summary, 0.9)) {
      rtUpdateNode(ctx, root.id, {
        title: seed.title,
        summary: seed.summary,
        nodeType: 'root',
        source: 'Realtime operator',
        urgency: seed.urgency,
        x: 500,
        y: 280,
      });
      root.title = seed.title;
      root.summary = seed.summary;
      root.nodeType = 'root';
      root.urgency = seed.urgency;
    }
    return root;
  }

  const createdRoot = rtCreateNode(ctx, roomId, {
    title: connectedTitle || seed.title,
    summary: seed.summary || 'Live topic detected by the Realtime room operator.',
    nodeType: 'root',
    source: 'Realtime operator',
    urgency: seed.urgency,
    x: 500,
    y: 280,
  });
  rtSetRoomFocus(ctx, roomId, createdRoot.id, createdRoot.title);
  nodes.push(createdRoot);
  return createdRoot;
}

function rtEnsureSemanticParent(
  ctx: any,
  roomId: bigint,
  nodes: RealtimeNodeRef[],
  root: RealtimeNodeRef,
  node: RealtimeNodeRef,
  signal: { title: string; summary: string; kind: string }
): RealtimeNodeRef {
  const group = rtSemanticGroupForSignal(signal.title, signal.summary);
  if (!group || signal.kind === 'topic' || signal.kind === 'topic_shift') return root;

  const normalizedGroupTitle = rtNormalizeComparableText(group.title);
  if (rtNormalizeComparableText(node.title) === normalizedGroupTitle) return root;
  const existing = nodes.find((candidate) => {
    if (candidate.id === node.id) return false;
    if (candidate.nodeType !== 'branch' && rtNormalizeComparableText(candidate.title) !== normalizedGroupTitle) {
      return false;
    }
    return rtSemanticGroupForSignal(candidate.title, candidate.summary)?.title === group.title;
  });
  if (existing) return existing;

  const parent = rtCreateNode(ctx, roomId, {
    title: group.title,
    summary: group.summary,
    nodeType: 'branch',
    source: 'Realtime operator',
    urgency: 'normal',
    x: 500,
    y: 280,
  });
  nodes.push(parent);
  rtCreateEdge(ctx, roomId, root, parent, group.label);
  return parent;
}

export const realtimeMapSignal = spacetimedb.reducer(
  {
    roomId: t.u64(),
    kind: t.string(),
    title: t.string(),
    summary: t.string(),
    connectedTo: t.option(t.string()),
    urgency: t.string(),
    question: t.option(t.string()),
    task: t.option(t.string()),
    confidence: t.option(t.f64()),
  },
  (ctx, { roomId, kind, title, summary, connectedTo, urgency, question, task, confidence }) => {
    requireRoom(ctx, roomId);

    const cleanTitle = rtCleanString(title, '', 72);
    const cleanSummary = rtCleanString(summary, '', 220);
    if (!cleanTitle || !cleanSummary) return;

    const nodes = rtListNodes(ctx, roomId);
    if (rtIsWeakMapSignal(cleanTitle, cleanSummary, confidence, { allowLowConfidence: nodes.length === 0 })) {
      return;
    }

    const cleanKind = rtCleanEnum(
      kind,
      ['topic', 'factor', 'question', 'claim', 'topic_shift', 'summary'],
      'topic'
    );
    const cleanUrgency = rtCleanEnum(urgency, ['normal', 'high'], 'normal');

    const root = rtEnsureRootNode(
      ctx,
      roomId,
      nodes,
      { title: cleanTitle, summary: cleanSummary, urgency: cleanUrgency },
      connectedTo
    );
    const existing = rtFindSimilarNode(nodes, cleanTitle);

    const node =
      existing ??
      rtCreateNode(ctx, roomId, {
        title: cleanTitle,
        summary: cleanSummary,
        nodeType: cleanKind,
        source: 'Realtime operator',
        urgency: cleanUrgency,
        x: 500,
        y: 280,
      });

    if (root.id !== node.id) {
      const parent = rtEnsureSemanticParent(ctx, roomId, nodes, root, node, {
        title: cleanTitle,
        summary: cleanSummary,
        kind: cleanKind,
      });
      rtCreateEdge(ctx, roomId, parent, node, cleanKind === 'topic_shift' ? 'topic shift' : cleanKind);
    }

    const cleanQuestion = rtCleanOptionalString(question, 180);
    if (cleanQuestion && !rtQuestionExists(ctx, roomId, cleanQuestion)) {
      rtCreateQuestion(ctx, roomId, node.id, cleanQuestion, cleanUrgency);
    }

    const requestedTask = rtCleanOptionalString(task, 240);
    const resolvedTask =
      requestedTask && rtIsPublicResearchableTask(requestedTask, cleanTitle, cleanSummary)
        ? requestedTask
        : rtDefaultTaskForSignal(cleanKind, cleanTitle, cleanSummary);
    if (resolvedTask && !rtTaskExists(ctx, roomId, resolvedTask)) {
      rtCreateTask(ctx, roomId, node.id, resolvedTask, cleanUrgency === 'high' ? 2 : 1);
    }
  }
);

export const deleteMapNode = spacetimedb.reducer(
  {
    nodeId: t.u64(),
  },
  (ctx, { nodeId }) => {
    const existing = ctx.db.mapNode.nodeId.find(nodeId);
    if (existing === null) {
      throw new SenderError('map node not found');
    }

    for (const edge of [...ctx.db.mapEdge.roomId.filter(existing.roomId)]) {
      if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
        ctx.db.mapEdge.edgeId.delete(edge.edgeId);
      }
    }
    for (const question of [...ctx.db.questionCandidate.roomId.filter(existing.roomId)]) {
      if (question.nodeId === nodeId) ctx.db.questionCandidate.questionId.delete(question.questionId);
    }
    for (const task of [...ctx.db.agentTask.roomId.filter(existing.roomId)]) {
      if (task.nodeId === nodeId) ctx.db.agentTask.taskId.delete(task.taskId);
    }
    for (const output of [...ctx.db.agentOutput.roomId.filter(existing.roomId)]) {
      if (output.nodeId === nodeId) ctx.db.agentOutput.outputId.delete(output.outputId);
    }
    for (const row of [...ctx.db.finding.roomId.filter(existing.roomId)]) {
      if (row.nodeId === nodeId) ctx.db.finding.findingId.delete(row.findingId);
    }
    const focus = ctx.db.roomFocus.roomId.find(existing.roomId);
    if (focus !== null && focus.nodeId === nodeId) {
      ctx.db.roomFocus.roomId.update({ ...focus, nodeId: undefined, label: 'Room synthesis', updatedAt: ctx.timestamp });
    }
    const agent = ctx.db.nodeAgent.nodeId.find(nodeId);
    if (agent !== null) ctx.db.nodeAgent.nodeId.delete(nodeId);

    ctx.db.mapNode.nodeId.delete(nodeId);
    touchRoom(ctx, existing.roomId);
    emitRoomEvent(ctx, existing.roomId, 'map_node_deleted', existing.title);
  }
);

export const realtimePassiveQuestion = spacetimedb.reducer(
  {
    roomId: t.u64(),
    connectedTo: t.option(t.string()),
    question: t.string(),
    urgency: t.string(),
  },
  (ctx, { roomId, connectedTo, question, urgency }) => {
    requireRoom(ctx, roomId);

    const cleanQuestion = rtCleanString(question, '', 180);
    if (!cleanQuestion) return;

    const nodes = rtListNodes(ctx, roomId);
    const node = rtFindSimilarNode(nodes, rtCleanString(connectedTo, '', 72)) ?? nodes[0];
    const cleanUrgency = rtCleanEnum(urgency, ['normal', 'high'], 'normal');

    if (!rtQuestionExists(ctx, roomId, cleanQuestion)) {
      rtCreateQuestion(ctx, roomId, node?.id, cleanQuestion, cleanUrgency);
    }
  }
);

export const realtimeQuickAgent = spacetimedb.reducer(
  {
    roomId: t.u64(),
    connectedTo: t.option(t.string()),
    task: t.string(),
    urgency: t.string(),
  },
  (ctx, { roomId, connectedTo, task, urgency }) => {
    requireRoom(ctx, roomId);

    const cleanTask = rtCleanString(task, '', 240);
    if (!cleanTask) return;

    const nodes = rtListNodes(ctx, roomId);
    const node = rtFindSimilarNode(nodes, rtCleanString(connectedTo, '', 72)) ?? nodes[0];
    const cleanUrgency = rtCleanEnum(urgency, ['normal', 'high'], 'normal');

    if (!rtTaskExists(ctx, roomId, cleanTask)) {
      rtCreateTask(ctx, roomId, node?.id, cleanTask, cleanUrgency === 'high' ? 2 : 1);
    }
  }
);

export const realtimeCorrectNode = spacetimedb.reducer(
  {
    roomId: t.u64(),
    target: t.string(),
    title: t.option(t.string()),
    summary: t.option(t.string()),
    urgency: t.string(),
  },
  (ctx, { roomId, target, title, summary, urgency }) => {
    requireRoom(ctx, roomId);

    const cleanTarget = rtCleanString(target, '', 72);
    const cleanTitle = rtCleanOptionalString(title, 72);
    const cleanSummary = rtCleanOptionalString(summary, 220);
    if (!cleanTarget || (!cleanTitle && !cleanSummary)) return;

    const nodes = rtListNodes(ctx, roomId);
    const node =
      rtFindSimilarNode(nodes, cleanTarget) ??
      (/\bcenter|root|main\b/i.test(cleanTarget) ? rtFindRootNode(nodes) : undefined);
    if (!node) return;

    const cleanUrgency = rtCleanEnum(urgency, ['normal', 'high'], node.urgency === 'high' ? 'high' : 'normal');
    rtUpdateNode(ctx, node.id, {
      title: cleanTitle ?? node.title,
      summary: cleanSummary ?? node.summary,
      nodeType: node.nodeType,
      source: 'Realtime correction',
      urgency: cleanUrgency,
      x: 500,
      y: 280,
    });
  }
);
