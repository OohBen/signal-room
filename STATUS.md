# Signal Room Status

## Current Phase

Sprint 1 vertical slice.

## Done

- Static mock created under `mocks/research-room/`.
- Grilling complete enough to start.
- `PLAN.md`, `SPECS.md`, and `TASKS.md` created.
- Root pnpm workspace created.
- SpacetimeDB TypeScript scaffold created under `apps/spacetime/`.
- Baseline `pnpm install` passes.
- SpacetimeDB MVP schema/reducer module implemented.
- React/Vite web app shell implemented from the mock.
- Agent gateway skeleton implemented.
- `pnpm check` passes.
- `pnpm build` passes.
- `pnpm spacetime:build` passes.
- `pnpm --dir apps/gateway smoke` passes.
- Real Exa research command returned 5 source links.
- Gateway research client now uses the official `exa-js` SDK with mock fallback for demo safety.
- SpacetimeDB TypeScript bindings generated under `apps/web/src/module_bindings/`.
- Web app connected to published SpacetimeDB `signal-room` database on maincloud.
- Fresh room URLs like `/?room=LIVE-HACK` now create empty live SpacetimeDB rooms instead of auto-seeding.
- Gateway `live-fill` command fills a fresh room step-by-step with transcript chunks, map nodes, notes, question candidates, agent task, and finding.
- Host Mic tab can add transcript chunks into the live SpacetimeDB room.
- Local gateway `POST /process-room` can be triggered from Host Mic to run the silent agent room processor.
- Room display renders live backend rows with backend counts and live shared notes.
- Participant laptop "Add to shared map" writes through SpacetimeDB and appears back on the room display.
- Map node double-click opens the agent thread.
- Browser QA passed on localhost desktop and mobile-width render; no fresh console errors after React dedupe fix.
- Browser QA verified `LIVE-WATCH-22738` started empty at 0 nodes and filled live to a six-node map without reload.
- Gateway `live-fill --mock --room-code LIVE-TASK-11896 --delay-ms 0` created and completed a SpacetimeDB agent task plus finding.
- Browser QA verified `LIVEQA-2432L6` started empty, accepted a Host Mic transcript chunk, then filled the map through the Host Mic deterministic fallback trigger without reload.
- Demo docs packet created under `docs/`: runbook, judge pitch, API reference, and implementation handoff.
- Gateway `work-once --mock` claimed and completed queued SpacetimeDB task `1`.
- Local `.env` created from needed `~/.ai.env` values and gateway now loads project `.env` before falling back to home `.ai.env`.
- Gateway duplicate-room guard verified: processor refuses to append a second full demo map into a room with existing map nodes.
- Host Mic now has `Replay transcript`, backed by local gateway `POST /replay-transcript`.
- Gateway `replay-transcript` command verified with real SpacetimeDB rooms.
- Recorded `.m4a` audio fixture replay implemented and verified with OpenAI transcription, cumulative prefixes, and SpacetimeDB reducer writes.
- Audio fixture room `AUDIO-FULL-052413` rendered a Strait of Hormuz map with oil shock, ceasefire, third-party pressure, and explicit China-position agent task.
- Model-backed transcript router implemented through OpenRouter with `inception/mercury-2` default and deterministic fallback.
- Model-backed audio room `MODEL-FULL-053047` created a live map from the recording, then `work-once` completed a real Exa-backed ceasefire research finding.
- Provider calls now use SDKs: `openai` for transcription, `openai` with OpenRouter `baseURL` for routing, and `exa-js` for research.
- Host Mic `Route live mic` toggle sends final transcript/manual chunks through the model router with cumulative context.
- Transcript replay now no-ops on duplicate cumulative transcript and avoids adding questions/tasks to pre-existing nodes.
- Gateway `POST /work-room` and CLI `work-batch` process bounded queued research tasks for one room.
- Host Mic auto-runs one queued research task after successful live routing, so routed tasks can turn into findings without terminal work.
- `pnpm smoke:live` added as an automated live demo verifier.
- Gateway `WS /live-audio` implemented for browser-recorded mic chunks; Host Mic now prefers MediaRecorder over the socket and falls back to SpeechRecognition.
- `pnpm smoke:audio-ws` added as a repeatable WebSocket audio verifier using a real recording.
- Host Mic WebSocket path now has start-guarding, chunk backpressure, safer socket-close handling, final-chunk request on stop, and visible gateway voice status.
- App copy polished away from mock/seeded language; fresh rooms now present as live rooms that build from conversation.
- Host capture now stays mounted across screen changes and exposes a compact capture dock on the room display, so capture/routing can continue while watching the map.
- Gateway transcript replay retries now continue missing map/topic/question/task work after partial room state exists.
- Fresh-room local fallback is now blank/live instead of seeded demo content, preventing old NVIDIA/demo state from flashing before SpacetimeDB connects.
- Host mic startup now falls back to browser speech recognition when the gateway voice socket cannot open.
- Browser mic capture now uploads finalized short recording segments instead of MediaRecorder stream fragments, avoiding OpenAI `400 Audio file might be corrupted or unsupported` on live WebM chunks.
- Gateway transcription now retries likely corrupt/unsupported browser audio by remuxing through `ffmpeg` to MP3 before calling OpenAI again.
- Host capture now routes live transcript by default, and fresh transcript-only rooms auto-route existing transcript into map state when no nodes exist.
- Transcript chunk timestamps now display `live` for epoch-based browser chunks instead of huge relative minute counters.

