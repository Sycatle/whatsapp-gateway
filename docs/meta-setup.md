# Meta setup

## App and test number

1. Create a developer app and pick **Connect with customers through WhatsApp**.
2. In **API Setup**, claim a test number and add a recipient (WhatsApp verification code).
3. Generate an access token with `whatsapp_business_management` and `whatsapp_business_messaging`.

The test number is the sender; the verified phone is the recipient. This does not migrate an existing WhatsApp Business app number.

## Webhook

Expose the server over HTTPS, for example:

```bash
cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
```

In **Configure Webhooks**, set the callback URL to `https://<host>/webhook` and the verify token to `WHATSAPP_VERIFY_TOKEN`. Quick tunnel URLs change on each start; update Meta when they do.

## Two subscriptions are required

1. Subscribe the webhook to the `messages` field (incoming messages and delivery statuses).
2. Subscribe the **app to the WhatsApp Business Account**. The field subscription alone delivered no real messages.

```bash
H="Authorization: Bearer $WHATSAPP_ACCESS_TOKEN"
U="https://graph.facebook.com/v25.0/$WABA_ID/subscribed_apps"
curl --fail-with-body -H "$H" "$U"            # your app must be listed
curl --fail-with-body -X POST -H "$H" "$U"    # subscribe it if not
```

A permissions error means the wrong app token, missing scopes, or the wrong WABA.

## Check real delivery

1. Send a sample `messages` event from the dashboard.
2. Send a text from the verified phone to the test number and check the log.
3. Reply through Graph API within the 24-hour customer service window; outside it, only approved templates are allowed.
4. Watch the `sent`, `delivered` and `read` statuses (they can arrive out of order).

The app can stay unpublished for this flow. Meta's warning that unpublished apps only get dashboard test events did not apply to the test number.
