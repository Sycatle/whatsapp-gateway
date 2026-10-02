# Meta configuration

## Application and test number

1. Create a developer application and select **Connect with customers through WhatsApp**.
2. Associate the relevant business portfolio.
3. Open **Basic setup → Step 1. Try it out** and claim a test number.
4. Generate an access token granting `whatsapp_business_management` and `whatsapp_business_messaging` for the intended test account.
5. Add a recipient and complete the WhatsApp verification-code flow.

The Meta test number is the API-side number. Your verified phone is the recipient and can send messages back to the test number. Using this test configuration does not migrate your existing WhatsApp Business app number to Cloud API.

## HTTPS tunnel and verification

Run Cloudflare Tunnel separately from the application:

```bash
cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
```

In **Step 2. Production setup → Configure Webhooks**, enter:

- Callback URL: `https://<your-tunnel-host>/webhook`.
- Verify token: the exact value of `WHATSAPP_VERIFY_TOKEN` in `.env`.

Click **Verify and save**. The server logs a successful verification handshake. Quick tunnel URLs change when a new tunnel is created; update Meta accordingly. Both processes must remain running.

## Two subscriptions are necessary

First, subscribe the webhook to the **`messages` field**. This covers incoming messages and outgoing delivery status events.

Second, subscribe **your application to the WhatsApp Business Account (WABA)**. Field subscription alone did not deliver actual messages in this session. The account initially listed only Meta's internal test application.

Using an access token belonging to your application with access to the intended WABA:

```bash
export GRAPH_API_VERSION=v25.0
export WHATSAPP_ACCESS_TOKEN='<your-current-token>'
export WHATSAPP_BUSINESS_ACCOUNT_ID='<your-waba-id>'

curl --fail-with-body \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  "https://graph.facebook.com/$GRAPH_API_VERSION/$WHATSAPP_BUSINESS_ACCOUNT_ID/subscribed_apps"

curl --fail-with-body -X POST \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  "https://graph.facebook.com/$GRAPH_API_VERSION/$WHATSAPP_BUSINESS_ACCOUNT_ID/subscribed_apps"
```

Read the subscriptions again and confirm that your application is present. A permissions error can indicate the wrong application token, missing scopes, or access to the wrong WABA. Do not assume a token already visible in Graph API Explorer belongs to the intended application.

## Validate real delivery

1. Send a sample `messages` event from the Meta dashboard and check the server log.
2. Send a fresh text from the verified recipient to the test number.
3. Check that the webhook contains the expected WABA, phone number ID, and message body.
4. Send a free-form reply through Graph API within the 24-hour customer service window opened by the incoming message.
5. Observe status events on the webhook. Events may arrive out of order.

Free-form messages outside that window require an approved template. Dashboard examples and API availability vary; verify the currently supported Graph API version rather than blindly changing it. This session used Graph API v25.0 and webhook field subscriptions at v26.0.

## Publication and privacy

The dashboard displayed a generic warning that unpublished apps only receive dashboard test webhooks. Nevertheless, real messages and delivery status webhooks worked with the test number while the app remained unpublished, once the WABA subscription was corrected. Publication was not needed for the verified test flow; this does not establish behavior for a production number.

A public privacy policy and deletion instructions were registered in the application settings. Account credentials and verification codes should be entered directly in Meta, not committed to this repository.
