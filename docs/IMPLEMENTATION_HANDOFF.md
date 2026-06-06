# Signal Room Implementation Handoff

## Current Working State

Working vertical slice:

1. Browser opens a fresh room URL; the room starts empty.
2. React joins or creates the room in SpacetimeDB.
3. A second window proves instant multi-client sync: live cursors render on the shared canvas in stage coordinates (broadcast on pointer-move through `updateCursor`), and a presence avatar stack shows who is here.
4. Host Mic writes transcript chunks through generated SpacetimeDB bindings.
5. Host Mic `Route live mic` calls local gateway `POST /replay-transcript`.
6. The model-backed silent router writes map nodes, real labeled edges, passive questions, and queued research tasks through SpacetimeDB reducers.
7. Host Mic calls `/work-room`, which runs the agent swarm (Scout, Analyst, Verifier). Workers claim queued tasks atomically, publish status to the `agent_worker` table, and write findings; the canvas shows an `Agent on it` pulse on the researched node.
8. Room Display updates live from subscriptions, drawing the `map_edge` table between node positions.
9. Gateway can also replay text transcripts into the same reducer path.

Verified commands:

```bash
pnpm check
pnpm build
pnpm status
curl http://127.0.0.1:8787/health
```

Verified browser flow:

```text
http://127.0.0.1:5173/?room=SMOKE-26H27J
```

Fresh room started empty, then model-routed transcript replay filled the map with real edges and the agent swarm wrote an Important finding.

## Code Map

Frontend:

- `apps/web/src/App.tsx`: tab routing.
- `apps/web/src/components/HostMic.tsx`: manual transcript, browser speech capture, live routing toggle, gateway trigger.
- `apps/web/src/components/RoomDisplay.tsx`: main room surface, including the canvas header presence stack and the agent swarm strip.
- `apps/web/src/components/RoomMap.tsx`: canvas rendering, live cursors in stage coordinates, real `map_edge` rendering, `Agent on it` pulse, and node interactions.
- `apps/web/src/adapters/roomAdapter.ts`: app-state bridge (no local-state mirror fallbacks).
- `apps/web/src/adapters/spacetimeAdapter.ts`: generated binding subscriptions and reducer calls, including `updateCursor`.
- `apps/web/src/config.ts`: SpacetimeDB and gateway URLs.

Gateway:

- `apps/gateway/src/index.ts`: CLI entrypoint (`serve`, `health`, `smoke`, `research`, `replay-transcript`, `work-once`, `work-batch`).
- `apps/gateway/src/http/health.ts`: local HTTP API, `/replay-transcript`, `/work-room`, and `WS /live-audio`.
- `apps/gateway/src/realtime/transcriptRouter.ts`: model-backed silent transcript router.
- `apps/gateway/src/spacetime/replayTranscript.ts`: transcript-to-map reducer writer with dedupe guards.
- `apps/gateway/src/spacetime/writeback.ts`: research result writeback.
- `apps/gateway/src/tasks/researchTaskRunner.ts`: Exa-backed research task output (requires `EXA_API_KEY`, fails fast).
- `apps/gateway/src/tasks/taskWorker.ts`: one-pass and bounded-batch queued task worker.
- `apps/gateway/src/tasks/swarm.ts`: `runRoomSwarm` runs up to three concurrent named workers (Scout, Analyst, Verifier) writing `agent_worker` presence and findings; wired into `POST /work-room`.
- `apps/gateway/src/realtime/router.ts`: current policy shell for silent router.

SpacetimeDB:

- `apps/spacetime/spacetimedb/src/index.ts`: schema and reducers.
- `apps/web/src/module_bindings/`: generated TypeScript client bindings.

Docs:

- `docs/DEMO_RUNBOOK.md`: exact local demo.
- `docs/JUDGE_PITCH.md`: judge-facing explanation.
- `docs/API_REFERENCE.md`: gateway and reducer API surface.
- `scripts/smoke-live-demo.mjs`: automated live demo verifier.

## Next Slice Options

### Option A: Realtime Router

Goal: Replace the transcript-chunk route with a true OpenAI Realtime/WebRTC tool-call session.

Acceptance:

- Host can start a realtime mic session.
- Router emits transcript chunks directly from the realtime session.
- Explicit command like "agent, research the ceasefire" creates an agent task.
- Router stays silent. No speech output.
- Same SpacetimeDB reducers used by the current route.

Current progress:

