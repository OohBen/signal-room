# signal-room/zoom-bot

A headless Zoom Meeting SDK bot that joins a meeting, captures mixed audio, and forwards it to the Signal Room gateway's realtime audio socket. From the gateway's perspective the bot is indistinguishable from a browser microphone client.

This package is a fork of [`zoom/meetingsdk-headless-linux-sample`](https://github.com/zoom/meetingsdk-headless-linux-sample) (MIT) with one new component layered on top.

## What we layered on top of the official sample

| Component | Origin | Purpose |
|---|---|---|
| `src/` (C++) | upstream | Joins a Zoom meeting, exposes mixed PCM via `-t/--transcribe` to `/tmp/meeting.sock` |
| `bin/entry.sh` | upstream + edits | Boots pulseaudio, builds, then launches bridge + bot in parallel |
| `client/` | **new** | Node bridge: reads `/tmp/meeting.sock`, resamples 32k -> 24k PCM, forwards to gateway WS |
| `Dockerfile`, `CMakeLists.txt`, `vcpkg.json` | upstream | Untouched |

## Prerequisites

1. **Docker** (with `linux/amd64` emulation enabled on Apple Silicon).
2. **Zoom Meeting SDK credentials** — see [`docs/ZOOM_SETUP.md`](../../docs/ZOOM_SETUP.md).
3. **Zoom Meeting SDK for Linux binary** — proprietary, not redistributable.
   - Download from Zoom Marketplace -> your app -> Embed -> Meeting SDK -> Linux.
   - Extract `libmeetingsdk.so` and headers into `lib/zoomsdk/` (intentionally empty in git).

## Configuration

All config lives in `.env` (gitignored). Copy the template:

```bash
cp .env.example .env
# then edit .env
```

You need three things:

| Var | Where to find it |
|---|---|
| `ZOOM_CLIENT_ID` | Marketplace app → App Credentials |
| `ZOOM_CLIENT_SECRET` | Marketplace app → App Credentials → Show |
| `ZOOM_JOIN_URL` | Zoom meeting invite link, format `https://us02web.zoom.us/j/<id>?pwd=<encoded-pwd>` |

`config.toml` is **generated at container start** from these env vars by `bin/gen-config.sh`. Never commit it.

The Node bridge picks up its own config from the same `.env`:

| Env var | Default | Purpose |
|---|---|---|
| `BRIDGE_GATEWAY_URL` | `ws://host.docker.internal:8787/live-audio` | Gateway WS endpoint |
| `BRIDGE_ROOM_CODE` | `ZOOM-DEFAULT` | SpacetimeDB room code for the transcript |
| `BRIDGE_DISPLAY_NAME` | `Signal Room Notetaker` | Display name reported to the gateway |
| `BRIDGE_SPACETIME_DB` | `signal-room` | SpacetimeDB database name |
| `BRIDGE_SOCKET_PATH` | `/tmp/meeting.sock` | Unix socket the C++ bot writes to |

## Audio pipeline

```
Zoom meeting
  |  (32kHz mono int16 PCM, mixed)
  v
C++ bot  --writes-->  /tmp/meeting.sock
                            |
                            v
                  Node bridge (client/)
                  - 32kHz -> 24kHz resample
                  - 40ms framing
                  - base64 encode
                  - JSON {type: "audio_pcm", audioBase64: ...}
                            |
                            v
              Gateway /live-audio WebSocket
                            |
                            v
              OpenAI Realtime -> transcript -> SpacetimeDB -> web UI
```

## Run locally

```bash
docker compose up --build
```

The first build downloads vcpkg + system deps and takes a while. Subsequent builds are cached.

## Phase status

| Phase | State |
|---|---|
| 0. Marketplace app setup doc | done |
| 1. Scaffold from official sample | done |
| 2. JWT generation + env-based join | next |
| 3. Audio sanity check (10s WAV dump) | next |
| 4. WS bridge wired (this README) | done (untested end-to-end) |
| 5. Gateway spawns/stops bot containers | not started |
| 6. Per-participant audio (needs Zoom raw-data approval) | deferred |

## Upstream license

This package retains the upstream MIT license — see `LICENSE.md`.
