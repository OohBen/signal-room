# Zoom Meeting SDK Setup

One-time setup for the Zoom credentials used by `apps/zoom-bot/`.

The current bot does not ask the gateway to mint Zoom JWTs. It reads `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, and `ZOOM_JOIN_URL` directly in the bot container and generates `apps/zoom-bot/config.toml` at container start.

## 1. Create a Zoom Marketplace app

1. Sign in at https://marketplace.zoom.us with the Zoom account the bot should join from.
2. Open https://marketplace.zoom.us/develop/create.
3. Choose **General App** -> **Create**.
4. Name it `Signal Room Notetaker`.
5. Keep it account-level/private for this hackathon setup.

## 2. Enable Meeting SDK

1. In the app sidebar, open **Embed** -> **Meeting SDK**.
2. Toggle Meeting SDK on.
3. Save.

The credentials are on **App Credentials**:

- `Client ID` -> put in `ZOOM_CLIENT_ID`
- `Client Secret` -> put in `ZOOM_CLIENT_SECRET`

Zoom used to call these SDK Key and SDK Secret. Use the current Client ID and Client Secret labels.

## 3. Scopes

For the current single-account bot, start with:

- `meeting:read:meeting`
- `meeting:read:meeting:admin` only if joining meetings owned by another user in the same Zoom account

Mixed audio capture does not need Zoom Raw Data approval. Per-participant audio would need that later.

## 4. Fill `apps/zoom-bot/.env`

From the repo root:

```bash
cd apps/zoom-bot
cp .env.example .env
```

Fill:

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
```

Use `spacetime login show --token` to get `SPACETIME_TOKEN`. Do not paste the token into chat or logs.

## 5. Download the Linux Meeting SDK

From the same Marketplace app, download the Linux Meeting SDK matching the deploy platform:

- Cloud/default: `linux/amd64`
- Apple Silicon or ARM VPS: `linux/arm64` with `ZOOM_BOT_PLATFORM=linux/arm64`

Place the extracted SDK files here:

```text
apps/zoom-bot/lib/zoomsdk/libmeetingsdk.so
apps/zoom-bot/lib/zoomsdk/h/
```

## Verification

This should print `true true true` without exposing values:

```bash
cd apps/zoom-bot
set -a
source .env
set +a
node -e 'console.log(Boolean(process.env.ZOOM_CLIENT_ID), Boolean(process.env.ZOOM_CLIENT_SECRET), Boolean(process.env.ZOOM_JOIN_URL))'
```

Then run:

```bash
docker compose up --build
```
