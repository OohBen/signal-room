# signal-room/zoom-bot

Headless Zoom Meeting SDK notetaker for Signal Room.

The bot joins one Zoom meeting, captures mixed audio, streams that audio to OpenAI Realtime, and writes transcript/operator updates directly into SpacetimeDB. The gateway is only used at startup to fetch the same realtime operator tools and instructions that the browser uses from `/realtime-token`.

## Pipeline

```
Zoom meeting
  -> C++ Meeting SDK bot writes out/mixed.pcm (32kHz mono int16)
  -> Node bridge tails the PCM file and resamples to 24kHz
  -> OpenAI Realtime transcribes and runs operator tool calls
  -> spacetime call writes transcript chunks and realtime_* reducer updates
  -> Signal Room web UI receives live table updates
```

There is no `/live-audio` gateway WebSocket in this path.

## Required runtime env

Put these in `.env` for local compose or as cloud runtime env vars:

| Env var | Value |
|---|---|
| `ZOOM_CLIENT_ID` | Zoom Marketplace General App Client ID with Meeting SDK enabled |
| `ZOOM_CLIENT_SECRET` | Zoom Marketplace General App Client Secret |
| `ZOOM_JOIN_URL` | Full Zoom join URL for the single meeting this bot should join |
| `OPENAI_API_KEY` | OpenAI key used by the bot's direct Realtime WebSocket |
| `SPACETIME_TOKEN` | Output of `spacetime login show --token` for maincloud |
| `BRIDGE_GATEWAY_URL` | `https://sig-api.benautomates.com` in cloud; local override: `http://host.docker.internal:8787` |
| `BRIDGE_ROOM_CODE` | Signal Room room code to write into, for example `ZOOM-LIVE` |
| `BRIDGE_SPACETIME_DB` | `signal-room` |

Optional:

| Env var | Default |
|---|---|
| `BRIDGE_DISPLAY_NAME` | `Signal Room Notetaker` |
| `BRIDGE_REALTIME_MODEL` | `gpt-realtime-2` |
| `BRIDGE_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe-2025-12-15` |
| `BRIDGE_PCM_PATH` | `../out/mixed.pcm` |
| `BRIDGE_POLL_MS` | `100` |
| `ZOOM_BOT_PLATFORM` | `linux/amd64`; use `linux/arm64` only with the matching Linux-arm64 SDK |
| `ZOOM_SDK_DIR` | local default `./lib/zoomsdk`; cloud should use a server-side directory such as `/data/signal-room/zoom-sdk` |

## Non-env requirement: Zoom SDK files

The Zoom Meeting SDK for Linux is proprietary and is not committed.

Download the SDK from the Zoom Marketplace app, then place the Linux SDK files under:

```
apps/zoom-bot/lib/zoomsdk/
```

`libmeetingsdk.so` and the `h/` headers must sit directly inside that directory. Use the SDK architecture that matches `ZOOM_BOT_PLATFORM`.

## Run locally

```bash
cd apps/zoom-bot
cp .env.example .env
# edit .env with the required values
docker compose up --build
```

If you want the bot to use a local gateway for operator config, run `pnpm dev:gateway` from the repo root and set:

```bash
BRIDGE_GATEWAY_URL=http://host.docker.internal:8787
```

Otherwise leave `BRIDGE_GATEWAY_URL=https://sig-api.benautomates.com`.

## Cloud deploy shape

This package is cloud-forward:

- The image copies source code at build time; it does not require a source bind mount.
- SpacetimeDB auth is token-based through `SPACETIME_TOKEN`.
- The default gateway target is the deployed gateway.
- The Zoom SDK is mounted at runtime from `ZOOM_SDK_DIR` because it cannot be committed.
- `restart: unless-stopped` is enabled for the single running meeting bot.

For a VPS deploy:

```bash
git clone git@github.com:OohBen/signal-room.git
cd signal-room/apps/zoom-bot
# copy SDK files into lib/zoomsdk/
# create .env with the required runtime env above
docker compose up -d --build
docker compose logs -f zoomsdk
```

For Coolify or another Git-based builder, you still need to provide the Zoom SDK directory as a runtime volume or server-side file mount. GitHub source alone cannot contain the SDK.

## Current scope

This runs one bot for one meeting at a time. To run another meeting concurrently, run another container with a different `.env`, especially a different `ZOOM_JOIN_URL` and `BRIDGE_ROOM_CODE`.

## Upstream license

This package retains the upstream MIT license. See `LICENSE.md`.
