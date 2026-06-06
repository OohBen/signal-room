# Judge Pitch: Signal Room

## One-Liner

Signal Room is a live meeting copilot built entirely on SpacetimeDB. It listens to a meeting and turns the conversation into a shared mind map in real time; anyone can say "Hey agent, ..." to get a quick researched answer; and important findings surface as glanceable cards the whole room sees. Humans and AI agents are both SpacetimeDB clients that write through the same reducers, so every browser stays in sync instantly.

## Problem

Research meetings lose signal in private notes, chat logs, tabs, and follow-up documents. AI tools often make this worse by becoming another side panel: one person asks, one person sees the answer, and the room has to manually bring that context back.

Signal Room solves the missing collaboration primitive: shared live state for humans and AI agents during the meeting itself.

## Why This Is Not Just A Dashboard

A dashboard displays data after something else creates it. Signal Room is where the shared state is created.

The demo starts with an empty room. Live cursors, presence, human notes, room transcript chunks, questions, map nodes with real edges, agent tasks, and findings appear live as the room runs. Clicking a node focuses the inspector. The AI is silent by default; it does not interrupt or perform a chat monologue. It routes useful events into shared state that humans control.

## Why SpacetimeDB Matters

SpacetimeDB is the entire backend. There is no app server. The module is the single source of truth: it owns rooms, participants, cursors, agent-worker presence, map nodes, map edges, transcript chunks, shared notes, question candidates, agent tasks, agent outputs, findings, and room focus. Every client, human or agent, reads through subscriptions and writes through reducers.

Three things make this concrete for judges:

- Live cursors and presence prove instant multi-client sync. Pointer-move broadcasts through the `updateCursor` reducer; everyone subscribes to the `cursor` table and sees the same point on the shared map. No socket server sits in between.
- The agent swarm coordinates through the database. Workers claim queued tasks atomically through reducers, publish their live status to the `agent_worker` table, and write findings through the same path humans use. There is no out-of-band agent messaging bus.
- The map is real database state. The canvas draws the `map_edge` table between actual node positions, not a faked layout.

The agent gateway holds secrets and calls OpenAI or Exa, but it does not become the app database. AI workers are participants in a real-time shared system, not hidden client state behind a polling dashboard.

## Demo Flow

1. Open a fresh room URL such as `http://127.0.0.1:5173/?room=LIVE-HACK`. Show that it starts empty.
2. Open the same room in a second window and move the mouse. The other window sees the live cursor move on the shared map and a `2 here` presence avatar appears. This is the instant multi-client sync moment.
3. In the `Host Mic` tab, enable `Route live mic`.
4. Add a manual transcript chunk or use browser speech capture.
5. Watch transcript chunks, model-routed map nodes with real labeled edges, question candidates, and agent tasks appear across subscribed browsers without reload.
6. Watch the agent swarm: Scout, Analyst, and Verifier claim, research, and write live in the swarm strip; the researched node pulses `Agent on it`; a finding lands in the side rail.
7. Add a participant note with `Add to shared map`; it round-trips through SpacetimeDB and appears on the room display.
8. Click a node to focus the inspector and see its real edges and attached findings.

## What Is Real

- React/Vite app connected to the published SpacetimeDB `signal-room` database on maincloud. SpacetimeDB is the entire backend.
- Fresh room URLs create empty live SpacetimeDB rooms.
- SpacetimeDB schema and reducers cover the room state; the module is the single source of truth.
- Browser subscriptions render live backend rows, counts, shared notes, map nodes, transcript chunks, and findings.
- Live multiplayer cursors and presence: pointer-move broadcasts through `updateCursor`, the `cursor` table syncs to all clients, and a presence avatar stack shows who is here.
- Real labeled edges drawn from the `map_edge` table between actual node positions.
- The agent swarm: Scout, Analyst, and Verifier coordinate through SpacetimeDB, claiming tasks atomically, publishing live status to the `agent_worker` table, and writing findings through the shared reducers.
- Host Mic manual transcript chunks write into SpacetimeDB.
- Host Mic `Route live mic` sends cumulative transcript context to the silent model router.
- Local gateway `POST /replay-transcript` routes transcript into SpacetimeDB map nodes, questions, and tasks.
- Local gateway `POST /work-room` runs the swarm over room-scoped queued tasks and writes findings.
- Exa research is required (`EXA_API_KEY`) and fails fast if missing; it has returned real source links. There is no mock-research fallback.
- Desktop, mobile-width, and fresh-room browser QA have passed.

## What Is Scoped For MVP

- The true WebRTC/OpenAI realtime mic session is still in progress; the current live route uses browser final transcript chunks plus the gateway model router.
- The swarm roster is capped at three workers (Scout, Analyst, Verifier); a long-running daemon is not the default.
- There is no real auth, no diarization, no AI voice output, and the private scratchpad may be partially mocked.

## Close

Signal Room shows SpacetimeDB as the entire backend for human-agent collaboration. The memorable moment is an empty room becoming a synchronized research map across multiple clients, with live cursors, a coordinating agent swarm, and human and agent contributions all using the same reducer path.
