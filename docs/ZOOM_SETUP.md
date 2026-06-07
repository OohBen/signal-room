# Zoom Meeting SDK Setup

One-time setup to get the credentials the Zoom bot (`apps/zoom-bot/`) needs.

You'll do this once, paste two values into `apps/gateway/.env`, and you're done.

---

## 1. Create a Zoom Marketplace app

1. Sign in at https://marketplace.zoom.us with the Zoom account you want the bot to act as.
2. Go directly to **https://marketplace.zoom.us/develop/create** — this is the "Choose your app type" picker. (The "Develop → Build App" menu is in the **top-right** of marketplace.zoom.us, not the left sidebar; the direct URL skips the hunt.)
3. Choose **General App** → **Create**. (Not Webhook-Only, not Zoom App — General App is the umbrella that lets you enable Meeting SDK inside it.)
4. Name it something like `Signal Room Notetaker`. Set distribution to **Account-level** (single account) — that means the app is private to your Zoom account, no Marketplace submission/approval needed.
5. The **Basic Information** page asks for icons, descriptions, long copy — leave those for now. They're only required to publish to the public Marketplace, which we are not doing.

## 2. Enable Meeting SDK on the app

1. In the app's left sidebar, open **Embed → Meeting SDK**.
2. Toggle **Meeting SDK** on.
3. Save.

This unlocks two credentials on the **App Credentials** page:

- `Client ID` → used as the **Meeting SDK Key**
- `Client Secret` → used as the **Meeting SDK Secret**

> Naming gotcha: Zoom rebranded "SDK Key/Secret" to "Client ID/Secret" in 2024.
> Same values, new labels. Any older tutorial that says "SDK Key" means Client ID.

## 3. Scopes

Under **Scopes → Add Scopes**, the bare minimum for joining a meeting and capturing audio is:

- `meeting:read:meeting` (read meeting details)
- `meeting:read:meeting:admin` (only if you'll join meetings owned by other users in the account)

You do **not** need broader user/account scopes for the first working version.

## 4. (Later) Raw Audio Data permission — skip for now

Per-participant audio with speaker labels requires Zoom to manually approve **Raw Data** access on the app. This is a separate request to Zoom support after the basic bot works. For Phase 1 we'll use mixed audio (one combined stream), which needs no extra approval.

## 5. Drop credentials into `.env`

In `apps/gateway/.env` add:

```
ZOOM_SDK_KEY=<Client ID from step 2>
ZOOM_SDK_SECRET=<Client Secret from step 2>
```

The gateway uses these to mint short-lived JWTs that the bot presents to Zoom when joining a meeting. The secret never leaves the gateway — the bot only receives the signed JWT.

## 6. To join a meeting, the bot also needs

- Meeting number (the 11-digit ID from the join URL)
- Meeting passcode (if the meeting has one)
- Optional: a display name (defaults to "Signal Room Notetaker")

These get passed to the bot at start time (env vars or a gateway HTTP call — Phase 5).

---

## Verification

After step 5, run:

```
pnpm --dir apps/gateway exec node -e "console.log(!!process.env.ZOOM_SDK_KEY, !!process.env.ZOOM_SDK_SECRET)"
```

Should print `true true`.
