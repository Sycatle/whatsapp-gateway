# Meta setup

## App and test number

1. Create a developer app and pick **Connect with customers through WhatsApp**.
2. In **API Setup**, claim a test number and add a recipient (WhatsApp verification code).
3. Generate an access token with `whatsapp_business_management` and `whatsapp_business_messaging`. The dashboard token expires after 24 hours: for lasting use, create a system user in Business Settings, assign it the app and the WhatsApp account, and generate a token with no expiry.

The test number is the sender; the verified phone is the recipient. This does not migrate an existing WhatsApp Business app number.

## Webhook

Expose the server over HTTPS. For a quick test:

```bash
cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
```

For anything lasting, use a named tunnel on a domain you control (`cloudflared tunnel create`, then route a hostname to `http://127.0.0.1:3000`): its URL never changes.

In **Configure Webhooks**, set the callback URL to `https://<host>/webhook` and the verify token to `WHATSAPP_VERIFY_TOKEN`. Quick tunnel URLs change on each start; update Meta when they do.

## Two subscriptions are required

1. Subscribe the webhook to the `messages` field (incoming messages, edits, deletions and delivery statuses). Add `smb_message_echoes`, `history`, `smb_app_state_sync` and `account_update` for coexistence (below). Template status, quality and call fields are forwarded untouched, subscribe to them if you want them.
2. Subscribe the **app to the WhatsApp Business Account**. The field subscription alone delivered no real messages.

```bash
H="Authorization: Bearer $WHATSAPP_ACCESS_TOKEN"
U="https://graph.facebook.com/v25.0/$WABA_ID/subscribed_apps"
curl --fail-with-body -H "$H" "$U"            # your app must be listed
curl --fail-with-body -X POST -H "$H" "$U"    # subscribe it if not
```

A permissions error means the wrong app token, missing scopes, or the wrong WABA.

## Use your own WhatsApp Business number (coexistence)

Meta's "coexistence" lets one number work in the WhatsApp Business app on your phone and through this server at once. Messages are mirrored both ways: what you type in the app reaches `EVENTS_URL` and the store (`source: "app"`), and what the API sends shows in the app.

What it takes (from Meta's documentation, June 2026; not testable with the test number):

- WhatsApp **Business** app 2.24.17 or later on the number.
- Onboarding through **Embedded Signup** with the `whatsapp_business_app_onboarding` feature type, which Meta reserves to Tech Providers and Solution Partners. Your Meta app therefore needs business verification and app review first. Skip phone registration: the number is already registered.
- Within **24 hours** of onboarding, request the sync once (a second try needs a new onboarding):

```bash
S='{"messaging_product":"whatsapp","sync_type":"%s"}'
curl -X POST -H "Authorization: Bearer $API_KEY" -d "$(printf "$S" smb_app_state_sync)" http://127.0.0.1:3000/phone/smb_app_data
curl -X POST -H "Authorization: Bearer $API_KEY" -d "$(printf "$S" history)" http://127.0.0.1:3000/phone/smb_app_data
```

Contacts and up to 180 days of 1:1 history then arrive as webhooks (media of the last 14 days only), land in the store, and show up in `/conversations`. Check the link with `GET /phone?fields=is_on_biz_app,platform_type` (`true` and `CLOUD_API`).

Differences to expect:

- Not supported in coexistence: groups, calls, status, catalog, labels and quick replies, broadcast lists (read-only), disappearing and view-once messages, live location, business profile edits through the API. Linked devices are all unlinked at onboarding (re-link them; WhatsApp for Windows is unsupported).
- Messages sent from the app are free and ignore the 24-hour window; API messages follow it and Cloud API pricing. A user message received just before onboarding opened no window: reply with a template.
- Throughput is fixed at 20 messages per second. Users on an unsupported companion device can reach you without triggering a webhook.
- Disconnecting in the app (Settings, Account, Business Platform) sends an `account_update` with `PARTNER_REMOVED`, which shows up in `changes`.

## Check real delivery

1. Send a sample `messages` event from the dashboard.
2. Send a text from the verified phone to the test number and check the log.
3. Reply through Graph API within the 24-hour customer service window; outside it, only approved templates are allowed.
4. Watch the `sent`, `delivered` and `read` statuses (they can arrive out of order).

The app can stay unpublished for this flow. Meta's warning that unpublished apps only get dashboard test events did not apply to the test number.

## Run as a service

Keep the server (and a named tunnel) alive with systemd user units. `~/.config/systemd/user/whatsapp-handler.service`:

```ini
[Unit]
Description=whatsapp-handler

[Service]
WorkingDirectory=%h/Workspace/whatsapp-handler
ExecStart=/usr/bin/env npm start
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now whatsapp-handler
loginctl enable-linger "$USER"      # keep running after logout and across reboots
journalctl --user -u whatsapp-handler -f
```

If you use `scripts/whisper-server.py`, give it its own unit the same way and add `After=whisper-server.service` to the handler's `[Unit]`.

If `npm` is not on systemd's `PATH` (version managers such as fnm), use the absolute path of `npm` in `ExecStart`. Do the same for `cloudflared` with a second unit.

## Check sending and media

With sending configured, within the 24-hour window:

1. `POST /messages` with a text: you receive it, and the `sent`, `delivered` and `read` statuses show in the log.
2. `POST /media` with a PNG, a PDF (`filename=`), an MP3, and a mono Ogg/Opus file with `voice=true`: each arrives as the right kind of message.
3. Send an image, a voice note and a document to the test number: files appear in `DOWNLOADS_DIR` and the log prints `media saved`.
4. Receiving: send the test number a text, a photo, a voice note, a PDF, a video, a sticker, a location, a reaction, a button tap, a quoted reply, then an edited and a deleted text. Check `GET /conversations/<chat>/messages`: each shows up with its content, files appear in `DOWNLOADS_DIR`, an edit sets `edited`, a deletion clears the content and the file, and voice notes carry `content.transcript` when `TRANSCRIBE_URL` is set.
