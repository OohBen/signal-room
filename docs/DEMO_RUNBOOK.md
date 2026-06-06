# Signal Room Demo Runbook

## Goal

Show a fresh room proving instant multi-client sync, then filling live from conversation into shared map state.

The judge should see:

- An empty SpacetimeDB room.
- A second window: live cursors moving on the shared map and a presence avatar appearing.
- A host transcript chunk added live.
- An agent swarm coordinating through the database, not interrupting the room.
- Map nodes, real labeled edges, questions, tasks, and findings appearing without reload.
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
- `env.hasOpenAiApiKey: true`
- `env.hasExaApiKey: true`
- `env.hasOpenRouterApiKey: true`
- `realtimeRouter.audioMode: "openai_realtime"`

## Browser Setup

Open:

```text
http://127.0.0.1:5173/?room=LIVE-HACK
```

Use a new room code for each demo run:

```text
LIVE-001
LIVE-002
LIVE-HACK
```

Fresh rooms should start empty with `Waiting for first signal`.

## Demo Script

### [0:00] Fresh Room

ACTION: Open `Room Display` on a fresh room URL.

SAY: "This starts as an empty SpacetimeDB room. There is no prebuilt board here, and there is no app server. SpacetimeDB is the whole backend."

JUDGE SEES: Empty shared map, live status, room code in header.

### [0:15] Second Window: Live Cursors And Presence

ACTION: Open the same room URL in a second browser window and move the mouse over the shared map.

SAY: "Both windows are SpacetimeDB clients on the same room. Each cursor broadcasts through the `updateCursor` reducer, and everyone subscribes to the `cursor` table. There is no socket server in between."

JUDGE SEES: The other participant's cursor moving live on the shared map in the same stage coordinates, plus a presence avatar stack in the canvas header showing `2 here`. This is the instant multi-client sync proof.

### [0:30] Host Adds Conversation

ACTION: Click `Host Mic`.

ACTION: Enable `Route live mic` before adding the transcript chunk. This makes final speech/manual chunks route into map nodes and tasks as they arrive.

When `Route live mic` is enabled, typed chunks route over HTTP and live mic chunks route over the gateway WebSocket. After routing, the gateway auto-calls `/work-room`, which spins up the agent swarm to drain the room's queued research tasks. Findings appear in the right rail shortly after the map updates.

ACTION: Add this transcript chunk:

```text
Question: will the Strait of Hormuz reopen within 72 hours? Michelle says China and India public pressure on Iran could matter. Ben asks: agent, look up recent China and India statements on Iran and whether oil markets are pricing a ceasefire.
```

ACTION: Click `Add transcript chunk`.

SAY: "The first room signal is now a reducer write. Every client subscribed to this room sees the transcript, then the silent router writes the map and queues research."

JUDGE SEES: Transcript count increments, the chunk appears in the host rail, and the map starts filling from the blank room.

### [0:55] Agent Swarm Coordinates Through The Database

ACTION: Watch the swarm strip on the room display.

SAY: "The AI is not speaking into the meeting. Up to three named workers, Scout, Analyst, and Verifier, coordinate entirely through SpacetimeDB. Each claims a queued task atomically, writes its live status to the `agent_worker` table, and writes findings through the same reducers humans use."

JUDGE SEES: Workers move through `idle -> claiming -> researching -> writing -> done` in the swarm strip, the node being researched shows an `Agent on it` pulse ring, and a finding lands in the right rail.

### [1:10] Map Fills Live

ACTION: Click `Room Display`.

SAY: "This is the SpacetimeDB part. The gateway is not maintaining app state. It is only calling reducers. Every window updates because it is subscribed to the shared room tables."

JUDGE SEES:

- Map nodes derived live from the routed conversation.
- Real labeled edges drawn between connected nodes (the canvas reads the `map_edge` table, not a faked layout).
- An Important finding in the right rail.

### [1:45] Human Quiet Backchannel

ACTION: Click `Participant Laptop`.

ACTION: Add a private/shared note:

```text
Consider whether sovereign AI orders are separate from hyperscaler capex.
```

ACTION: Click `Add to shared map`.

SAY: "Humans can add ideas without interrupting the room. Those are also reducer writes, not a separate database."

JUDGE SEES: Note appears back in the shared room.

### [2:15] Node Inspector

ACTION: Click a map node to focus it.

SAY: "Clicking a node focuses the inspector: what the node is, the real edges connecting it to other topics, and the findings attached to it."

JUDGE SEES: The inspector with the node summary, its labeled edges, and any attached findings.

## What Is Real

- SpacetimeDB cloud room creation; SpacetimeDB is the entire backend.
- Live subscriptions from React; humans and agents are both SpacetimeDB clients.
- Reducer writes for transcript chunks, notes, map nodes, edges, question candidates, agent tasks, agent outputs, findings, and focus.
- Live multiplayer cursors and presence: pointer-move broadcasts through `updateCursor`, everyone subscribes to the `cursor` table, and a presence avatar stack shows who is here.
- Real labeled edges: the canvas draws the `map_edge` table between actual node positions.
- The agent swarm: Scout, Analyst, and Verifier coordinate through SpacetimeDB, writing live status to the `agent_worker` table and findings through the shared reducers.
- Gateway HTTP triggers for transcript routing (`/replay-transcript`) and the room swarm (`/work-room`).
- Gateway `WS /live-audio` for browser-recorded mic chunks.
- Host Mic `Route live mic` path from transcript chunk to model-routed map/task state.
- Research requires `EXA_API_KEY` and fails fast with a clear error if it is missing. There is no mock-research fallback.
- Browser mic capture with MediaRecorder and WebSocket, falling back to SpeechRecognition where needed.

## What Is Still Scoped For MVP

- True OpenAI Realtime/WebRTC tool-call loop is not wired yet; the live route uses browser final transcript chunks plus the gateway model router.
- Browser mic permission/audio quality still needs an in-room live test, but the gateway WebSocket audio path is verified with a real recording chunk.
- The swarm roster is capped at three workers (Scout, Analyst, Verifier); a long-running daemon is not the default.
- Private scratchpad is local/demo-level.
- No auth beyond room code and local display name.

## Failure Fallbacks

If gateway is down:

```bash
pnpm dev:gateway
```

If a routed task did not turn into a finding, work the room from the CLI:

```bash
pnpm --dir apps/gateway build
node --enable-source-maps apps/gateway/dist/index.js work-batch --room-code LIVE-HACK --max-tasks 3
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
2. A second window shows a live cursor and a `2 here` presence avatar.
3. Host transcript chunk increments count.
4. `Route live mic` plus `Add transcript chunk` fills map without reload, with real labeled edges.
5. The swarm strip shows workers claiming, researching, and writing; a finding appears.
6. Participant note appears on shared display.
