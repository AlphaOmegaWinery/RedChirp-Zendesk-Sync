# RedChirp ↔ Zendesk text sync

Brings guest texts from RedChirp into Zendesk messaging, sends agent replies back out through RedChirp on behalf of the agent who wrote them, and keeps assignment and done-state (RedChirp archive = Zendesk solved) in step. Built from the PRD "RedChirp ↔ Zendesk Text Sync".

**Current scoped status:** Public RedChirp message polling, the staff email-mapping job, and phone-map validation are implemented. Private conversation polling and sending/assigning/archiving/unarchiving/notes are **blocked pending the private API contract**. This is not a complete PRD implementation or a production-ready bidirectional sync. `DRY_RUN` still defaults to true.

Read [the scoped implementation and review checklist](docs/IMPLEMENTATION.md) first. It supersedes the original starter's setup/status claims below. The original architecture, schema, queue, handlers, poller, and Zendesk clients are retained; source hashes make the unchanged originals independently verifiable.

## How it works

- **RedChirp → Zendesk:** the service polls RedChirp every 30 seconds in business hours (2 minutes after hours), queues each change, and calls the Zendesk Conversations API (guest texts) or Ticketing API (assignment, solve).
- **Zendesk → RedChirp:** Zendesk sends webhooks to this service (Conversations API for agent replies, a trigger webhook for ticket changes). The service turns each one into a RedChirp API call. RedChirp never receives a webhook.
- **Attribution:** agent replies are matched to the agent's Zendesk comment and sent in RedChirp on behalf of that agent's RedChirp user. Changes made in RedChirp are applied in Zendesk signed in as the person who made them. The RedChirp Sync user only does system actions.
- **No echo loops:** everything the service writes is tagged and recorded in `message_map` / `conversation_map`, so it is never copied back.

## 1. Set up the Replit app

1. Create a new Node.js app in Replit, open the Shell, upload `redchirp-zendesk-sync.zip`, and run `unzip -o redchirp-zendesk-sync.zip -d . && rm redchirp-zendesk-sync.zip`.
2. Open the **Database** tool and add PostgreSQL. Replit sets `DATABASE_URL` for you.
3. Run `npm install` then `npm run migrate`.
4. Press **Run**. Copy the app's public URL into the `PUBLIC_URL` secret.

## 2. Secrets (Replit → Secrets)

| Secret | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Set by Replit's database tool |
| `PUBLIC_URL` | Your app's public URL |
| `DRY_RUN` | `true` until you're ready to write for real |
| `ZENDESK_SUBDOMAIN` | e.g. `alphaomega` |
| `ZENDESK_EMAIL` | The RedChirp Sync user's email |
| `ZENDESK_API_TOKEN` | Admin Center → APIs → API tokens |
| `ZENDESK_WEBHOOK_SECRET` | Signing secret of the Zendesk webhook (step 3c) |
| `ZENDESK_RC_CONVERSATION_FIELD_ID` | ID of the "RedChirp conversation ID" ticket field (step 3a) |
| `ZENDESK_CLOSE_REASON_FIELD_ID` | ID of the "Close reason" ticket field |
| `ZENDESK_CLOSE_REASON_ARCHIVED_VALUE` | Tag of the "Archived in RedChirp" option, default `archived_in_redchirp` |
| `SUNSHINE_APP_ID`, `SUNSHINE_KEY_ID`, `SUNSHINE_SECRET` | Admin Center → APIs → Conversations API → create API key |
| `SUNSHINE_WEBHOOK_SECRET` | Printed by `npm run setup:integration` |
| `TEAMS_WEBHOOK_URL` | Teams channel → Workflows → "Post to a channel when a webhook request is received" |
| `REDCHIRP_BASE_URL`, `REDCHIRP_API_KEY` | From RedChirp. Leave empty to use the mock |
| `DEV_TOKEN` | Optional; protects `/dev/mock-text` |

## 3. Zendesk setup

a. **Ticket fields** (Admin Center → Objects and rules → Tickets → Fields): add a text field "RedChirp conversation ID" and a dropdown "Close reason" with an option whose tag is `archived_in_redchirp`. Put both IDs in Secrets.

b. **Conversations API integration:** with `PUBLIC_URL` and the `SUNSHINE_*` keys set, run `npm run setup:integration` and save the printed secret as `SUNSHINE_WEBHOOK_SECRET`.

c. **Webhook** (Admin Center → Apps and integrations → Webhooks): connect to "Trigger or automation", endpoint `PUBLIC_URL/webhooks/zendesk`, method POST, format JSON. Copy its signing secret into `ZENDESK_WEBHOOK_SECRET`.

d. **Trigger** (Objects and rules → Triggers): conditions *Tags contains at least one of `sms`*, and *any of* Ticket is Created / Assignee Changed / Status Changed. Action: notify the webhook with this body (replace FIELDID with the RedChirp conversation ID field's ID):

```json
{
  "ticket_id": "{{ticket.id}}",
  "status": "{{ticket.status}}",
  "assignee_id": "{{ticket.assignee.id}}",
  "rc_conversation_id": "{{ticket.ticket_field_FIELDID}}",
  "current_user_id": "{{current_user.id}}"
}
```

e. **Make sure no AI agent answers this channel**, so texts go straight to Agent Workspace.

## 4. Map staff (once per person)

Run in the Database tool's SQL runner:

```sql
INSERT INTO user_map (redchirp_user_id, zendesk_user_id, email)
VALUES ('<RedChirp user ID>', <Zendesk user ID>, 'name@aowinery.com');
```

An agent who isn't mapped can't send texts; the service leaves an internal note and alerts Teams.

## 5. Spike (do this first)

1. `npm run spike:messaging` creates a test guest, posts a text, and hands it to Agent Workspace.
2. In Zendesk, check the new ticket has the `sms` tag and the RedChirp conversation ID field filled. If not, adjust `SUNSHINE_SWITCHBOARD_TARGET` or the metadata in `passControl`.
3. Reply to the ticket. Check the service log shows the agent reply webhook.
4. `npm run spike:ticket -- <ticket id>` prints the SLA policy, reply-time metrics, and comment authors. Confirm the SLA applies and your reply is the author.

## 6. Test with the mock

With `DRY_RUN=true`, send a fake guest text and read the log:

```bash
curl -X POST "$PUBLIC_URL/dev/mock-text" -H 'content-type: application/json' \
  -d '{"conversationId":"test-1","phone":"+17075550100","text":"Can I move my tasting to 3pm?"}'
```

Set `DRY_RUN=false` to have it create real Zendesk conversations while RedChirp stays mocked. `GET /health` shows the last poll, queue depth, and failures.

## 7. Deploy

Deploy as a **Reserved VM** (always on). Autoscale shuts down when idle and would stop polling. Use the production database for the deployed app, and keep daily backups.

## What's left

- Wire `src/redchirp/http.ts` to the RedChirp API (list changes since a cursor, send on behalf of a user, assign, archive, unarchive) once the OpenAPI spec is in hand.
- Nightly reconciliation job (PRD T11).
- Images and pay-by-text events (PRD R9).
