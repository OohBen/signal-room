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
    "audioImplemented": true
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
  "routeTranscript": true,
  "forceMock": false
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

### `POST /process-room`

Purpose: Start the current silent room processor for a room code.

Auth: None for MVP.

Request:

```json
{
  "roomCode": "LIVE-HACK",
  "displayName": "Ben",
  "database": "signal-room",
  "delayMs": 900,
  "forceMock": false
}
```

Fields:

- `roomCode`: Required. Existing or new SpacetimeDB room code.
- `displayName`: Optional. Actor name used for room creation and notes.
- `database`: Optional. Defaults to `signal-room`.
- `delayMs`: Optional. Delay between visible processor steps, 0 to 30000.
- `forceMock`: Optional. Use mock research even if `EXA_API_KEY` exists.

Response:

```json
{
  "ok": true,
  "result": {
    "database": "signal-room",
    "roomCode": "LIVE-HACK",
    "roomId": "12",
    "url": "http://127.0.0.1:5173/?room=LIVE-HACK",
    "steps": [
      { "name": "room_created", "created": "12" },
      { "name": "root_node", "created": "34" },
      { "name": "research_finding", "created": "37" }
    ]
  }
}
```

Current behavior: deterministic live processor. It writes real SpacetimeDB reducer events.

Next behavior: OpenAI realtime router should call the same reducer path based on transcript/tool calls.

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

Current behavior: deterministic silent router over text. It writes real SpacetimeDB reducer events.

### `POST /work-room`

Purpose: Claim and complete queued research tasks for one room. This is what makes routed agent tasks turn into findings without a manual terminal command.

Request:

```json
{
  "roomCode": "LIVE-HACK",
  "database": "signal-room",
  "maxTasks": 1,
  "forceMock": false
}
```

Fields:

- `roomCode`: Required. Limits work to one live room.
- `database`: Optional. Defaults to `signal-room`.
- `maxTasks`: Optional. Defaults to 1 and is capped at 10.
- `forceMock`: Optional. Use mock research instead of Exa.

Response:

```json
{
  "ok": true,
  "result": {
    "workedCount": 1,
    "results": [
      {
        "worked": true,
        "task": {
          "instructions": "Search public news for China's official statements on the Iran war."
        }
      }
    ]
  }
}
```

## CLI

### Health

```bash
pnpm --dir apps/gateway health
```

### Mock Research Smoke

```bash
pnpm --dir apps/gateway smoke
```

### Live Demo Smoke

```bash
pnpm smoke:live
```

Purpose: create a fresh room through the gateway, route a transcript, work one room-scoped task, and assert SpacetimeDB has transcript chunks, map nodes, agent tasks, a completed task, and a finding. Defaults to mock research for speed; pass `-- --real-research` to use Exa.

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

Expected: `research.provider` is `exa` when `EXA_API_KEY` is present. If Exa fails during normal gateway use, the client falls back to mock research for demo safety.

### Worker Once

```bash
pnpm --dir apps/gateway build
node --enable-source-maps apps/gateway/dist/index.js work-once --mock
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

### Live Fill Fallback

```bash
pnpm --dir apps/gateway build
node --enable-source-maps apps/gateway/dist/index.js live-fill --room-code LIVE-HACK --display-name Ben --delay-ms 900
```

### Transcript Replay

```bash
node --enable-source-maps apps/gateway/dist/index.js replay-transcript \
  --room-code LIVE-HACK \
  --display-name Ben \
  --delay-ms 650 \
  --file /tmp/signal-room-transcript.txt
```

Purpose: feed a text transcript into a fresh or existing room and watch the map form live.

### Audio Fixture Replay

```bash
node --enable-source-maps apps/gateway/dist/index.js audio-replay \
  --room-code LIVE-AUDIO \
  --display-name Ben \
  --delay-ms 650 \
  --chunk-seconds 12 \
  --file "/path/to/meeting.m4a"
```

Purpose: split a real recorded meeting into cumulative audio prefixes, transcribe each prefix, and replay the final transcript into SpacetimeDB. Add `--stop-after-agent-request` to stop as soon as a spoken agent request is detected.

The transcript router uses the OpenAI SDK with OpenRouter's OpenAI-compatible `baseURL`, defaulting to `inception/mercury-2`. Override with `SIGNAL_ROOM_ROUTER_MODEL` or `--router-model`. Use `--deterministic-router` for the rule-based fallback path.

### Research With Writeback

```bash
node --enable-source-maps apps/gateway/dist/index.js research \
  --query "NVIDIA valuation oil shock inflation expectations" \
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
