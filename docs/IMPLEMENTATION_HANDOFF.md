# Signal Room Implementation Handoff

## Current Working State

Working vertical slice:

1. Browser opens a fresh room URL.
2. React joins or creates the room in SpacetimeDB.
3. Host Mic writes transcript chunks through generated SpacetimeDB bindings.
4. Host Mic `Route live mic` calls local gateway `POST /replay-transcript`.
5. The model-backed silent router writes map nodes, passive questions, and queued research tasks through SpacetimeDB reducers.
6. Host Mic calls `/work-room` so one queued task can become a finding.
7. Room Display updates live from subscriptions.
8. Gateway can also replay text transcripts and real `.m4a` audio fixtures into the same reducer path.

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

Fresh room started empty, then model-routed transcript replay filled the map and room-scoped worker wrote an Important finding.

## Code Map

Frontend:

- `apps/web/src/App.tsx`: tab routing.
- `apps/web/src/components/HostMic.tsx`: manual transcript, browser speech capture, live routing toggle, gateway trigger.
- `apps/web/src/components/RoomDisplay.tsx`: main room surface.
- `apps/web/src/components/RoomMap.tsx`: map rendering and node interactions.
- `apps/web/src/adapters/roomAdapter.ts`: app-state bridge and local fallback.
- `apps/web/src/adapters/spacetimeAdapter.ts`: generated binding subscriptions and reducer calls.
- `apps/web/src/config.ts`: SpacetimeDB and gateway URLs.

Gateway:

- `apps/gateway/src/audio/audioFixtureReplay.ts`: real audio fixture splitting/transcription/replay.
- `apps/gateway/src/index.ts`: CLI entrypoint.
- `apps/gateway/src/http/health.ts`: local HTTP API, `/process-room`, `/replay-transcript`, and `/work-room`.
- `apps/gateway/src/realtime/transcriptRouter.ts`: model-backed silent transcript router with deterministic fallback.
- `apps/gateway/src/spacetime/liveFill.ts`: current deterministic room processor.
- `apps/gateway/src/spacetime/replayTranscript.ts`: transcript-to-map reducer writer with dedupe guards.
- `apps/gateway/src/spacetime/writeback.ts`: research result writeback.
- `apps/gateway/src/tasks/researchTaskRunner.ts`: Exa-backed research task output.
- `apps/gateway/src/tasks/taskWorker.ts`: one-pass and bounded-batch queued task worker.
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

Goal: Replace deterministic processor trigger with actual audio/text router events.

Acceptance:

- Host can start mic session.
- Router emits transcript chunks.
- Explicit command like "agent, research sovereign AI demand" creates an agent task.
- Router stays silent. No speech output.
- Same SpacetimeDB reducers used by current processor.

Current progress:

- Audio fixture replay chunks a real `.m4a` recording into cumulative prefixes.
- OpenAI SDK transcription catches spoken agent requests.
- OpenAI SDK with OpenRouter `baseURL` handles model routing and creates map nodes, passive questions, and queued tasks.
- Deterministic fallback remains available with `--deterministic-router`.
- Host Mic has `Route live mic`; final transcript chunks call `/replay-transcript` with cumulative context.
- Host Mic calls `/work-room` after successful live routing so one queued task can become a finding automatically.
- Replay dedupes identical routed transcript chunks and avoids adding questions/tasks to pre-existing nodes.

Likely files:

- `apps/gateway/src/realtime/router.ts`
- `apps/gateway/src/audio/audioFixtureReplay.ts`
- `apps/gateway/src/spacetime/replayTranscript.ts`
- `apps/gateway/src/http/health.ts`
- `apps/web/src/components/HostMic.tsx`

### Option B: Task Worker

Goal: Turn the verified one-pass worker into a long-running loop.

Acceptance:

- `create_agent_task` creates queued task.
- `work-once` already claims one queued task, runs research, writes `agent_output`, writes `finding`, and completes the task.
- Long-running command polls for queued tasks.
- Loop has backoff, clear logs, and graceful shutdown.
- UI updates live.

Likely files:

- `apps/gateway/src/index.ts`
- `apps/gateway/src/spacetime/cli.ts`
- `apps/gateway/src/spacetime/writeback.ts`
- New `apps/gateway/src/tasks/taskWorker.ts`

### Option C: Two-Client Smoke

Goal: Prove multiple participants sync from SpacetimeDB.

Acceptance:

- Open same room in two browser contexts.
- Different local display names.
- Host writes transcript chunk.
- Participant adds shared note.
- Both clients see note and map updates without reload.

Likely files:

- New script under `scripts/` or documented manual smoke.
- Browser QA through in-app browser if practical.

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

- Shared state belongs in SpacetimeDB.
- Gateway may hold secrets and call external APIs, but should write back through reducers.
- AI must not speak or interrupt by default.
- Fresh-room demo path must remain available.
- Avoid adding a second database.
- Keep fallback CLI path working.

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

For audio fixture routing:

```bash
node --enable-source-maps apps/gateway/dist/index.js audio-replay \
  --room-code AUDIO-TEST \
  --display-name Ben \
  --delay-ms 0 \
  --chunk-seconds 12 \
  --stop-after-agent-request \
  --file "/Users/bengoihman/Desktop/Downloads/Fashion Institute of Technology 3.m4a"
```

For demo changes:

1. Open fresh room.
2. Confirm empty state.
3. Enable Host Mic `Route live mic`.
4. Add Host Mic transcript chunk.
5. Confirm Room Display fills without reload and shows a queued task/finding after `/work-room`.
6. Check console warnings/errors.