## In Progress

- Browser mic permission and in-room audio QA.
- True OpenAI Realtime/WebRTC tool-call session, if time permits.
- Long-running gateway worker service that claims arbitrary SpacetimeDB agent tasks.
- Final demo polish and script.

## Next Integration Steps

1. Verify the Host Mic WebSocket path from the actual browser permission prompt in a fresh room.
2. Replace the WebSocket transcription MVP with a true OpenAI Realtime/WebRTC tool-call session if time permits.
3. Turn the bounded `/work-room` worker into a long-running task claimer.
4. Run a true two-browser sync smoke with separate local names.
5. Write the final hackathon demo script.

## Current Known Blockers

- None proven yet.

## Latest Verification

- `pnpm check`
- `pnpm build`
- `pnpm spacetime:build`
- `pnpm status`
- `spacetime publish signal-room --module-path apps/spacetime/spacetimedb --yes`
- `node --enable-source-maps apps/gateway/dist/index.js live-fill --mock --room-code LIVE-WATCH-22738 --display-name Ben --delay-ms 700`
- `node --enable-source-maps apps/gateway/dist/index.js live-fill --mock --room-code LIVE-TASK-11896 --display-name Ben --delay-ms 0`
- `node --enable-source-maps apps/gateway/dist/index.js work-once --mock`
- `node --enable-source-maps apps/gateway/dist/index.js smoke` verified the official Exa SDK path with `provider: exa`.
- `curl http://127.0.0.1:8787/health` verified local `.env` loading.
- `POST /process-room` against filled `LIVEQA-24KNTK` returned clear duplicate-room error.
- `node --enable-source-maps apps/gateway/dist/index.js replay-transcript --room-code AUDIO-051930 --file /tmp/signal-room/mock-convo-transcript.txt --delay-ms 0` created cleaned Hormuz/ceasefire map nodes.
- `node --enable-source-maps apps/gateway/dist/index.js audio-replay --room-code AUDIO-RT-052341 --chunk-seconds 12 --stop-after-agent-request --file "/Users/bengoihman/Desktop/Downloads/Fashion Institute of Technology 3.m4a"` stopped on the first spoken agent request.
- `node --enable-source-maps apps/gateway/dist/index.js audio-replay --room-code AUDIO-FULL-052413 --chunk-seconds 12 --file "/Users/bengoihman/Desktop/Downloads/Fashion Institute of Technology 3.m4a"` caught both agent mentions and queued the China-position research task.
- `node --enable-source-maps apps/gateway/dist/index.js audio-replay --room-code MODEL-FULL-053047 --chunk-seconds 12 --file "/Users/bengoihman/Desktop/Downloads/Fashion Institute of Technology 3.m4a"` verified model-backed routing.
- `node --enable-source-maps apps/gateway/dist/index.js work-once --room-code MODEL-FULL-053047` completed queued task `43` and wrote a finding.
- `node --enable-source-maps apps/gateway/dist/index.js audio-replay --room-code SDK-AUDIO-053552 --chunk-seconds 12 --stop-after-agent-request --file "/Users/bengoihman/Desktop/Downloads/Fashion Institute of Technology 3.m4a"` verified SDK-backed OpenAI transcription and OpenRouter routing.
- `POST /replay-transcript` to `HTTP-SDK-0536` verified the running gateway uses the SDK-backed model router.
- Browser smoke `LIVE-ROUTE-B8TQQ` verified Host Mic `Route live mic` creates map nodes and queued tasks from a manual final chunk.
- Duplicate smoke `DEDUP-054120` verified a second identical routed transcript produces zero additional steps.
- `POST /work-room` against `HTTP-SDK-0536` completed task `54` and wrote a finding.
- Endpoint flow `AUTOHTTP-054836` verified replay plus one research worker writeback; browser showed an Important finding in Room Display.
- `pnpm smoke:live` created `SMOKE-26OJT2` and verified transcript chunks, map nodes, tasks, one completed task, and one finding.
- `pnpm smoke:live` created `SMOKE-27G9XA` after WebSocket reliability hardening and verified transcript chunks, map nodes, tasks, one completed task, and one finding.
- `pnpm smoke:live` created `SMOKE-27MA51` and verified transcript chunks, map nodes, tasks, one completed task, and one finding.
- `pnpm smoke:live` created `SMOKE-27WKJ2` after gateway retry recovery changes and verified transcript chunks, 4 map nodes, 4 tasks, one completed task, and one finding.
- `pnpm smoke:live -- --room-code DASH-VERIFY` verified smoke scripts accept the common double-dash argument form.
- `pnpm smoke:audio-ws` created `WSAUDIO-2891LT` after the browser-audio corruption fix and verified OpenAI transcription plus SpacetimeDB transcript/map rows.
- WebSocket handshake to `ws://127.0.0.1:8787/live-audio` returned `{ ok: true, type: "ready", audioImplemented: true }`.
- WebSocket audio smoke with an 18-second prefix of `Fashion Institute of Technology 3.m4a` created room `WSAUDIO-061029`, transcribed the chunk with `gpt-4o-transcribe`, and wrote transcript/root node state to SpacetimeDB.
- `pnpm smoke:audio-ws` created `WSAUDIO-27G9X9`, transcribed the recording prefix with `gpt-4o-transcribe`, and independently verified 1 transcript chunk and 1 map node in SpacetimeDB.
- Browser render check opened `WSUI-0611`, clicked Host Mic, and verified `Route live mic`, `Start mic`, `Replay transcript`, and `Live Transcript` controls render.
- Browser render check opened `WSUI-0620`, verified the header says `Live human-agent research room`, Host Mic shows `Gateway voice`, `Start mic`, `Replay transcript`, and `Scripted fallback`, and no console warnings/errors were present.
- Browser render check opened `REAL-27XC0X`, verified the Room Display capture dock shows `Routing live`, the state persists into Host Mic and back, the empty Participant Laptop no longer shows old NVIDIA content, and no console warnings/errors were present.
- Browser render check opened `BLANK-281BOS`, verified first paint is blank/live with no old demo terms, then watched gateway replay update the already-open room to 4 synced nodes/tasks without reload.
- Browser render check opened `AUDIOFIX-289N28`, verified Host Mic controls render after the finalized-segment/remux fix, and no console warnings/errors were present.
- Browser render check opened `ROUTE-28DXU5`, clicked `Add transcript chunk`, and verified routing default-on created 4 map nodes without huge transcript timestamps.
- Browser render check opened user room `LIVE-28B60Z` and verified 5 map nodes, 4 synced tasks, and no huge transcript timestamps.
- Browser visual smoke opened `SMOKE-26H27J` and verified the room display showed the live room code, three map nodes, one synced task, and an Important finding.
- Host Mic browser flow on `LIVEQA-2432L6`: add manual transcript chunk, click deterministic fallback, verify Room Display fills without reload.
- Browser localhost smoke: live room displayed, shared note round-tripped through SpacetimeDB, map node opened agent thread, desktop/mobile layouts rendered without fresh console errors.
- Browser live-fill smoke: empty room displayed first, then the map filled live without reload.
