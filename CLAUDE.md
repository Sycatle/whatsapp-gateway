# whatsapp-handler

WhatsApp Cloud API webhook receiver and sender. Node 22, TypeScript ESM, zero runtime dependencies, no database.

## Commands

- `npm start` / `npm run dev` : run with `.env` (dev reloads on change)
- `npm run check` : type-check, also flags unused code (there is no linter)
- `npm test` : `node:test` via tsx, no network (Graph API is mocked)

Done = `npm run check && npm test` green.

## Code map (`src/`)

- `index.ts` : entrypoint, listens on 127.0.0.1, graceful shutdown
- `config.ts` : env parsing; `graph` is set only when `WHATSAPP_ACCESS_TOKEN` is
- `server.ts` : routing table; `protectedRoute` enforces 503 (not configured) and 401 (bad `API_KEY`)
- `webhook.ts` : handshake and signed event reception; `events.ts` parsing, masking, dedup
- `messages.ts` : `POST /messages`, `POST /media`; `graph.ts` : Graph API client; `media.ts` : inbound media to disk
- `auth.ts` : constant-time comparisons; `http.ts` : body reading with size limit

## Pitfalls

- The tunnel exposes every route publicly; sending routes must stay behind `API_KEY`.
- Signature is checked on the raw body before any parsing. Never parse first.
- Never log message content or full phone numbers; `events.ts` masks them.
- Free-form messages only work within 24 h of the user's last message.
- Voice notes must be mono Ogg/Opus; the play button needs a file of 512 KB or less.
- Webhook needs both the `messages` field subscription and the app subscribed to the WABA (`docs/meta-setup.md`).
- Dedup is in memory only: a restart forgets it.
