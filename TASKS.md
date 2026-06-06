# Signal Room Sprint Tracker

## Status Legend

- `todo`
- `doing`
- `blocked`
- `done`

## Sprint 1: Vertical Slice

| ID | Status | Owner | Task | Verify |
| --- | --- | --- | --- | --- |
| S1-01 | done | main | Scaffold monorepo/workspace | `pnpm install` passes |
| S1-02 | done | agent-a | SpacetimeDB TypeScript module skeleton | `pnpm spacetime:build` passes |
| S1-03 | done | agent-b/main | React/Vite app shell from mock | `pnpm --dir apps/web build` passes |
| S1-04 | done | agent-c | Agent gateway skeleton | `pnpm --dir apps/gateway smoke` passes |
| S1-05 | done | main | Bind web app to SpacetimeDB generated client | browser shows live `signal-room` rows |
| S1-06 | done | agent-a/main | Reducers for room, map nodes, notes, focus | CLI seed/query and browser reducer smoke |
| S1-07 | done | agent-b/main | Live room/map UI wired to subscriptions | shared note round-trips through SpacetimeDB |
| S1-08 | done | agent-c/main | Exa research task worker | real Exa command returned 5 source links |
| S1-09 | done | main | End-to-end demo path | fresh room fills live through SpacetimeDB via Host Mic processor trigger |
| S1-10 | doing | review/main | Review + polish pass | desktop/mobile browser smoke passing; Host Mic processor smoke passing; docs packet created |
| S1-11 | done | main | Automated live demo smoke | `pnpm smoke:live` creates room, routes transcript, works task, verifies finding |

## Sprint 2: Live Audio

| ID | Status | Owner | Task | Verify |
| --- | --- | --- | --- | --- |
| S2-01 | doing | main | Host mic capture UI | manual transcript write works; WebSocket audio path verified; capture persists across screen changes; browser permission still needs live test |
| S2-02 | doing | agent-c/main | Browser realtime voice session | gateway WebSocket carries audio into transcription/SpacetimeDB; true OpenAI Realtime/WebRTC session still optional |
| S2-03 | done | main | Router writes model-routed state to SpacetimeDB | model router writes chunks, nodes, questions, and queued tasks |
| S2-04 | todo | review | Router prompt/behavior review | no unsolicited speech |
| S2-05 | done | main | Agent task worker loop | delivered as the agent swarm: `runRoomSwarm` runs Scout/Analyst/Verifier through `/work-room`, writing `agent_worker` presence and findings |
| S2-06 | done | main | Live multiplayer cursors + presence | `updateCursor`/`cursor` table render live cursors and a presence avatar stack across two windows |
| S2-07 | done | main | Real map edges on canvas | canvas draws the `map_edge` table with labels between node positions |

## Decisions Log

> Historical log. Earlier entries reference the seeded `DEMO` room, `live-fill`, and `POST /process-room`, all of which were later removed (see the 2026-06-06 stripping/swarm entries near the end). Kept as a record of decisions over time.

