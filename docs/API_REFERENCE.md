# Signal Room API Reference

## Gateway

Local gateway base URL:

```text
http://127.0.0.1:8787
```

### `GET /health`

Purpose: Verify gateway process and safe env detection.

Auth: None.

Response:

```json
{
  "ok": true,
  "service": "signal-room-gateway",
  "env": {
    "aiEnvFound": true,
    "loadedNames": ["OPENAI_API_KEY", "EXA_API_KEY", "OPENROUTER_API_KEY"],
    "skippedNames": [],
    "hasOpenAiApiKey": true,
    "hasExaApiKey": true,
    "hasOpenRouterApiKey": true
  },
  "realtimeRouter": {
    "policy": {
      "allowSpeechOutput": false,
      "allowInterruptions": false,
      "defaultDisposition": "listen_and_route"
    },
    "audioMode": "openai_realtime"
  }
}
```

### `WS /live-audio`

Purpose: stream browser-recorded mic chunks to the gateway without exposing OpenAI keys in the browser. The gateway transcribes each chunk with the OpenAI SDK. When `routeTranscript` is true, it writes transcript and routed map/task state through SpacetimeDB reducers, then works one queued room task.

Client sends JSON messages:

```json
{
  "type": "audio_chunk",
  "roomCode": "LIVE-HACK",
  "displayName": "Ben",
  "database": "signal-room",
  "mimeType": "audio/webm",
  "fileName": "host-mic-123.webm",
  "audioBase64": "<base64 audio bytes>",
  "routeTranscript": true
}
```

Gateway replies:

```json
{
  "ok": true,
  "type": "audio_result",
  "result": {
    "transcription": {
      "model": "gpt-4o-transcribe",
      "text": "So, I've been reading a lot about the Strait of Hormuz..."
    },
    "replay": {
      "roomCode": "LIVE-HACK",
      "steps": [{ "name": "transcript_chunk", "created": "1" }]
    },
    "worker": {
      "workedCount": 1
    }
  }
}
```

Notes:

- This is the MVP live mic transport between browser and gateway.
- It is intentionally silent: no TTS and no agent interruption.
- For a later OpenAI Realtime version, browser/mobile can use WebRTC directly, while server-controlled audio can use WebSocket.

### `POST /replay-transcript`

Purpose: Replay pasted or transcribed meeting text into the current room and derive map nodes, questions, and queued agent tasks.

Request:

```json
{
  "roomCode": "LIVE-HACK",
  "displayName": "Ben",
  "database": "signal-room",
  "delayMs": 650,
  "transcript": "Agent, what is the latest Chinese position on the Iran war?"
}
```

Behavior: the model-backed silent router (OpenRouter, default `inception/mercury-2`) routes the text into map nodes, real edges, question candidates, and queued agent tasks through SpacetimeDB reducers.

### `POST /work-room`

Purpose: Run the agent swarm over a room's queued research tasks. This is what makes routed agent tasks turn into findings without a manual terminal command. Host Mic auto-calls it after routing.

The swarm runs up to three concurrent named workers (Scout, Analyst, Verifier). Each worker drains queued tasks, writing live status (`idle -> claiming -> researching -> writing -> done`) to the `agent_worker` table through `upsertAgentWorker`, and writes findings through the existing research writeback. Because the co-located workers share one SpacetimeDB CLI identity, an in-process task reservation prevents duplicate findings.

Request:

```json
{
  "roomCode": "LIVE-HACK",
  "database": "signal-room",
  "workerCount": 3
}
```

Fields:

- `roomCode`: Required. Limits work to one live room.
- `database`: Optional. Defaults to `signal-room`.
- `workerCount`: Optional. Integer 1 to 6, effectively capped at 3 by the roster. Defaults to 3.
- `maxTasks`: Optional. Integer 1 to 10. Accepted for compatibility.

Response:

```json
{
  "ok": true,
  "result": {
    "database": "signal-room",
    "roomCode": "LIVE-HACK",
    "roomId": "12",
    "totalCompleted": 2,
    "workers": [
      { "name": "Scout", "completed": 1 },
      { "name": "Analyst", "completed": 1 },
      { "name": "Verifier", "completed": 0 }
    ]
  }
}
```

## CLI

### Health

```bash
pnpm --dir apps/gateway health
```

### Research Smoke

```bash
pnpm --dir apps/gateway smoke
```

Runs a single research task end-to-end. Requires `EXA_API_KEY`; it fails fast with a clear error if the key is missing.

### Live Demo Smoke

```bash
pnpm smoke:live
```

Purpose: create a fresh room through the gateway, route a transcript, run the swarm over the room's queued tasks, and assert SpacetimeDB has transcript chunks, map nodes, agent tasks, a completed task, and a finding. Requires `EXA_API_KEY`.

### WebSocket Audio Smoke

```bash
pnpm smoke:audio-ws
```

Purpose: clip a real meeting recording, send it to `WS /live-audio`, assert the gateway returns transcription text, and assert the gateway writes routed transcript state through SpacetimeDB. Defaults to `/Users/bengoihman/Desktop/Downloads/Fashion Institute of Technology 3.m4a` when present. Override with `-- --file /path/to/audio.m4a`.

