# whatsapp-handler

WhatsApp Cloud API webhook receiver and sender. Node 22, TypeScript ESM, zero runtime dependencies, no database.

## Commands

- `npm start` / `npm run dev` : run with `.env` (dev reloads on change)
- `npm run check` : type-check, also flags unused code (there is no linter)
- `npm test` : `node:test` via tsx, no network (Graph API is mocked)

Done = `npm run check && npm test` green.

## Code map (`src/`)

- `index.ts` : entrypoint, listens on 127.0.0.1, graceful shutdown
- `config.ts` : env parsing; `graph` is set only when `WHATSAPP_ACCESS_TOKEN` is, `events` only with `EVENTS_URL`
- `server.ts` : route table; `protectedRoute` / `sendingRoute` enforce 503 (not configured) and 401 (bad `API_KEY`); `router.ts` matches `:param` and `*`
- `webhook.ts` : handshake and signed reception; `events.ts` normalizes every webhook field (messages, echoes, history, edits, revokes, statuses, contact sync, other fields), masks, dedups
- `pipeline.ts` : after the 200: downloads media (`media.ts`), writes `store.ts` (node:sqlite), forwards via `sink.ts`
- `messages.ts` : `POST /messages`, `/media`, `/read`; `queries.ts` : `/conversations`, `/contacts`; `gateway.ts` : `/phone/*`, `/waba/*`
- `graph.ts` : Graph API client; `auth.ts` : constant-time checks and signing; `http.ts` : body reading with size limit

## Pitfalls

- The tunnel exposes every route publicly; everything but `/health` and `/webhook` must stay behind `API_KEY`.
- Signature is checked on the raw body before any parsing. Never parse first.
- Never log message content or full phone numbers; `events.ts` `describe()` masks them. Content goes only to the store and `EVENTS_URL`.
- The gateway only reaches `<phone id>/*` and `<waba id>/*`; keep segment validation and the `access_token` stripping.
- Free-form messages only work within 24 h of the user's last live message; `store.conversations()` computes it from non-history inbound messages.
- Voice notes must be mono Ogg/Opus; the play button needs a file of 512 KB or less.
- Webhook needs the `messages` field subscription and the app subscribed to the WABA (`docs/meta-setup.md`); coexistence needs more fields.
- Dedup is in memory only; the store ignores duplicate ids, except that a history `media_placeholder` is replaced by the real message.
- Users may be known by BSUID only (`from_user_id`); `store.ts` aliases merge BSUID and phone chats. Send with `recipient` for a BSUID.
- `node:sqlite` is experimental in Node 22 (needs >= 22.13) and returns null-prototype rows: spread them.
