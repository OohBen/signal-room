# Judge Pitch: Signal Room

## One-Liner

Signal Room is a live human-agent research room. As a group talks, the room turns transcript chunks, human notes, open questions, and agent research into one shared map that updates for every browser in real time.

## Problem

Research meetings lose signal in private notes, chat logs, tabs, and follow-up documents. AI tools often make this worse by becoming another side panel: one person asks, one person sees the answer, and the room has to manually bring that context back.

Signal Room solves the missing collaboration primitive: shared live state for humans and AI agents during the meeting itself.

## Why This Is Not Just A Dashboard

A dashboard displays data after something else creates it. Signal Room is where the shared state is created.

The demo starts with an empty room. Human notes, room transcript chunks, questions, map nodes, agent tasks, and findings appear live as the room runs. Clicking a node focuses the side rail. Double-clicking opens the full agent thread. The AI is silent by default; it does not interrupt or perform a chat monologue. It routes useful events into shared state that humans control.

## Why SpacetimeDB Matters

SpacetimeDB is the source of truth and live sync layer. It owns rooms, participants, map nodes, map edges, transcript chunks, shared notes, question candidates, agent tasks, agent outputs, findings, and room focus.

That matters because every browser subscribes to the same room state and sees updates without refresh. Reducers make each state change explicit. The agent gateway holds secrets and calls OpenAI or Exa, but it does not become the app database. It writes back through the same SpacetimeDB reducer path as human actions.

The product point is that AI workers become participants in a real-time shared system, not hidden client state behind a polling dashboard.

## Demo Flow

1. Open a fresh room URL such as `http://127.0.0.1:5173/?room=LIVE-HACK`.
2. Show that the room starts empty.
3. Open the same room in more than one browser or view.
4. In the `Host Mic` tab, enable `Route live mic`.
5. Add a manual transcript chunk or use browser speech capture.
6. Watch transcript chunks, model-routed map nodes, question candidates, agent tasks, and a research finding appear across subscribed browsers without reload.
7. Add a participant note with `Add to shared map`; it round-trips through SpacetimeDB and appears on the room display.
8. Click a node to focus the side rail, then double-click it to open the agent thread.

## What Is Real

- React/Vite app connected to the published SpacetimeDB `signal-room` database on maincloud.
- Fresh room URLs create empty live SpacetimeDB rooms.
- SpacetimeDB schema and reducers cover the MVP room state.
- Browser subscriptions render live backend rows, counts, shared notes, map nodes, transcript chunks, and findings.
- Host Mic manual transcript chunks write into SpacetimeDB.
- Host Mic `Route live mic` sends cumulative transcript context to the silent model router.
- Local gateway `POST /replay-transcript` routes transcript into SpacetimeDB map nodes, questions, and tasks.
- Local gateway `POST /work-room` claims room-scoped queued research tasks and writes findings.
- Gateway `live-fill` remains available as a deterministic fallback.
- Exa research works when `EXA_API_KEY` is present and has returned real source links.
- Desktop, mobile-width, and fresh-room browser QA have passed.

## What Is Mocked Or Scoped For MVP

- The true WebRTC/OpenAI realtime mic session is still in progress; the current live route uses browser final transcript chunks plus the gateway model router.
- `Scripted fallback` remains as a deterministic safety path.
- The worker is bounded by room and task count for demo safety; a daemon-style loop is not yet the default.
- There is no real auth, no diarization, no AI voice output, and the private scratchpad may be partially mocked.

## Close

Signal Room shows SpacetimeDB as the live backbone for human-agent collaboration. The memorable moment is an empty room becoming a synchronized research map across multiple clients, with human and agent contributions using the same state path.