| Date | Decision |
| --- | --- |
| 2026-06-06 | One room mic, no diarization MVP. |
| 2026-06-06 | SpacetimeDB is shared state; gateway only handles secrets/side effects. |
| 2026-06-06 | AI stays silent by default; suggestions are passive. |
| 2026-06-06 | Exa is the MVP research provider. |
| 2026-06-06 | Root workspace scaffolded with pnpm and SpacetimeDB TypeScript baseline build passing. |
| 2026-06-06 | `STATUS.md` and `.env.example` added for lightweight tracking/handoff. |
| 2026-06-06 | Web app, gateway, and SpacetimeDB module build/check gates pass. |
| 2026-06-06 | Real Exa research path verified with 5 source links. |
| 2026-06-06 | Published `signal-room` to SpacetimeDB maincloud and seeded live `DEMO` room. |
| 2026-06-06 | React app now uses generated SpacetimeDB bindings, live subscriptions, and reducer writes for focus/notes/tasks. |
| 2026-06-06 | Browser QA verified live room display, shared note round-trip, map-to-thread interaction, and mobile overflow fix. |
| 2026-06-06 | Fresh room URLs create empty rooms by default; prefilled `DEMO` is no longer the primary demo path. |
| 2026-06-06 | Gateway `live-fill` command writes transcript, nodes, edges, notes, question candidates, agent tasks, outputs, and findings with timed pauses. |
| 2026-06-06 | Browser verified an already-open empty room filled live without reload. |
| 2026-06-06 | Host Mic can write transcript chunks and trigger the local gateway room processor through `POST /process-room`. |
| 2026-06-06 | Browser verified a fresh room can start empty, accept a Host Mic chunk, and fill the map via the silent-agent trigger without reload. |
| 2026-06-06 | Demo runbook, judge pitch, API reference, and implementation handoff created under `docs/`. |
| 2026-06-06 | Exa research client migrated to official `exa-js` SDK with mock fallback. |
| 2026-06-06 | Gateway `work-once` command verified by claiming and completing queued SpacetimeDB task `1`. |
| 2026-06-06 | Local `.env` created and runtime loaders updated to prefer project env. |
| 2026-06-06 | Duplicate-room processor guard verified against filled room `LIVEQA-24KNTK`. |
| 2026-06-06 | Transcript replay and audio fixture replay added so real recordings can fill fresh rooms without seeded data. |
| 2026-06-06 | Cumulative audio prefixes chosen for fixture routing after disjoint chunks missed short spoken agent requests. |
| 2026-06-06 | Transcript routing now uses OpenRouter `inception/mercury-2` by default with deterministic fallback. |
| 2026-06-06 | Host Mic live routing now triggers bounded room research work through `/work-room`. |
| 2026-06-06 | Added `pnpm smoke:live` as a repeatable end-to-end demo verifier. |
| 2026-06-06 | Official runbook now uses the blank-room live routing path; deterministic fill is documented as fallback only. |
| 2026-06-06 | Browser-to-gateway live mic transport uses WebSocket; gateway transcribes chunks with OpenAI SDK and writes through SpacetimeDB reducers. |
| 2026-06-06 | Added `pnpm smoke:audio-ws` and cumulative transcript context for WebSocket audio routing. |
| 2026-06-06 | Hardened Host Mic WebSocket lifecycle with start guarding, chunk backpressure, final-chunk request on stop, and direct SpacetimeDB row verification in audio smoke. |
| 2026-06-06 | Host capture now stays mounted across screen changes and exposes a compact capture dock on the room display. |
| 2026-06-06 | Replay routing retries now recover missing topic/question/task work instead of no-oping after partial state exists. |
| 2026-06-06 | Fresh room local fallback now starts blank instead of showing seeded demo content while SpacetimeDB connects. |
| 2026-06-06 | Host mic startup falls back to browser speech recognition if the gateway voice socket cannot open. |
| 2026-06-06 | Fixed OpenAI 400 corrupt-audio failures by sending finalized browser recording segments and adding gateway ffmpeg remux retry. |
| 2026-06-06 | Host capture routing now defaults on, transcript-only rooms auto-route into the map, and browser transcript timestamps no longer render as huge minute counters. |
| 2026-06-06 | Stripped demo scaffolding: removed seeded `DEMO` room/`seedDemoRoom`, web `seedRoom.ts` and dead components, `mocks/`, adapter mirror fallbacks, gateway `live-fill`/`POST /process-room`/`liveFill.ts`/scripted fallback, the Exa->mock research fallback, and `--mock`. Research now requires `EXA_API_KEY` and fails fast. |
| 2026-06-06 | Added live multiplayer cursors and presence via new `cursor` table and `updateCursor` reducer; cursors render on the shared canvas in stage coordinates with a presence avatar stack. |
| 2026-06-06 | Canvas now draws real `map_edge` relationships with labels instead of faked hub-and-spoke edges. |
| 2026-06-06 | Added a visible agent swarm: new `agent_worker` table and `upsertAgentWorker` reducer; `runRoomSwarm` runs up to 3 concurrent named workers (Scout/Analyst/Verifier) wired into `POST /work-room`, replacing the always-on background worker loop. |
| 2026-06-06 | Republished the SpacetimeDB module to maincloud `signal-room` (20 reducers, incl. `updateCursor`/`upsertAgentWorker`); all of the above verified live against maincloud. |

## Current Open Risks

- OpenAI Realtime/WebRTC tool-call loop may remain out of scope if the WebSocket transcription MVP is demo-stable.
- One-mic audio quality may affect live transcript reliability; recorded fixture shows cumulative context is needed for short commands.
