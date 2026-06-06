# Signal Room Specs

## Product Spec

Signal Room is a live research room where humans and AI agents share one evolving map of a discussion.

It turns live conversation, human notes, context, and agent research into a shared state that updates instantly for everyone.

## Core User Stories

### Shared Room

As a participant, I can join a room with a local display name and see the same map as everyone else.

Acceptance:

- Room has a code or id.
- Display name persists locally.
- Multiple browser windows see the same live room, including fresh rooms that start blank.
- Map updates appear without refresh.

### Live Map

As a participant, I can see a map of the current topic, branches, findings, and open questions.

Acceptance:

- Map nodes have title, summary, source, connected topic, urgency, and timestamps.
- Nodes can be created or updated.
- Clicking a node focuses the side rail.
- Double-clicking opens the full thread.

### Shared Notes

As a participant, I can add a note to the shared map without speaking.

Acceptance:

- Note records display name as source.
- Note connects to a selected node or creates a new node.
- Other clients see it live.

### Transcript Chunks

As the room, speech can become timestamped transcript chunks.

Acceptance:

- Source can be `Room conversation`.
- No speaker attribution required.
- Chunks can create map proposals.
- Chunks are visible in transcript review.

### Room Router

As the system, the room router listens silently and routes events.

Acceptance:

- Router does not speak by default.
- Router can create transcript chunks.
- Router can create map proposals.
- Router can create agent tasks.
- Router can create passive question candidates.

### Research Agents

As a participant, I can have agents research a map node.

Acceptance:

- Research task attaches to a node.
- Exa returns real source links.
- Agent output includes short summary, links, connected node, urgency, and suggested map update.
- Result appears live to all clients.

### Passive Findings

As a group, we can see important findings without the AI interrupting.

Acceptance:

- Findings appear in the room rail.
- AI does not speak or force-send.
- Humans decide whether to open or discuss.
- Low-signal suggestions can expire.

## Technical Spec

### Frontend

- React
- TypeScript
- Vite
- SpacetimeDB TypeScript client bindings

### SpacetimeDB Module

Preferred language: TypeScript.

Tables:

- `room`
- `participant`
- `map_node`
- `map_edge`
- `transcript_chunk`
- `shared_note`
- `question_candidate`
- `agent_task`
- `agent_output`
- `finding`
- `room_focus`
- `cursor`
- `agent_worker`

Reducers:

- create or join room
- update participant
- create/update map node
- create map edge
- add transcript chunk
- add shared note
- create question candidate
- create/claim/complete agent task
- add agent output
- add finding
- set room focus
- update cursor
- upsert agent worker

Event tables:

- transient activity
- agent progress pulse
- UI toast/highlight

### Agent Gateway

Runtime: Node/TypeScript.

External services:

- OpenAI for realtime router and LLM calls.
- Exa for research.
- Optional OpenRouter/Cerebras/Groq for fast worker models later.

Env:

- `OPENAI_API_KEY`
- `EXA_API_KEY`
- optional `OPENROUTER_API_KEY`

### Data Ownership

SpacetimeDB owns shared state.

Agent gateway owns:

- secrets
- external API calls
- long-running side effects

Browser owns:

- local display name
- local/private scratchpad state until shared

## Non-Goals For MVP

- Real auth.
- Perfect diarization.
- Full Zoom integration.
- Polished infinite canvas physics.
- Persistent private document store.
- Production scheduling system.
- Agent voice output.
- GitHub project/issue automation.
