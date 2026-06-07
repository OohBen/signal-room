# Zoom Bot - Integration Guide

Audience: another agent or human dev picking up `apps/zoom-bot/`.

## Current architecture

```
Zoom meeting audio
  -> C++ Meeting SDK bot
  -> out/mixed.pcm
  -> Node bridge
     -> OpenAI Realtime WebSocket
     -> transcript_final events
     -> Signal Room operator response.create calls
     -> spacetime call reducer writes
  -> SpacetimeDB database signal-room
  -> web UI live subscriptions
```

The gateway is not an audio proxy. The bot calls the gateway only once at startup:

```text
POST /realtime-token
```

It uses the returned operator tools and instructions, but it ignores the ephemeral token because the bot connects to OpenAI Realtime with `OPENAI_API_KEY`.

## Required env

For the current one-meeting deployment, set these in `apps/zoom-bot/.env` locally or in the cloud runtime env:

```bash
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_JOIN_URL=
OPENAI_API_KEY=
SPACETIME_TOKEN=
BRIDGE_GATEWAY_URL=https://sig-api.benautomates.com
BRIDGE_ROOM_CODE=ZOOM-LIVE
BRIDGE_DISPLAY_NAME="Signal Room Notetaker"
BRIDGE_SPACETIME_DB=signal-room
BRIDGE_REALTIME_MODEL=gpt-realtime-2
BRIDGE_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe-2025-12-15
```

For local gateway testing only:

```bash
BRIDGE_GATEWAY_URL=http://host.docker.internal:8787
```

For ARM hosts:

```bash
ZOOM_BOT_PLATFORM=linux/arm64
```

Use the matching Linux Zoom SDK architecture.

## SpacetimeDB auth

Cloud containers authenticate with:

```bash
SPACETIME_TOKEN=<spacetime login show --token>
```

At startup, `bin/entry.sh` runs:

```bash
spacetime --root-dir /tmp/spacetime login --token "$SPACETIME_TOKEN"
```

The Node bridge then passes the same `SPACETIME_ROOT_DIR` to every `spacetime call` and `spacetime sql` command. This avoids depending on a developer machine's `~/.config/spacetime` mount.

If `SPACETIME_TOKEN` is missing or invalid, the container exits.

## Zoom SDK files

`apps/zoom-bot/lib/zoomsdk/` is intentionally not committed. The deploy host must provide:

```text
libmeetingsdk.so
h/
```

The compose file mounts that directory into the container at runtime:

```yaml
./lib/zoomsdk:/tmp/meeting-sdk-linux-sample/lib/zoomsdk:ro
```

For Coolify or another Git-based builder, GitHub source alone is not enough. Add the SDK as a server-side volume/file mount, or deploy on a VPS where the SDK directory exists before `docker compose up`.

## Reducers used

The bot writes to the same SpacetimeDB reducers the browser path uses:

- `create_room`
- `add_transcript_chunk`
- `realtime_map_signal`
- `realtime_passive_question`
- `realtime_quick_agent`
- `realtime_correct_node`

The published `signal-room` module must have those reducers. If not, the bridge logs the reducer error and the room will not update correctly.

## Deploy

VPS path:

```bash
git clone git@github.com:OohBen/signal-room.git
cd signal-room/apps/zoom-bot
# copy SDK files into lib/zoomsdk/
# create .env with required env
docker compose up -d --build
docker compose logs -f zoomsdk
```

Health signal: after the bot joins and raw recording starts, logs should show `transcript_final:` lines. Map nodes should appear in the room named by `BRIDGE_ROOM_CODE`.

## Known constraints

- Single bot, single meeting at a time.
- No orchestration endpoint yet; changing meetings means changing `ZOOM_JOIN_URL` and restarting the container.
- The bot captures mixed audio, not per-speaker audio.
- The upstream socket transcription path is not used because it was unstable; the bridge tails `out/mixed.pcm`.
- Non-English audio is not the target path right now; transcription is configured for English.

## File map

```text
apps/zoom-bot/
  Dockerfile
  compose.yaml
  bin/entry.sh
  bin/gen-config.sh
  client/src/index.js
  lib/zoomsdk/
  src/
```
