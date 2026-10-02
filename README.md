# whatsapp-handler

WhatsApp Cloud API handler in TypeScript: a signed webhook receiver, a sender for every message type, and a local store of conversations. No runtime dependencies.

- **Receives** every message type, edits, deletions, delivery statuses, history and contacts of a coexistence number, and downloads media.
- **Keeps** messages, contacts and the 24 h window per chat in SQLite, queryable over HTTP.
- **Forwards** each processed event to your own service, signed.
- **Sends** text, media, voice notes, stickers, locations, contacts, buttons and lists, templates, reactions and quoted replies; marks messages read; reaches the rest of the Cloud API through a gateway.

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
| GET | `/conversations` | Chats with last activity and whether the 24 h window is open (`windowOpen`, `windowExpiresAt`). `?limit=`. Requires `Authorization: Bearer $API_KEY`. |
| GET | `/conversations/:chat/messages` | Messages of a chat, newest first. `?limit=` and `?before=<timestamp>` to page. Same auth. |
| DELETE | `/conversations/:chat` | Erases the chat's messages, contact entry and downloaded files. Same auth. |
| GET | `/contacts` | Known contacts (address-book and profile names). Same auth. |
| POST | `/messages` | Sends any message type. Same auth. 503 if sending is not configured. |
| POST | `/read` | `{"message_id":"wamid...","typing":true}`: marks a received message as read (blue ticks) and optionally shows "typing..." until you reply or 25 s pass. Same auth. |
| GET, POST, DELETE | `/phone/*`, `/waba/*` | Gateway to the rest of the Cloud API, see below. Same auth. |
| POST | `/media` | Uploads the body and sends it as image, video, audio, sticker or document. Same auth. |
| GET, DELETE | `/media/:id` | Downloads a media file from Meta by id, or deletes an uploaded one. Same auth. |

`POST /messages` takes JSON: a recipient (`to`: a phone number, digits only in international format, or a business-scoped user id such as `US.1349...`; or `group`), a `type` (default `text`) and the Cloud API object of that type. Optional `reply_to` (a message id) quotes a message.

```bash
curl -X POST http://127.0.0.1:3000/messages \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"to":"33600000000","text":"Hello"}'
```

Other bodies:

```json
{"to":"33600000000","text":"On it","reply_to":"wamid.HBg..."}
{"to":"33600000000","type":"reaction","reaction":{"message_id":"wamid.HBg...","emoji":"👍"}}
{"to":"33600000000","type":"location","location":{"latitude":48.85,"longitude":2.35,"name":"Paris"}}
{"to":"33600000000","type":"template","template":{"name":"hello","language":{"code":"fr"}}}
```

Supported types: `text`, `image`, `audio`, `video`, `document`, `sticker`, `location`, `contacts` (an array), `interactive` (buttons, lists, CTA URL, flows, location request), `template`, `reaction`. Media can reference an uploaded `id` or a public `link`. Sent messages are stored with status `pending` until Meta reports `sent`, `delivered` or `read`.

```bash
curl -X POST "http://127.0.0.1:3000/media?to=33600000000&caption=Hi" \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: image/png' --data-binary @photo.png
```

`POST /media` takes the raw file as body and its MIME type as `Content-Type`. `image/*` is sent as an image (max 5 MiB), `video/*` as a video (16 MiB), `audio/*` as audio (16 MiB), anything else as a document (100 MiB, use `filename=`). `sticker=true` with `image/webp` sends a sticker (500 KB). `caption` applies to images, videos and documents; `reply_to=<message id>` quotes a message. Add `voice=true` with a mono Ogg/Opus file (`Content-Type: audio/ogg`) to send a real voice note; other files are rejected with 400. Meta only shows the play button for voice notes up to 512 KB.

Free-form messages only work within 24 hours of the recipient's last message (see `windowOpen` in `/conversations`); otherwise use a template. Meta's refusals come back as 502 with Meta's error message and code. `group` needs the Groups API (official business account, not available in coexistence).

## Everything else: `/phone` and `/waba`

