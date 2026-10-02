# whatsapp-handler

Minimal WhatsApp Cloud API webhook receiver in TypeScript. No runtime dependencies, no database.

It verifies the Meta handshake, authenticates events with `X-Hub-Signature-256` over the raw body, and logs them.

## Run

Requires Node.js 22+ and a Meta app with the WhatsApp use case ([setup](docs/meta-setup.md)).

```bash
npm ci
cp .env.example .env && chmod 600 .env   # then fill it in
npm run dev
npm run check                            # type-check
npm test                                 # node:test, no extra dependency
```

The server listens on `127.0.0.1` only; expose it to Meta through an HTTPS tunnel.

## Routes

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | `{"ok":true}` |
| GET | `/webhook` | Meta verification handshake. |
| POST | `/webhook` | Checks the signature (403 if invalid), acknowledges, logs. Bodies over 1 MiB get 413. |

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listening port, default `3000`. |
| `META_APP_SECRET` | Required. Signature verification. |
| `WHATSAPP_VERIFY_TOKEN` | Required. Shared secret for the handshake; choose it yourself. |

## Limits

Events are not persisted or deduplicated: a crash loses unprocessed work, and Meta may retry deliveries. Logs and downloaded files can contain personal data; keep them private.
