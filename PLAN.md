# Signal Room Plan

## Objective

Build a live human-agent research room for the SpacetimeDB Launchpad Hackathon.

The demo must show multiple browsers sharing one consistent room state while a live room mic and AI agents add transcript chunks, map updates, notes, questions, and research findings in real time.

## Winning Demo

1. Several browsers join the same room.
2. The room starts empty so judges can see state being created live.
3. Host Mic creates live transcript chunks and explicitly starts silent agents.
4. The map updates for everyone through SpacetimeDB as the gateway writes reducer events.
5. A researchable node triggers an agent task.
6. The agent uses Exa or mock research depending on demo constraints.
7. The result appears as a connected finding on the shared map.
8. A human clicks a node to focus the side rail and double-clicks to open the full thread.

## MVP Decisions

- One room mic.
- No diarization for MVP. Public audio source is `Room conversation`.
- No auth. Use room code plus local display name/session.
- SpacetimeDB cloud/maincloud first if login works; local fallback.
- TypeScript first.
- AI never speaks or interrupts by default.
- GPT realtime is a silent room router, not the whole brain. Until that is complete, Host Mic can trigger the same reducer path through the local gateway.
- Exa is the web research provider.
- Private participant scratchpad may be partially mocked for MVP.
- Shared map, transcript chunks, agent tasks/results, notes, findings, and selected node should be real SpacetimeDB state where feasible.

## Architecture

### Web App

- React + TypeScript.
- Room display and participant surfaces in one app.
- Subscribes to SpacetimeDB tables.
- Calls reducers for map edits, shared notes, selected nodes, and agent commands.

### SpacetimeDB

SpacetimeDB is the source of truth and live sync layer.

Stores:

- rooms
- participants
- map nodes
- map edges
- transcript chunks
- shared notes
- question candidates
- agent tasks
- agent outputs
- findings
- selected/focused node
- presence/session state

### Agent Gateway

Small Node/TypeScript process.

Responsibilities:

- read safe env configuration from `~/.ai.env`
- create OpenAI realtime session for host mic
- receive router tool calls
- call SpacetimeDB reducers
- run Exa research tasks
- write agent results back to SpacetimeDB

It is not the app database.

### Room Router

Silent realtime agent.

Responsibilities:

- listen to room mic
- create transcript chunks
- detect explicit agent requests
- propose map updates
- create research tasks
- create passive question candidates

### Mapper

Can start as deterministic logic plus one fast LLM call.

Responsibilities:

- create nodes from router events
- update summaries
- connect findings to nodes
- keep map readable

### Research Agents

Agent pool, not many custom systems.

Task flow:

1. Map node or explicit command creates an agent task.
2. Worker claims task.
3. Worker calls Exa and an LLM.
4. Worker writes short structured result.
5. UI updates for all clients.

## Sprint Strategy

Sprint 1 target: working vertical slice.

Required:

- SpacetimeDB module builds.
- Web app connects to SpacetimeDB.
- Two browser windows see the same fresh room.
- User can add a shared note or node.
- Agent gateway can fill a fresh room live from an explicit Host Mic processor trigger with a mock or real agent result.
- Exa research path works when `EXA_API_KEY` exists.

Stretch:

- OpenAI realtime mic router.
- Automatic map updates from live transcript.
- Cloud publish.

## Testing Gates

Run continuously:

- TypeScript check/build for web app.
- SpacetimeDB module build.
- Reducer smoke test by CLI or client.
- Two-client sync smoke test.
- Agent gateway smoke test with mocked task.
- Exa task smoke test when key exists.

## Constraints

- Keep scope demo-first.
- No GitHub issue/epic overhead.
- Use subagents for parallel work and review when useful.
- Avoid storing app state outside SpacetimeDB.
- External services are workers/tools only.
- Keep secrets out of files and output.