- OpenAI SDK transcription catches spoken agent requests over `WS /live-audio`.
- OpenAI SDK with OpenRouter `baseURL` handles model routing and creates map nodes, real edges, passive questions, and queued tasks.
- Host Mic has `Route live mic`; final transcript chunks call `/replay-transcript` with cumulative context.
- Host Mic calls `/work-room` after successful live routing so the swarm turns queued tasks into findings automatically.
- Replay dedupes identical routed transcript chunks and avoids adding questions/tasks to pre-existing nodes.

Likely files:

- `apps/gateway/src/realtime/router.ts`
- `apps/gateway/src/realtime/realtimeAudioSocket.ts`
- `apps/gateway/src/spacetime/replayTranscript.ts`
- `apps/gateway/src/http/health.ts`
- `apps/web/src/components/HostMic.tsx`

### Option B: Task Worker (DONE)

Delivered as the agent swarm. `runRoomSwarm` in `apps/gateway/src/tasks/swarm.ts` runs up to three concurrent named workers (Scout, Analyst, Verifier) that drain a room's queued research tasks, write live status to the `agent_worker` table through `upsertAgentWorker`, and write findings through the existing writeback. It is wired into `POST /work-room` (optional `workerCount` 1..6, capped at 3 by the roster) and auto-triggered by Host Mic after routing. Because the co-located workers share one SpacetimeDB CLI identity, an in-process task reservation prevents duplicate findings. The always-on background `startQueuedTaskWorkerLoop` was removed from `serve`; tasks are now worked when `/work-room` is called. `work-once` and `work-batch` CLI commands still exist.

Remaining (deferred): a long-running daemon that watches for queued tasks across rooms with backoff and graceful shutdown is not the default and is out of scope for the demo.

### Option C: Multi-Client Sync (DONE for cursors/presence)

Delivered: opening the same room in two windows shows live cursors moving on the shared canvas in stage coordinates (broadcast via `updateCursor`) and a presence avatar stack (`N here`). Shared notes and map updates already round-trip through SpacetimeDB without reload.

Remaining (planned, deferred until public deploy): a QR-code join flow so a phone can join the room from the room display. Deferred until a public deploy exists so the URL is reachable off localhost.

Likely files:

- `apps/web/src/components/RoomDisplay.tsx`
- `apps/web/src/components/RoomMap.tsx`

### Option D: Demo Polish

Goal: Make room display less fragile for judges.

Acceptance:

- Empty state is visually clear.
- Host Mic trigger state is obvious.
- Right rail explains passive suggestions.
- No text overflow on mobile/tablet.
- One-click "new room" or room code display if time allows.

Likely files:

- `apps/web/src/components/RoomDisplay.tsx`
- `apps/web/src/components/HostMic.tsx`
- `apps/web/src/styles.css`

## Rules For Further Work

- All shared state belongs in SpacetimeDB; it is the entire backend. No local-state mirrors or fallbacks.
- Humans and agents are both SpacetimeDB clients that read via subscriptions and write via reducers.
- Gateway may hold secrets and call external APIs, but must write back through reducers.
- No silent fallbacks: research requires `EXA_API_KEY` and fails fast if missing. No mock data.
- AI must not speak or interrupt by default.
- Fresh-room demo path must remain available.
- Avoid adding a second database.

## Verification Gates

Run after meaningful changes:

```bash
pnpm check
pnpm build
pnpm status
pnpm smoke:live
```

For SpacetimeDB schema/reducer changes:

```bash
pnpm spacetime:build
pnpm spacetime:publish
pnpm spacetime:generate
pnpm check
```

For gateway HTTP changes:

```bash
pnpm --dir apps/gateway check
pnpm --dir apps/gateway build
curl http://127.0.0.1:8787/health
```

For transcript routing:

```bash
node --enable-source-maps apps/gateway/dist/index.js replay-transcript \
  --room-code ROUTE-TEST \
  --display-name Ben \
  --delay-ms 0 \
  --file /tmp/signal-room-transcript.txt
```

For demo changes:

1. Open fresh room.
2. Confirm empty state.
3. Open a second window and confirm live cursors and a `2 here` presence avatar.
4. Enable Host Mic `Route live mic`.
5. Add Host Mic transcript chunk.
6. Confirm Room Display fills without reload, with real labeled edges.
7. Confirm the swarm strip shows workers claiming/researching/writing and a finding appears after `/work-room`.
8. Check console warnings/errors.
