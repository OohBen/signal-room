# Signal Room Demo Runbook

## Goal

Show a fresh room filling live from conversation into shared map state.

The judge should see:

- An empty SpacetimeDB room.
- A host transcript chunk added live.
- Silent agents triggered by the host, not interrupting the room.
- Map nodes, questions, tasks, and findings appearing without reload.
- The same room available to participant laptops.

## Local Services

Terminal 1:

```bash
pnpm dev:web
```

Terminal 2:

```bash
pnpm dev:gateway
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Expected:

- `ok: true`
- `hasOpenAiApiKey: true`
- `hasExaApiKey: true`
- `hasOpenRouterApiKey: true`
- `audioImplemented: true`

## Browser Setup

Open:

```text
http://127.0.0.1:5173/?room=LIVE-HACK
```

Use a new room code for each demo run:

```text
LIVE-001
LIVE-002
LIVE-NVDA
```

Fresh rooms should start empty with `Waiting for first signal`.

## Demo Script

### [0:00] Fresh Room

ACTION: Open `Room Display` on a fresh room URL.

SAY: "This starts as an empty SpacetimeDB room. There is no prebuilt board here."

JUDGE SEES: Empty shared map, live status, room code in header.

### [0:20] Host Adds Conversation

ACTION: Click `Host Mic`.

ACTION: Enable `Route live mic` before adding the transcript chunk. This makes final speech/manual chunks route into map nodes and tasks as they arrive.

When `Route live mic` is enabled, typed chunks route over HTTP and live mic chunks route over the gateway WebSocket. The gateway also works one queued research task for the room. A finding should appear in the right rail shortly after the map updates.

ACTION: Add this transcript chunk:

```text
Question: will the Strait of Hormuz reopen within 72 hours? Michelle says China and India public pressure on Iran could matter. Ben asks: agent, look up recent China and India statements on Iran and whether oil markets are pricing a ceasefire.
```

ACTION: Click `Add transcript chunk`.

SAY: "The first room signal is now a reducer write. Every client subscribed to this room sees the transcript, then the silent router writes the map and queues research."

JUDGE SEES: Transcript count increments, the chunk appears in the host rail, and the map starts filling from the blank room.

### [0:45] Silent Research Work

ACTION: If no finding has appeared yet, click `Work one task`.

SAY: "The AI is not speaking into the meeting. It writes passive state: nodes, questions, tasks, and findings. Humans decide what to open."

JUDGE SEES: A queued research task becomes a finding in the right rail.

### Alternate: Audio Fixture Replay

ACTION: Use a real recorded `.m4a` conversation to prove the voice-to-router path:

```bash
pnpm --dir apps/gateway build
node --enable-source-maps apps/gateway/dist/index.js audio-replay \
  --room-code LIVE-AUDIO \
  --display-name Ben \
  --delay-ms 650 \
  --chunk-seconds 12 \
  --file "/Users/bengoihman/Desktop/Downloads/Fashion Institute of Technology 3.m4a"
```

SAY: "This is a real recording, chunked like a live meeting. The router stays silent and writes shared state when the conversation produces researchable questions or explicit agent asks."

JUDGE SEES: The room fills with a Strait of Hormuz root, oil shock path, ceasefire negotiations, third-party pressure, and an explicit agent research task.

### [1:00] Map Fills Live

ACTION: Click `Room Display`.

SAY: "This is the SpacetimeDB part. The gateway is not maintaining app state. It is only calling reducers. The UI updates because it is subscribed to shared room tables."

JUDGE SEES:

- `Strait of Hormuz Reopening Prediction`
- `China & India public positions on Iran conflict`
- `Oil price impact of ceasefire talks`
- Important finding in the right rail.

### [1:45] Human Quiet Backchannel

ACTION: Click `Participant Laptop`.

ACTION: Add a private/shared note:

```text
Consider whether sovereign AI orders are separate from hyperscaler capex.
```

ACTION: Click `Add to shared map`.

SAY: "Humans can add ideas without interrupting the room. Those are also reducer writes, not a separate database."

JUDGE SEES: Note appears back in the shared room.

### [2:15] Agent Thread

ACTION: Double-click a map node or open `Agent Thread`.

SAY: "A node can be opened into the full agent thread: what triggered it, what sources it found, and how humans can redirect it."

JUDGE SEES: Thread view with finding summary, timeline, and human redirect box.

## What Is Real

- SpacetimeDB cloud room creation.
- Live subscriptions from React.
- Reducer writes for transcript chunks, notes, map nodes, edges, question candidates, agent tasks, agent outputs, findings, and focus.
- Gateway HTTP triggers for transcript routing and room-scoped task work.
- Gateway `WS /live-audio` for browser-recorded mic chunks.
- Host Mic `Route live mic` path from transcript chunk to model-routed map/task state.
- Bounded research worker through `/work-room`.
- Exa research path when key is available.
- Browser mic capture with MediaRecorder and WebSocket, falling back to SpeechRecognition where needed.
- Audio fixture replay from real `.m4a` recordings through OpenAI transcription and SpacetimeDB reducer writes.

## What Is Still Mocked Or Deterministic

- `Scripted fallback` currently runs a deterministic room-processor sequence and is not the primary demo path.
- True OpenAI Realtime/WebRTC tool-call loop is not wired yet.
- Browser mic permission/audio quality still needs an in-room live test, but the gateway WebSocket audio path is verified with a real recording chunk.
- Private scratchpad is local/demo-level.
- No auth beyond room code and local display name.

## Failure Fallbacks

If gateway is down:

```bash
pnpm dev:gateway
```

If live routing fails, use the deterministic CLI fallback:

```bash
pnpm --dir apps/gateway build
node --enable-source-maps apps/gateway/dist/index.js live-fill --room-code LIVE-HACK --display-name Ben --delay-ms 900
```

If SpacetimeDB publish changed:

```bash
pnpm spacetime:build
pnpm spacetime:publish
pnpm spacetime:generate
```

If browser state is messy, use a new room code.

## Pre-Demo Check

Run:

```bash
pnpm check
pnpm build
pnpm status
curl http://127.0.0.1:8787/health
pnpm smoke:live
```

Then verify in browser:

1. Fresh room starts empty.
2. Host transcript chunk increments count.
3. `Route live mic` plus `Add transcript chunk` fills map without reload.
4. Participant note appears on shared display.
