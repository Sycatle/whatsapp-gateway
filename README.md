# WhatsApp Cloud API prototype

A minimal Node.js/TypeScript webhook receiver for validating WhatsApp Cloud API and demonstrating real message delivery. No AI, transcription, database, or automatic replies.

## Current status

Verified end to end:

- Meta webhook verification over a public HTTPS tunnel.
- Incoming text messages from a verified WhatsApp test recipient.
- Validation of `X-Hub-Signature-256` against the raw request body.
- Outgoing text messages sent directly through Graph API during setup.
- Incoming `sent`, `delivered`, and `read` status events.

The server currently logs authenticated events. Local sending endpoints, media downloads, and image/audio/document uploads are **not implemented yet**. Sending through Graph API has been demonstrated, but is not exposed by this server.

## Requirements

- Node.js 22 or newer and npm.
- A Meta developer application configured for the WhatsApp use case.
- A Meta test phone number and a verified recipient.
- An HTTPS endpoint accessible by Meta (Cloudflare Tunnel was used locally).

## Run locally

```bash
npm ci
cp .env.example .env
chmod 600 .env
# Fill in .env using your own Meta application settings.
npm run dev
```

The server listens on `127.0.0.1:3000` by default.

```bash
curl http://127.0.0.1:3000/health
npm run check
```

`npm run check` runs TypeScript validation. There is no separate lint or automated test command configured.

## Routes

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | Returns `{"ok":true}`. |
| GET | `/webhook` | Validates the verification token and returns Meta's challenge. |
| POST | `/webhook` | Checks the raw-body HMAC signature, parses JSON, acknowledges the event, and logs it. |

Webhook payloads larger than 1 MiB are rejected. Requests without a valid signature receive HTTP 403. Malformed JSON receives HTTP 400.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Local listening port, default `3000`. |
| `META_APP_SECRET` | Required for webhook signature verification. |
| `WHATSAPP_VERIFY_TOKEN` | Required shared token for the webhook verification handshake; choose it yourself. |
| `WHATSAPP_PHONE_NUMBER_ID` | Graph API phone number identifier; reserved for sending integration. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp Business Account identifier; used during account subscription setup. |

An API access token is also needed for direct Graph API calls. It is separate from both the app secret and the webhook verification token. The current server does not read an access token. Temporary tokens must be regenerated when they expire.

## Meta setup

See [the setup guide](docs/meta-setup.md) for the crucial distinction between subscribing to the `messages` field and subscribing the application to the WhatsApp Business Account.

See [the session record](docs/session-record.md) for completed work, observed behavior, deployment details, and remaining scope.

## Data and repository hygiene

The server logs complete webhook payloads, which may contain phone numbers, profile names, message bodies, and media metadata. Treat those logs as private. Keep downloaded files private as well.

`.gitignore` excludes environment files, logs, downloads, browser automation artifacts, and key files. `.env.example` contains placeholders only. Do not paste real tokens or personal conversations into issues, commits, or pull requests.

The prototype has no durable queue, replay protection, persistent deduplication, or automatic data purge. Meta may retry an event; a process interruption can lose unprocessed work. This is a technical demonstration, not a production messaging service.
