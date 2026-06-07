# Signal Room

Signal Room is a live meeting copilot built for the SpacetimeDB Launchpad Hackathon. It listens to a room, turns the conversation into a shared mind map, lets people ask "Hey agent, ..." questions, and runs AI research agents that turn open threads into findings and takeaways.

Live app: https://sig.benautomates.com

Gateway: https://sig-api.benautomates.com/health

## Tech Used

- **SpacetimeDB**: authoritative realtime backend, database, reducers, subscriptions, presence, map state, transcript state, agent tasks, findings, and live cursor state.
- **React + Vite + TypeScript**: browser dashboard, infinite canvas, live signals rail, takeaways, sources, agents, host capture controls, and Zoom bot join control.
- **SpacetimeDB TypeScript client SDK**: browser clients subscribe to tables and call reducers directly over the live socket.
- **SpacetimeDB TypeScript module SDK**: server-side tables and reducers live in `apps/spacetime/spacetimedb/src/index.ts`.
- **Node.js gateway**: side-effect service for research, quick answers, OpenAI realtime token minting, and Zoom bot control.
- **OpenAI Realtime**: live transcription/operator path for browser mic and Zoom bot audio.
- **OpenRouter**: transcript routing, synthesis, and agent reasoning for non-realtime paths.
- **Exa**: web research for quick answers and deeper agent findings.
- **Zoom Meeting SDK for Linux**: headless meeting notetaker bot for one active Zoom meeting at a time.
- **Coolify**: cloud deployment for web, gateway, and Zoom bot services.

## How Signal Room Uses SpacetimeDB

SpacetimeDB is the backend, not just a sync layer. The room state is stored in SpacetimeDB tables, and every meaningful state change goes through a reducer.

Humans and AI agents use the same shared state:

- Browsers subscribe to SpacetimeDB tables for rooms, participants, cursors, transcript chunks, map nodes, map edges, tasks, workers, findings, sources, and takeaways.
- Browser users write through reducers for cursor movement, notes, map edits, layout cleanup, transcript chunks, and realtime operator tool calls.
- AI workers write through reducers for task claims, agent status, node insights, research findings, and room-level takeaways.
- The web UI updates live because every browser is subscribed to the same database rows.

This means the map, agent rail, presence, cursors, transcripts, and findings are multiplayer by default. There is no separate app server holding canonical room state.

Important module/client files:

- `apps/spacetime/spacetimedb/src/index.ts`: SpacetimeDB tables and reducers.
- `apps/web/src/adapters/spacetimeAdapter.ts`: subscriptions and reducer calls from the React app.
- `apps/web/src/module_bindings/`: generated TypeScript bindings for the SpacetimeDB module.
- `apps/gateway/src/spacetime/`: gateway writeback helpers for background agent work.

## How The Experience Works

The "game" is a live research room: people talk, the board fills in, agents take work, and the team tries to converge on useful takeaways.

1. **Join a room**
   Open a room URL such as `https://sig.benautomates.com/?room=LIVE-DEMO`. Everyone on the same room code sees the same canvas, presence, cursors, map, signals, and takeaways.

2. **Capture the conversation**
   The host can use the browser mic, paste manual transcript chunks, or paste a Zoom invite link into the Zoom control. Browser mic audio goes directly to OpenAI Realtime. Zoom audio is captured by the headless Zoom bot and streamed to OpenAI Realtime.

3. **Realtime operator builds the map**
   Final transcript turns are routed by a silent realtime operator. It calls tools such as `add_map_signal`, `add_passive_question`, `summon_quick_agent`, and `correct_map_node`. In the browser path, those tools call SpacetimeDB reducers directly for low latency.

4. **The canvas becomes a shared mind map**
   Topics become cards. Related ideas become edges. Cards can be moved. The cleanup control tidies the layout without changing the underlying graph.

5. **Agents work the room**
   "Hey agent, ..." questions go to a fast answer lane and land in Live Signals. Research tasks can be worked by the agent swarm, and the fleet mode researches map leaves, synthesizes upward through branches, and produces a root working answer.

