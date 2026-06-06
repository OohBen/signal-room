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

One room mic feeds a silent realtime router. The router and workers write shared state into SpacetimeDB. Browsers subscribe to the same room and see live map, transcript chunks, notes, findings, and research results.

The default demo path starts from a blank room. There is no seeded board: the first transcript chunk creates the first shared map state.

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

Use the `Host Mic` tab:

1. Enable `Route live mic`.
2. Add one manual transcript chunk or start browser speech capture.
3. Switch back to `Room Display`.

The room starts empty. Transcript chunks are routed through the silent model router into SpacetimeDB map nodes and queued tasks; the gateway works one task and writes back a finding.

Repeatable smoke:

```bash
pnpm smoke:live
```

CLI fallback for a scripted fill:

```bash
pnpm --dir apps/gateway build
node --enable-source-maps apps/gateway/dist/index.js live-fill --room-code LIVE-HACK --display-name Ben --delay-ms 1200
```

Audio fixture replay:

```bash
node --enable-source-maps apps/gateway/dist/index.js audio-replay --room-code LIVE-AUDIO --display-name Ben --file "/path/to/meeting.m4a"
```
