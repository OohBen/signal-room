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
});

export default spacetimedb;

function cleanText(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
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
  // Room state is seeded through seedDemoRoom so demos can be reset explicitly.
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

function findNodeByTitle(ctx: any, roomId: bigint, title: string) {
  for (const node of ctx.db.mapNode.roomId.filter(roomId)) {
    if (node.title === title) return node;
  }
  return undefined;
}

function ensureSeedNode(
  ctx: any,
  roomId: bigint,
  title: string,
  summary: string,
  nodeType: string,
  source: string,
  urgency: string,
  x: number,
  y: number
) {
  const existing = findNodeByTitle(ctx, roomId, title);
  if (existing !== undefined) return existing;

  return ctx.db.mapNode.insert({
    nodeId: 0n,
    roomId,
    title,
    summary,
    nodeType,
    source,
    urgency,
    sourceRefId: undefined,
    x,
    y,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
}

function ensureSeedEdge(
  ctx: any,
  roomId: bigint,
  fromNodeId: bigint,
  toNodeId: bigint,
  label: string
): void {
  const existing = first(
    ctx.db.mapEdge.by_room_nodes.filter([roomId, fromNodeId, toNodeId])
  );
  if (existing !== undefined) return;

  ctx.db.mapEdge.insert({
    edgeId: 0n,
    roomId,
    fromNodeId,
    toNodeId,
    label,
    edgeType: 'related',
    strength: 1,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
  });
}

function upsertSeedFocus(ctx: any, roomId: bigint, nodeId: bigint, label: string): void {
  const focus = {
    roomId,
    nodeId,
    label,
    setBy: ctx.sender,
    updatedAt: ctx.timestamp,
  };
  const existing = ctx.db.roomFocus.roomId.find(roomId);
  if (existing === null) {
    ctx.db.roomFocus.insert(focus);
  } else {
    ctx.db.roomFocus.roomId.update(focus);
  }
}

export const seedDemoRoom = spacetimedb.reducer(
  {
    displayName: t.string(),
  },
  (ctx, { displayName }) => {
    let seededRoom = ctx.db.room.code.find('DEMO');
    if (seededRoom === null) {
      seededRoom = ctx.db.room.insert({
        roomId: 0n,
        code: 'DEMO',
        title: 'Signal Room Demo',
        description: 'Seeded vertical slice room for the Signal Room MVP.',
        createdBy: ctx.sender,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
      });
    }

    upsertParticipantForSender(
      ctx,
      seededRoom.roomId,
      displayName,
      'host',
      'online',
      undefined
    );

    const root = ensureSeedNode(
      ctx,
      seededRoom.roomId,
      'NVIDIA year-end estimate',
      'Live synthesis from room conversation, quiet human notes, and agent research.',
      'root',
      'Synthesis AI',
      'normal',
      500,
      280
    );

    const compute = ensureSeedNode(
      ctx,
      seededRoom.roomId,
      'AI compute renters',
      'Quick lane checks hyperscaler capex and who is actually renting GPUs.',
      'research',
      'Quick Research AI',
      'normal',
      170,
      120
    );

    const oil = ensureSeedNode(
      ctx,
      seededRoom.roomId,
      'Nigeria oil disruption',
      'Human-added branch waiting on specific production-volume evidence.',
      'human_note',
      participantDisplayName(ctx, seededRoom.roomId, displayName),
      'normal',
      170,
      445
    );

    const geopol = ensureSeedNode(
      ctx,
      seededRoom.roomId,
      'Geopolitics and oil',
      'Deep agent found a possible rates-pressure link. Waiting for room review.',
      'finding',
      'Deep Research AI',
      'high',
      835,
      128
    );

    const capex = ensureSeedNode(
      ctx,
      seededRoom.roomId,
      'Capex cycle',
      'Michelle turned the demand story into a source-backed capex check.',
      'human_question',
      'Michelle',
      'normal',
      838,
      442
    );

    const memory = ensureSeedNode(
      ctx,
      seededRoom.roomId,
      'Old Cisco memo',
      'Memory attached a prior bubble-comparison note to the valuation branch.',
      'memory',
      'Memory AI',
      'normal',
      500,
      84
    );

    const question = ensureSeedNode(
      ctx,
      seededRoom.roomId,
      'Sovereign AI demand',
      'Suggested question: should sovereign AI demand be separated from hyperscaler orders?',
      'question',
      'Question AI',
      'high',
      500,
      568
    );

    ensureSeedEdge(ctx, seededRoom.roomId, root.nodeId, compute.nodeId, 'demand');
    ensureSeedEdge(ctx, seededRoom.roomId, root.nodeId, oil.nodeId, 'rates risk');
    ensureSeedEdge(ctx, seededRoom.roomId, root.nodeId, geopol.nodeId, 'macro risk');
    ensureSeedEdge(ctx, seededRoom.roomId, root.nodeId, capex.nodeId, 'capex');
    ensureSeedEdge(ctx, seededRoom.roomId, root.nodeId, memory.nodeId, 'context');
    ensureSeedEdge(ctx, seededRoom.roomId, root.nodeId, question.nodeId, 'open question');

    const existingTranscript = first(
      ctx.db.transcriptChunk.roomId.filter(seededRoom.roomId)
    );
    if (existingTranscript === undefined) {
      ctx.db.transcriptChunk.insert({
        chunkId: 0n,
        roomId: seededRoom.roomId,
        source: 'Room conversation',
        text: 'The room wants NVIDIA demand evidence, but it also wants the agent to watch oil and rates risk quietly.',
        startMs: 0n,
        endMs: 9000n,
        sourceParticipantId: undefined,
        createdBy: ctx.sender,
        createdAt: ctx.timestamp,
      });
    }

    const existingNote = first(ctx.db.sharedNote.roomId.filter(seededRoom.roomId));
    if (existingNote === undefined) {
      ctx.db.sharedNote.insert({
        noteId: 0n,
        roomId: seededRoom.roomId,
        nodeId: capex.nodeId,
        body: 'Need actual capex numbers. Do not let this become a generic demand story.',
        sourceDisplayName: 'Michelle',
        createdBy: ctx.sender,
        createdAt: ctx.timestamp,
      });
    }

    const existingQuestion = first(
      ctx.db.questionCandidate.roomId.filter(seededRoom.roomId)
    );
    if (existingQuestion === undefined) {
      ctx.db.questionCandidate.insert({
        questionId: 0n,
        roomId: seededRoom.roomId,
        nodeId: question.nodeId,
        question:
          'Should sovereign AI demand be its own branch, instead of buried inside hyperscaler capex?',
        source: 'Synthesis AI',
        urgency: 'high',
        status: 'open',
        createdBy: ctx.sender,
        createdAt: ctx.timestamp,
        expiresAt: undefined,
      });
    }

    const existingTask = first(ctx.db.agentTask.roomId.filter(seededRoom.roomId));
    const task = existingTask ?? ctx.db.agentTask.insert({
      taskId: 0n,
      roomId: seededRoom.roomId,
      nodeId: question.nodeId,
      taskType: 'research',
      instructions: 'Check whether sovereign AI demand should be modeled separately.',
      status: 'queued',
      priority: 1,
      resultSummary: '',
      createdBy: ctx.sender,
      claimedBy: undefined,
      createdAt: ctx.timestamp,
      claimedAt: undefined,
      completedAt: undefined,
      updatedAt: ctx.timestamp,
    });

    upsertSeedFocus(ctx, seededRoom.roomId, root.nodeId, root.title);

    touchRoom(ctx, seededRoom.roomId);
    emitRoomEvent(
      ctx,
      seededRoom.roomId,
      'demo_room_seeded',
      'Demo room seeded',
      root.nodeId,
      task.taskId
    );
  }
);