### Real Exa SDK Smoke

```bash
pnpm --dir apps/gateway build
node --enable-source-maps apps/gateway/dist/index.js smoke
```

Expected: `research.provider` is `exa`. Research requires `EXA_API_KEY` and fails fast with a clear error if it is missing. There is no mock-research fallback.

### Worker Once

```bash
pnpm --dir apps/gateway build
node --enable-source-maps apps/gateway/dist/index.js work-once
```

Purpose: claim one queued SpacetimeDB `agent_task`, run research, write `agent_output` and `finding`, then complete the task.

Optional room filter:

```bash
node --enable-source-maps apps/gateway/dist/index.js work-once --room-code LIVE-HACK
```

### Worker Batch

```bash
node --enable-source-maps apps/gateway/dist/index.js work-batch --room-code LIVE-HACK --max-tasks 3
```

Purpose: claim up to `--max-tasks` queued tasks for one room and write back findings.

### Transcript Replay

```bash
node --enable-source-maps apps/gateway/dist/index.js replay-transcript \
  --room-code LIVE-HACK \
  --display-name Ben \
  --delay-ms 650 \
  --file /tmp/signal-room-transcript.txt
```

Purpose: feed a text transcript into a fresh or existing room and watch the map form live.

The transcript router uses the OpenAI SDK with OpenRouter's OpenAI-compatible `baseURL`, defaulting to `inception/mercury-2`. Override with `SIGNAL_ROOM_ROUTER_MODEL` or `--router-model`.

### Research With Writeback

```bash
node --enable-source-maps apps/gateway/dist/index.js research \
  --query "Strait of Hormuz reopening oil price ceasefire" \
  --room 12 \
  --node 34 \
  --task 56 \
  --write-back
```

## SpacetimeDB Reducers Used By The Demo

Published database:

```text
signal-room
```

### `create_room`

Creates or updates a room by code.

Args:

- `code`
- `title`
- `displayName`

### `join_room`

Adds or updates participant presence for the sender.

Args:

- `code`
- `displayName`

### `add_transcript_chunk`

Adds a timestamped room transcript chunk.

Args:

- `roomId`
- `source`
- `text`
- `startMs`
- `endMs`
- `sourceParticipantId`

### `create_map_node`

Adds a visible map node.

Args:

- `roomId`
- `title`
- `summary`
- `nodeType`
- `source`
- `urgency`
- `sourceRefId`
- `x`
- `y`

### `add_map_edge`

Connects two map nodes.

Args:

- `roomId`
- `fromNodeId`
- `toNodeId`
- `label`
- `edgeType`
- `strength`

### `add_shared_note`

Adds a human note and attaches it to a node, or creates a note node.

Args:

- `roomId`
- `nodeId`
- `body`
- `sourceDisplayName`

### `create_question_candidate`

Adds a passive AI or human question to the room rail.

Args:

- `roomId`
- `nodeId`
- `question`
- `source`
- `urgency`
- `expiresAt`

### `create_agent_task`

Queues research or routing work.

Args:

- `roomId`
- `nodeId`
- `taskType`
- `instructions`
- `priority`

### `add_agent_output`

Stores structured agent output.

Args:

- `roomId`
- `taskId`
- `nodeId`
- `outputType`
- `summary`
- `details`
- `linksJson`
- `urgency`
- `suggestedNodeTitle`
- `suggestedNodeSummary`

### `add_finding`

Adds a visible finding to the room rail.

Args:

- `roomId`
- `nodeId`
- `outputId`
- `title`
- `summary`
- `linksJson`
- `urgency`

### `complete_agent_task`

Marks a task completed or failed.

Args:

- `taskId`
- `status`
- `resultSummary`

### `set_room_focus`

Updates selected/focused node for shared room display.

Args:

- `roomId`
- `nodeId`
- `label`

### `update_cursor`

Upserts the sender's live cursor position for the room, in stage coordinates. Broadcast on pointer-move (throttled ~55ms) so every client renders the same point.

Args:

- `roomId`
- `x`
- `y`
- `displayName`

### `upsert_agent_worker`

Upserts a named agent worker's live presence and status for the room. Written by the swarm as each worker moves through `idle -> claiming -> researching -> writing -> done`.

Args:

- `roomId`
- `name`
- `persona`
- `status`
- `detail`
- `currentTaskId`
- `currentNodeId`
- `completedCount`

## SpacetimeDB Tables

All tables are public and read by clients through subscriptions; writes go through reducers.

- `room`
- `participant`
- `map_node`
- `map_edge`
- `transcript_chunk`
- `shared_note`
- `question_candidate`
- `agent_task`
- `agent_output`
- `finding`
- `room_focus`
- `room_event` (event table)
- `cursor` — live multiplayer cursors. Columns: `cursorId`, `roomId`, `identity`, `displayName`, `x`, `y`, `updatedAt`.
- `agent_worker` — live agent presence. Columns: `workerId`, `roomId`, `name`, `persona`, `status`, `detail`, `currentTaskId`, `currentNodeId`, `completedCount`, `updatedAt`.