The Graph API is reachable through two prefixes, with the server's token and Graph's own status and body relayed back. `/phone/<path>` becomes `/<WHATSAPP_PHONE_NUMBER_ID>/<path>` and `/waba/<path>` becomes `/<WHATSAPP_BUSINESS_ACCOUNT_ID>/<path>`. Nothing else of the Graph API is reachable, and `/phone/messages` and `/phone/media` are refused in favor of the typed routes above (they keep the store in sync).

| Need | Call |
| --- | --- |
| Message templates | `GET`, `POST`, `DELETE /waba/message_templates` |
| Business profile | `GET`, `POST /phone/whatsapp_business_profile` |
| Block or unblock a user | `GET`, `POST`, `DELETE /phone/block_users` |
| Phone numbers, quality, coexistence status | `GET /waba/phone_numbers`, `GET /phone?fields=is_on_biz_app,platform_type,quality_rating` |
| Webhook subscription of the app | `GET`, `POST`, `DELETE /waba/subscribed_apps` |
| Coexistence contact and history sync | `POST /phone/smb_app_data` with `{"messaging_product":"whatsapp","sync_type":"smb_app_state_sync"}` then `"history"` |
| Groups | `/phone/groups...` |
| Calls | `POST /phone/calls` |
| QR codes, flows | `/phone/message_qrcodes`, `/waba/flows` |

```bash
curl -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:3000/waba/message_templates?fields=name,status"
```

Paths and bodies are Meta's: see the [Cloud API reference](https://developers.facebook.com/documentation/business-messaging/whatsapp).

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listening port, default `3000`. |
| `META_APP_SECRET` | Required. Signature verification. |
| `WHATSAPP_VERIFY_TOKEN` | Required. Shared secret for the handshake; choose it yourself. |
| `WHATSAPP_ACCESS_TOKEN` | Optional. Enables sending. Temporary tokens expire after 24 h. |
| `WHATSAPP_PHONE_NUMBER_ID` | Required with an access token. Sender number id. |
| `API_KEY` | Bearer key for every route except `/health` and `/webhook` (503 if unset). Required with an access token; choose a long random value. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Optional. Enables the `/waba` gateway. |
| `GRAPH_API_VERSION` | Default `v25.0`. |
| `EVENTS_URL` | Optional. Every processed event is POSTed there as JSON (`messages`, `statuses`, `edits`, `revokes`, `contacts`, `history`, `changes`), retried 3 times on failure. |
| `EVENTS_SECRET` | Required with `EVENTS_URL`. Each POST carries `X-Hub-Signature-256: sha256=<HMAC of the body>` keyed with it, so you verify it exactly like Meta's. |
| `DB_PATH` | SQLite file for messages, statuses and contacts, default `data/handler.db` (created with mode 600). |
| `DOWNLOADS_DIR` | Where received media is saved, default `downloads`. Files are `<media id>.<ext>`, mode 600, capped at 100 MiB, checksum-verified. |

## Not possible through the API

Meta exposes no way to edit or delete a message you sent, to list chats from Meta's side, to read history before the webhook subscription (coexistence history sync aside), to post statuses, or to archive, pin or star chats. Users can edit and delete theirs, and the handler applies that.

## Usernames (BSUID)

WhatsApp users who adopt a username may reach you without a phone number, only with a business-scoped user id. The handler files such a chat under the BSUID, merges it into the phone chat as soon as both are seen together, and `POST /messages` accepts either as `to`.

## Limits

`windowOpen` is computed from stored messages: a chat whose last user message predates the database reports a closed window until the user writes again.

Messages, contacts and delivery statuses are kept in a local SQLite file (`node:sqlite`, experimental in Node 22, no dependency). It and `DOWNLOADS_DIR` hold personal data: keep them private and back them up as such. Message content never goes to the logs, but it does go to `EVENTS_URL`: use HTTPS. History messages stay in the store; only their progress is forwarded. A user deleting a message erases its content and file locally. Retried deliveries are dropped using an in-memory window of recent ids; a crash can still lose an event that was acknowledged but not yet processed.
