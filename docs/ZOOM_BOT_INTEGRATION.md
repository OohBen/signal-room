# Zoom Bot — Integration Guide

> Audience: another agent (or human dev) picking up this work. Read this whole doc before touching `apps/zoom-bot/`.

This package is a standalone Zoom AI notetaker. It joins a Zoom meeting as a participant called **Signal Room Notetaker**, captures the audio, transcribes it via OpenAI Realtime, runs the Signal Room "operator" on each transcript turn, and writes both the transcripts and the operator's map signals directly into SpacetimeDB. It is **not** a service that talks to our gateway — it is a self-contained pipeline.

---

## TL;DR

```
Zoom meeting audio
  → C++ Meeting SDK bot (joins as "Signal Room Notetaker")
  → out/mixed.pcm (32kHz mono int16)
  → Node bridge (client/)
     ├─ tails the PCM, resamples 32k → 24k
     ├─ streams to OpenAI Realtime (WebSocket, gpt-realtime-2)
     └─ on each transcript_final:
          a) writes a transcript_chunk row to SpacetimeDB
          b) sends response.create with the operator tools/instructions
          c) maps tool calls (add_map_signal, add_passive_question,
             summon_quick_agent, correct_map_node) onto the realtime_*
             reducers in apps/spacetime/spacetimedb/src/index.ts
  → SpacetimeDB room `ZOOM-LIVE` on `signal-room-server-v3dax`
  → Web UI subscribes and renders nodes live
```

The web app needs zero changes to consume the bot's output. From the operator/canvas's perspective, the bot is indistinguishable from a human running `HostMic`.

---

## What you need to know upstream of this code

### 1. The Zoom Marketplace app is single-tenant

There is **one** Marketplace app — owned by Michelle's personal Zoom account. Its Client ID + Secret live in `apps/zoom-bot/.env` (gitignored).

- The bot uses these credentials to join any meeting hosted on **Michelle's own Zoom account**. The credentials are valid for all of Michelle's meetings.
- Joining meetings hosted on a *different* Zoom account is blocked by Zoom's March 2026 enforcement (`Beginning March 2, 2026, apps joining meetings outside their account must be authorized`). To support cross-account meetings you need OAuth/OBF/ZAK tokens — see "Future scaling" below.
- **Do not rotate the Client Secret without coordinating with whoever runs the deployed bot.** The secret is the only auth artifact; rotation breaks any running container immediately.

### 2. The Zoom Meeting SDK binary is not in git

`apps/zoom-bot/lib/zoomsdk/` is intentionally empty (only `.gitkeep`). The Zoom Meeting SDK for Linux is proprietary and cannot be redistributed. To run the bot, you must:

1. Sign in to https://marketplace.zoom.us as the Marketplace app owner.
2. Open the app → **Embed → Meeting SDK → Download SDKs → Linux-arm64** (or **Linux-x86_64** if your host is Intel; arm64 is faster on Apple Silicon).
3. Unzip and move the contents (so `libmeetingsdk.so` and `h/` sit directly under `apps/zoom-bot/lib/zoomsdk/`).

See [`ZOOM_SETUP.md`](./ZOOM_SETUP.md) for the full Marketplace walkthrough.

### 3. The SpacetimeDB module belongs to the published database

The bot writes via `spacetime call <database> <reducer>`. The CLI uses credentials in `~/.config/spacetime/`. The container mounts the host's `~/.config/spacetime` as read-only at `/root/.config/spacetime`.