6. **Takeaways and sources accumulate**
   The Takeaways tab shows decision-ready items and research tasks. Sources collect AI research sources plus things people add. Agents show worker activity.

## How To Play / Demo

Use this as the quick hackathon demo script.

1. Open the live app:

   ```text
   https://sig.benautomates.com/?room=LIVE-DEMO
   ```

2. Open the same URL in a second browser window or device. Move the cursor on one screen and show that presence/cursors update live.

3. Start capture:

   - Click **Start mic** for browser mic capture, or
   - Paste a Zoom meeting link into the **Zoom invite link** box and click **Join Zoom**, or
   - Paste a manual transcript chunk in the Host Capture screen.

4. Say or paste something with structure:

   ```text
   We are deciding whether to launch Signal Room for hackathon demos.
   The main risks are Zoom reliability, map readability, and whether the agents can find useful sources quickly.
   Hey agent, look up whether Zoom Meeting SDK Linux bots can join external meetings.
   ```

5. Watch for:

   - New map cards on the canvas.
   - Real edges between related cards.
   - Live participant count and cursors.
   - Live Signals answering direct "Hey agent" questions.
   - Agent worker status in the top strip.
   - Takeaways and sources filling in.

6. Click **Run agent fleet** when the map has a few nodes. Leaf agents research in parallel, branch agents synthesize, and the root node becomes the current working answer.

Key things to point out:

- The room starts empty; the board is built live from the meeting.
- SpacetimeDB is the whole backend and source of truth.
- Humans and AI agents are both clients writing through reducers.
- The realtime path does not use mock data or silent fallbacks.
- The map is editable: cards can be moved, inspected, researched, and cleaned up.
- Zoom bot support is one active meeting at a time for the hackathon scope.

## Run Locally

Install dependencies:

```bash
pnpm install
```

Start the web app:

```bash
pnpm dev:web
```

Start the gateway:

```bash
pnpm dev:gateway
```

Open:

```text
http://127.0.0.1:5173/?room=LIVE-HACK
```

Gateway requires real keys in `.env` or the configured env file:

- `OPENAI_API_KEY`
- `EXA_API_KEY`
- `OPENROUTER_API_KEY`
- `SPACETIME_TOKEN` for deployed gateway writeback paths

There are no mock research fallbacks. Missing required keys fail fast.

## Zoom Bot Notes

The Zoom bot lives in `apps/zoom-bot`.

It joins one Zoom meeting, captures mixed audio through the Linux Meeting SDK, streams PCM audio to OpenAI Realtime, and writes transcript/operator updates back into SpacetimeDB. The proprietary Zoom SDK is not committed; it must be mounted into the bot container.

Known Zoom constraint: an unpublished Meeting SDK app may fail with `MeetingFailCode 63` when joining meetings hosted outside the SDK app owner's Zoom account. For demos, use a meeting hosted by the same Zoom account/org as the SDK app credentials, or use a published/approved SDK app that is allowed to join external meetings.

## Useful Commands

```bash
pnpm check
pnpm build
pnpm smoke:live
pnpm spacetime:build
pnpm spacetime:publish
pnpm spacetime:generate
```

## Repo Map

```text
apps/web/                    React/Vite Signal Room dashboard
apps/gateway/                Node gateway for AI/research/realtime token/Zoom control
apps/spacetime/spacetimedb/  SpacetimeDB TypeScript module
apps/zoom-bot/               Headless Zoom Meeting SDK bot
docs/                        Demo, pitch, API, and handoff docs
scripts/                     Smoke checks and project utilities
```

## Deployment

Current cloud shape:

- Web: Coolify app `signal-room-web`
- Gateway: Coolify app `signal-room-gateway`
- Zoom bot: Coolify app `signal-room-zoom-bot`
- SpacetimeDB: maincloud database `signal-room`

The web app and gateway use build-time/runtime env in Coolify. The Zoom bot also needs a durable server-side Zoom SDK mount. Do not commit API keys or Zoom SDK binaries.
