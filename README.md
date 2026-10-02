# whatsapp-handler

Minimal WhatsApp Cloud API webhook receiver in TypeScript. No runtime dependencies, no database.

It verifies the Meta handshake, authenticates events with `X-Hub-Signature-256` over the raw body, and logs a one-line summary per message or status.

## Run

Requires Node.js 22+ and a Meta app with the WhatsApp use case ([setup](docs/meta-setup.md)).

```bash
npm ci
cp .env.example .env && chmod 600 .env   # then fill it in
npm start                                # or `npm run dev` to reload on change
npm run check                            # type-check
npm test                                 # node:test, no extra dependency
```

The server listens on `127.0.0.1` only; expose it to Meta through an HTTPS tunnel.

## Routes

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | `{"ok":true}` |
| GET | `/webhook` | Meta verification handshake. |
| POST | `/webhook` | Checks the signature (403 if invalid), acknowledges, logs one line per item (ids masked, no content). Understands every message type, edits and deletions by users, messages sent from the Business app, history and contact sync (coexistence), and passes other fields (templates, quality, account updates) through. With sending configured, also saves received images, videos, stickers, audio, voice notes and documents to `DOWNLOADS_DIR`. Bodies over 16 MiB get 413. |
| POST | `/messages` | Sends a text. Requires `Authorization: Bearer $API_KEY`. 503 if sending is not configured. |
| POST | `/media` | Uploads the body and sends it as image, audio or document. Same auth. |

```bash
curl -X POST http://127.0.0.1:3000/messages \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"to":"33600000000","text":"Hello"}'
```

```bash
curl -X POST "http://127.0.0.1:3000/media?to=33600000000&caption=Hi" \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: image/png' --data-binary @photo.png
```

`POST /media` takes the raw file as body and its MIME type as `Content-Type`. `image/*` is sent as an image (max 5 MiB), `audio/*` as audio (16 MiB), anything else as a document (100 MiB, use `filename=`). `caption` applies to images and documents. Add `voice=true` with a mono Ogg/Opus file (`Content-Type: audio/ogg`) to send a real voice note; other files are rejected with 400. Meta only shows the play button for voice notes up to 512 KB.

`to` is digits only, in international format. Free-form text only works within 24 hours of the recipient's last message; otherwise Meta rejects it (reported as 502 with Meta's error).

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listening port, default `3000`. |
| `META_APP_SECRET` | Required. Signature verification. |
| `WHATSAPP_VERIFY_TOKEN` | Required. Shared secret for the handshake; choose it yourself. |
| `WHATSAPP_ACCESS_TOKEN` | Optional. Enables sending. Temporary tokens expire after 24 h. |
| `WHATSAPP_PHONE_NUMBER_ID` | Required with an access token. Sender number id. |
| `API_KEY` | Required with an access token. Bearer key for the sending routes; choose a long random value. |
| `GRAPH_API_VERSION` | Default `v25.0`. |
| `EVENTS_URL` | Optional. Every processed event is POSTed there as JSON (`messages`, `statuses`, `edits`, `revokes`, `contacts`, `history`, `changes`), retried 3 times on failure. |
| `EVENTS_SECRET` | Required with `EVENTS_URL`. Each POST carries `X-Hub-Signature-256: sha256=<HMAC of the body>` keyed with it, so you verify it exactly like Meta's. |
| `DB_PATH` | SQLite file for messages, statuses and contacts, default `data/handler.db` (created with mode 600). |
| `DOWNLOADS_DIR` | Where received media is saved, default `downloads`. Files are `<media id>.<ext>`, mode 600, capped at 100 MiB, checksum-verified. |

## Limits

Messages, contacts and delivery statuses are kept in a local SQLite file (`node:sqlite`, experimental in Node 22, no dependency). It and `DOWNLOADS_DIR` hold personal data: keep them private and back them up as such. Message content never goes to the logs, but it does go to `EVENTS_URL`: use HTTPS. History messages stay in the store; only their progress is forwarded. A user deleting a message erases its content and file locally. Retried deliveries are dropped using an in-memory window of recent ids; a crash can still lose an event that was acknowledged but not yet processed.