- Currently writes to `signal-room-server-v3dax` (Michelle's published DB).
- This is **env-configurable** — `BRIDGE_SPACETIME_DB` in `apps/zoom-bot/.env` controls it. If the team's published DB name changes, update that env var; no code change required.
- The bot calls `create_room` once at startup and `add_transcript_chunk` on every transcript turn. The operator tools map to four in-module reducers (`realtime_map_signal`, `realtime_passive_question`, `realtime_quick_agent`, `realtime_correct_node`). All of these must exist in whatever module is published, or the bot will log `No such reducer` errors and silently drop turns.

### 4. OpenAI Realtime credentials

`OPENAI_API_KEY` in `apps/zoom-bot/.env` — used directly by the bridge for the WebSocket connection to `wss://api.openai.com/v1/realtime`. The bot reuses the same key for both transcription and the operator response calls (no separate ephemeral token).

Operator config (tools schema + instructions) is fetched **once at startup** from the gateway's `/realtime-token` endpoint (`http://host.docker.internal:8787/realtime-token`). The bot uses the **tools** and **operatorInstructions** fields; it ignores the ephemeral token value since it has its own API key. If the gateway changes the operator config, the bot will pick it up on next restart.

---

## How to consume the bot's output

If you're a downstream agent / process and want to react to bot activity:

| Table | What's there |
|---|---|
| `room` (`code='ZOOM-LIVE'`) | The room the bot writes into |
| `transcript_chunk` | One row per transcription.completed event. `text` is the spoken turn. `source = "Room conversation"`. `created_by` is the bot's spacetime identity. |
| `map_node` | Operator's claims/topics/branches (via `realtime_map_signal`). `source = "Realtime operator"`. |
| `question_candidate` | Passive questions surfaced by the operator. |
| `agent_task` | Quick-agent tasks queued by the operator. |

Subscribe to these tables exactly the same way the web app does — `useTable(tables.transcriptChunk).where(r => r.roomId.eq(roomId))`. The bot's output looks identical to a human host's output downstream.

---

## How to host it

The bot **cannot run on serverless/edge** (Vercel, Lambda, Cloudflare Workers, Fly Edge):

- The C++ Meeting SDK needs a real Linux process with PulseAudio + Xvfb stubs running.
- Image is ~6GB after the SDK is added.
- Bot needs persistent outbound TCP to Zoom's edge servers, OpenAI, and SpacetimeDB.
- No inbound ports are needed — bot calls *out* only.

**Recommended:** a single small VPS or VM. Tested OS: Ubuntu 24.04. Anything that runs Docker (Compose) works.

Suggested hosts:
- **Hetzner Cloud** (cheapest by far — €4–6/mo for a 2-vCPU/4GB ARM box)
- **DigitalOcean Droplet** (4GB shared CPU, $24/mo)
- **Fly.io Machines** (ARM machines work; needs no inbound, set `[[services]]` to empty)

Deployment recipe (manual, no orchestrator yet):

```bash
# On the host:
git clone <this repo>
cd signal-room/apps/zoom-bot

# 1) Drop the Zoom SDK into lib/zoomsdk/ (see "What you need to know #2")
# 2) Copy your .env in from a secure store:
scp local.env user@host:~/signal-room/apps/zoom-bot/.env
# 3) Mount your spacetime credentials. On a server you don't develop on,
#    do `spacetime login` once to populate ~/.config/spacetime/.
spacetime login

# 4) Build + run:
docker compose up -d
docker compose logs -f zoomsdk
```

**Health check**: tail the log for `transcript_final` lines. If none appear within ~60s after the bot says `start raw recording`, something's wrong (most often: the meeting hasn't started, or the OpenAI key is invalid).

**Restart on crash**: add `restart: unless-stopped` to the `compose.yaml` service. (Currently not set — easy fix when you deploy.)

---

## Known constraints — important to flag

1. **Single bot, single meeting at a time.** `apps/zoom-bot/.env` hardcodes one `ZOOM_JOIN_URL` and one `BRIDGE_ROOM_CODE`. To run a second meeting concurrently, you'd run a second container with a different `.env`. We have **not built orchestration** for this yet.
2. **No authentication.** Anyone who can edit `ZOOM_JOIN_URL` can point the bot at any of Michelle's meetings. The bot has no concept of "who allowed this." This is fine for the current single-tenant setup, but it's a hard blocker for multi-user.
3. **Zoom SDK is intermittently flaky.** After multiple rapid restarts, the SDK may segfault post-`authorize` (we hit this many times during dev). Fix: `docker compose down && rm -rf build out && docker compose up` does a clean rebuild and usually clears the state. Cause is inside the closed-source `libmeetingsdk.so`; can't debug further.
4. **The bot uses the file-tail IPC, not the broken Unix socket.** The upstream Zoom sample has a `--transcribe` flag that's supposed to stream PCM to a Unix socket; that path triggers an SDK segfault on the meeting join. We use the bare `-f mixed.pcm -d out` mode and the Node bridge tails the file. Adds ~50–100ms of latency, but is the only reliable option.
5. **Languages other than English get transcribed badly.** The session is pinned to `language: "en"` for accuracy on English audio. The model will sometimes hallucinate brief snippets in Korean/Arabic/Russian on silence or noise — these are harmless but noisy in the transcript log.

---

## What this should be doing next

Roughly in order:

### Phase A — operationalize the current single-bot setup

1. **Pick a host and deploy.** See "How to host it" above. Once it's running on a VPS, you can drop the meeting URL into `apps/zoom-bot/.env` and `docker compose up -d` to start.
2. **Add `restart: unless-stopped`** to `compose.yaml` so the container recovers from crashes.
3. **Log shipping.** Pipe the container's stdout to a real log destination (Loki, Logtail, Datadog — anything searchable). Right now logs live only in the container.
4. **Cleanup script.** A `scripts/zoom-bot-reset.sh` that does the clean-rebuild dance (`down && rm -rf build out && up`) for the known SDK flake.

### Phase B — make it multi-meeting

1. **Parameterize the run.** Turn `BRIDGE_ROOM_CODE` and `ZOOM_JOIN_URL` from `.env`-baked values into CLI args or a small HTTP endpoint that spawns docker containers.
2. **Add a `zoom_bot_session` table** to the SpacetimeDB module: `(meeting_id, room_code, container_id, started_at, status)`. The gateway (or a new tiny supervisor) writes to this table when it spawns/stops a bot.
3. **Expose a `/join-meeting` gateway endpoint** that accepts `{meetingUrl, roomCode, displayName}`, spawns a container, and returns the new `room_code`.
4. **Browser UI** to start/stop bots per room. A button on the canvas: "Bring the notetaker into this meeting."

### Phase C — multi-tenant / cross-account meetings

To let users other than Michelle have a bot join *their* meetings (on *their* Zoom accounts), you need OAuth/OBF/ZAK tokens:

1. Add an OAuth flow to the gateway. Users authorize the Marketplace app once; the gateway stores their refresh token in SpacetimeDB.
2. When spawning a bot for a meeting on a different account, fetch a fresh ZAK or App Privilege token from Zoom's API on behalf of that user, pass it to the bot via env, and the C++ bot's `Config::zak()` / `Config::joinToken()` paths pick it up automatically.
3. Per-account rate limits become a thing — multiple Marketplace apps may eventually be needed for scale, but you can defer that to >100 simultaneous meetings.

This is the largest scope of the three phases and is fine to defer until we have real demand.

---

## File map

```
apps/zoom-bot/
├── Dockerfile                  # ubuntu:24.04 + node20 + spacetime CLI + pulseaudio
├── compose.yaml                # linux/arm64 + spacetime cred mount + host.docker.internal
├── CMakeLists.txt              # C++ build (arm64-friendly; upstream hardcoded x86_64)
├── bin/
│   ├── entry.sh                # container entrypoint: pulseaudio, build, launch bridge + bot
│   └── gen-config.sh           # writes config.toml from .env vars
├── src/                        # C++ bot — fork of zoom/meetingsdk-headless-linux-sample
│   └── util/SocketServer.cpp   # we patched writeBuf to not exit() on no-client
├── client/
│   ├── package.json            # openai + ws
│   └── src/index.js            # the bridge — full audio→transcript→operator→spacetime
├── lib/zoomsdk/
│   └── .gitkeep                # SDK files dropped here at deploy time (not in git)
├── .env                        # gitignored: Zoom + OpenAI creds + meeting URL
└── .env.example                # template
```

---

## Why the bot bypasses the gateway

The gateway used to serve a `/live-audio` WebSocket route that did the OpenAI Realtime + SpacetimeDB writes on behalf of the browser. That route was deleted in commit `8fcc46f` ("Prune retired realtime gateway paths") as part of the move to browser-direct map writes. We didn't restore it — instead the bot does the same work the browser does (OpenAI Realtime + direct reducer calls), just over WebSocket-based audio rather than WebRTC, since Node has no WebRTC.

The only gateway dependency the bot has is the `/realtime-token` endpoint, which serves the operator tools + instructions. If you ever delete that endpoint, copy `apps/gateway/src/realtime/operatorConfig.ts` directly into the bot.

---

## One non-obvious build pitfall

`apps/web/vite.config.ts` was patched to fix a Vite 8 bug: the relative `envDir: "../.."` setting silently drops the env, so `VITE_SPACETIME_DATABASE` from the repo-root `.env` never reaches the browser. The browser then falls back to the default `"signal-room"` database — which is orphaned and **looks empty but is actually wrong**, with no error. The fix resolves envDir from `import.meta.url` instead. **Do not revert this change** even if it looks unrelated to the bot — the bot's writes are invisible in the UI without it.
