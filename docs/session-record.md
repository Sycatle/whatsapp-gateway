# Prototype session record

## Scope

The goal is technical API validation and a small demonstration, controlled through simple HTTP requests. Planned message types are text, images, voice messages/audio, and documents. No AI or database is part of the scope.

## Completed on 2026-10-02

- Created the Meta application `wa-cloud-prototype` and enabled the WhatsApp use case.
- Claimed a Meta test number and verified a recipient without migrating their existing WhatsApp Business number.
- Authorized access to the specific test WABA and generated temporary access tokens.
- Sent a dashboard template message and confirmed a reply from the recipient.
- Implemented the minimal TypeScript HTTP server, health route, verification handshake, and signed event reception.
- Created a local Cloudflare quick tunnel and registered its webhook URL in Meta.
- Confirmed the `messages` field subscription.
- Received a dashboard sample event with a valid signature.
- Diagnosed missing real events: the application was absent from the WABA's `subscribed_apps` list.
- Registered the application via Graph API and confirmed the updated subscription list.
- Received real incoming texts and sent a real API reply; observed `sent`, `delivered`, and `read` statuses.
- Independently confirmed an additional incoming text sent by the user. Personal message content and identifiers are intentionally excluded from public documentation.

Browser configuration was completed using Chrome DevTools MCP on the existing Meta tab. Earlier Playwright connection instability led to switching tools.

## Privacy page on sycode.fr

Published at <https://sycode.fr/confidentialite-whatsapp.html> and registered in Meta for both the privacy policy and data deletion instructions.

The source lives in the separate `sycode-v1` repository at `public/confidentialite-whatsapp.html`. Its build and all 483 existing tests passed. This file is not part of the WhatsApp repository.

Deployment copied only the new static file into the current site's `dist/client` directory and retained a copy in the VPS checkout's `public` directory. The site was not restarted; DNS, Cloudflare settings, and existing site routes were not changed. The privacy URL and homepage both returned HTTP 200.

**Deployment limitation:** the live file was added to the running container, not to its immutable image. A container recreation from the old image can remove it. Include the source in the site's next normal image build and deployment. The change in the separate website repository has not been committed or pushed as part of this repository's publication.

## Local operations

The setup session used temporary operational files outside the repository:

- `/tmp/opencode/whatsapp-server.log`: private webhook logs.
- `/tmp/opencode/whatsapp-tunnel.log`: tunnel diagnostics and public URL.
- `/tmp/opencode/cloudflared`: downloaded tunnel executable.

The server and tunnel were started as background processes, without a service manager. They are not guaranteed to survive a reboot. Restart using the README commands and register any new tunnel URL with Meta. No real app secret, access token, recipient number, or payload log is needed in this public repository.

## Verification

- `npm run check`: passed.
- Public `/health`: HTTP 200.
- Valid verification token: challenge returned unchanged.
- Valid HMAC signature: HTTP 200.
- Missing signature: HTTP 403.
- Dashboard event: received.
- Actual incoming text: received.
- Actual Graph API text reply: accepted, delivered, and read.

## Remaining work

- Add local HTTP endpoints for sending messages.
- Integrate access token configuration into the application.
- Download received images, audio/voice messages, and documents.
- Upload and send media; separately validate the requirements for a true WhatsApp voice message.
- Exercise each media category end to end.

The app remains unpublished. No production phone number, payment configuration, business verification, or production deployment of the WhatsApp server was completed.
