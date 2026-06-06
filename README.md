# Signal Room

Live human-agent research room for the SpacetimeDB Launchpad Hackathon.

Read:

- `PLAN.md`
- `SPECS.md`
- `TASKS.md`
- `docs/DEMO_RUNBOOK.md`
- `docs/JUDGE_PITCH.md`
- `docs/API_REFERENCE.md`
- `docs/IMPLEMENTATION_HANDOFF.md`

## Current MVP

SpacetimeDB is the entire backend. Humans and AI agents are both SpacetimeDB clients: they read the same room through subscriptions and write through the same reducers. There is no separate app server holding state.

One room mic feeds a silent realtime router. The router writes shared state into SpacetimeDB, and an agent swarm drains the room's research tasks the same way. Browsers subscribe to the same room and see live cursors, presence, the map and its real labeled edges, transcript chunks, notes, findings, and research results.

The default demo path starts from a blank room. There is no seeded board: the first transcript chunk creates the first shared map state. Open the same room in two windows and you immediately see each other's live cursor move on the shared map.

## Useful Commands

```bash
pnpm install
pnpm build
pnpm check
pnpm spacetime:build
pnpm spacetime:generate
```

## Fresh-Room Demo Flow

Start the web app and gateway:

```bash
pnpm dev:web
```

```bash
pnpm dev:gateway
```

Open a fresh room URL, for example:

```text
http://127.0.0.1:5173/?room=LIVE-HACK
```

The room starts empty. Then:

1. Open the same URL in a second window. You see the other participant's live cursor move on the shared map and a presence avatar appear (`2 here`). This is the multiplayer proof.
2. In the `Host Mic` tab, enable `Route live mic`.
3. Add one manual transcript chunk or start browser speech capture.
4. Switch back to `Room Display`.

Transcript chunks are routed through the silent model router into SpacetimeDB map nodes, question candidates, and queued tasks. The agent swarm (Scout, Analyst, Verifier) then drains those tasks: you watch them claim, research, and write live in the swarm strip, the researched node pulses `Agent on it`, and a finding lands in the side rail. Click a node to focus the inspector; real labeled edges show how topics connect.

Repeatable smoke:

```bash
pnpm smoke:live
```
