# Scoped implementation and review checklist

## Sources of truth

- Baseline: the user-supplied `redchirp-zendesk-sync` ZIP, imported without rearranging any paths inside it. It lives in `artifacts/redchirp-zendesk-sync/` to isolate it from the pre-existing workspace scaffold.
- Required behavior: the user-supplied PRD, retained as `prd.docx`.
- Public API contract: `redchirp-openapi.json`, retrieved from https://api.swaggerhub.com/apis/RedChirp/RedChirp/1.0.0-oas3.1 on November 12, 2026.
- The user's narrower build scope and explicitly approved resolutions govern this delivery. This does **not** claim to finish all PRD requirements.
- No RedChirp private API contract was supplied. No private endpoint, payload, authentication scheme, or employee impersonation field has been invented.

## Approved resolutions

1. Use the actual public paths `/employee-account` and `/red-chirp-phone-numbers`; underscore names in the Swagger UI fragment are operation identifiers, not URL paths.
2. Public authentication is HTTP Basic with a credential ID and secret, not a guessed bearer token. Keep the secret in `REDCHIRP_API_KEY` and the ID in `REDCHIRP_CREDENTIAL_ID`.
3. Keep private operations explicitly blocked until private documentation is supplied.
4. Store the explicit phone-to-Zendesk-group mapping as JSON in Replit Secrets. Do not add a phone-map table or infer Zendesk groups from RedChirp labels.

## Requirement-to-implementation/test matrix

| Requested item | Implementation | Evidence / limits |
| --- | --- | --- |
| Public message polling | `src/redchirp/http.ts`, `public.ts` | Tests cover the published example, incoming/outgoing fields, Unix milliseconds, E164 endpoints, sorting, fixed time windows, two-minute overlap, stable IDs, pagination, error rejection, and retries. |
| Preserve `RedChirpChange` | Original `src/redchirp/types.ts` unchanged | `verify:baseline`; only `kind: message` events are currently emitted. |
| Private open conversations, assignment and archive detection | **BLOCKED** | Public OpenAPI has no `/api/v1/conversations` contract. No snapshot or fabricated assignment/archive events emitted. |
| Send as employee, assign, archive/unarchive, explanatory notes | **BLOCKED** | Each live write throws an explicit error before sending HTTP; unit test verifies zero requests. The header setting is reserved but deliberately not sent to public endpoints. |
| Staff email-mapping job | `src/staff-mapping.ts`, `src/zendesk/staff-directory.ts`, `scripts/sync-staff.ts` | Reads all employee and Zendesk-user pages, matches exact normalized emails of agents/admins, upserts existing `user_map` atomically, serializes job runs with a transaction advisory lock. Tests cover DRY_RUN, upsert SQL, rollback, inactive staff, ambiguous matches, and existing ID conflicts. |
| Phone-to-group map | `src/redchirp/phone-map.ts`, `scripts/validate-phone-map.ts` | Secret-backed explicit map, checked against the paginated number list and messaging/in-service flags. Tests cover malformed mappings, unknown/disabled numbers, normalization, and duplicate normalized numbers. |
| Replit Secrets settings | `src/config.ts` | No credentials or private header values in code, fixtures, source documentation, or response/error logging. Tests use obviously synthetic credentials. |
| Default DRY_RUN=true | Original expression unchanged | Default asserted by unit test. Mapping job performs reads/planning only in dry run. |
| Original schema, queue, loop prevention, Zendesk clients | Byte-identical originals | `verify:baseline` checks every original file other than the six documented changes. |

**Phone routing boundary:** the mapping is stored and validated, not injected into the untouched sync handlers. Group-routing behavior in PRD R1 has not been completed or verified by this scoped build. The mapping is an input available to future approved routing work, not a claim that tickets are already grouped correctly.

## Setup and commands

Run commands from the repository root:

```sh
pnpm install
pnpm --filter redchirp-zendesk-sync run typecheck
pnpm --filter redchirp-zendesk-sync run test
pnpm --filter redchirp-zendesk-sync run verify:baseline
pnpm --filter redchirp-zendesk-sync run migrate
pnpm --filter redchirp-zendesk-sync run staff:sync
pnpm --filter redchirp-zendesk-sync run phones:validate
```

The managed API workflow runs the imported service directly. `/` redirects to the original `/health` endpoint; webhook URLs remain `/webhooks/conversations` and `/webhooks/zendesk`. Health includes explicit private-API capability blockers. There is no new dashboard, authentication system, or redesigned architecture.

The mapping job is a one-shot operational command, not a new background timer with an invented schedule. Run it for initial setup and again when staff accounts change. It reports counts, never employee emails or IDs. Unmatched accounts are counted and not newly mapped. Existing unmatched mappings are not automatically deleted or deactivated; employee-deletion reconciliation was not requested. Archived/suspended matched accounts are upserted inactive. Ambiguity and unique-ID ownership conflicts abort the transaction rather than silently picking a person.

### Required RedChirp settings

Add these in Replit Secrets; never put them in chat or Git:

| Setting | Meaning |
| --- | --- |
| `REDCHIRP_BASE_URL` | HTTPS origin, normally `https://app.redchirp.com`; optional `/api/v1` suffix supported without duplicating it |
| `REDCHIRP_ORGANIZATION_ID` | Organization UUID |
| `REDCHIRP_CREDENTIAL_ID` | API credential ID / Basic-auth username |
| `REDCHIRP_API_KEY` | API secret / Basic-auth password |
| `REDCHIRP_PRIVATE_API_HEADER` | Reserved `access-private-api` value; unused until the private contract is supplied |
| `REDCHIRP_PHONE_GROUP_MAP` | JSON object: E.164 number keys, positive numeric Zendesk group IDs |

Synthetic mapping-format example (not a real routing choice): `{"+17075550100":123}`.
Only explicitly mapped numbers are validated; omitted RedChirp numbers do not get guessed groups. Actual numbers and Zendesk groups must be supplied by the user.

The staff job also needs the starter's `DATABASE_URL`, `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, and `ZENDESK_API_TOKEN`. The existing Zendesk clients and credential model were explicitly preserved; a connector was not substituted. Default DRY_RUN plans but does not upsert. Set `DRY_RUN=false` only with deliberate operator approval for real writes.

### Polling and safety details

- Initial live polling starts at Unix epoch and follows **all** pages through the fixed poll-start timestamp. No unapproved initial-history cutoff is imposed.
- Later polls start at the previous successful poll-start minus two minutes. Bounds remain fixed across every page. Results are emitted oldest first, with message ID as the deterministic timestamp tie-breaker.
- A complete validated batch is returned before the unchanged poller enqueues anything or advances `sync_cursor`. Duplicate event IDs are handled by the unchanged queue's unique key.
- The cursor is versioned JSON containing only a timestamp. No message text is added to it. Mock integer cursors are intentionally rejected by the live adapter.
- **Mock-to-live transition:** while the service is stopped, the operator must explicitly reset the `redchirp` cursor before the first live poll. This is not done automatically. Resetting to null replays history; the unchanged queue's dedupe applies to previously seen live IDs. Do not reset a live cursor casually.
- Public GETs use a process-wide 100ms request spacing, four bounded attempts for transport/429/5xx failures, Retry-After support (seconds or HTTP date), a 30-second request timeout, and no automatic redirects. Do not run additional replicas without coordinating their aggregate rate limit.
- Pagination cannot send credentials to another origin, organization, or resource. Broken JSON, error envelopes, invalid records, out-of-window timestamps, and pagination loops reject the poll.
- Only `text/plain` is treated as plain text, as shown in the published API example. Non-text MIME types are flagged as system events with no guest-facing text. Images, pay-by-text, long-plain-text/rich-content decoding, and private-state handling remain unimplemented, not silently claimed as supported.
- Phone-map validation checks RedChirp ownership and capabilities, not the existence of the selected Zendesk groups. Live group verification/routing is not claimed.

## Original files changed

Only these six original files differ from the archive:

1. `src/config.ts`: add the approved RedChirp settings.
2. `src/redchirp/http.ts`: implement public messages; retain explicit blocked private writes.
3. `src/redchirp/index.ts`: reject partial live configuration instead of silently choosing the mock.
4. `src/index.ts`: add a root health redirect and disclose blocked capabilities in health output.
5. `package.json`: add tests, baseline verification, and mapping commands; preserve existing dependencies/scripts.
6. `README.md`: correct the starter's status and link this checklist.

All remaining original files must match their ZIP SHA-256 hashes in `baseline-sha256.json`. New helper, job, test, and review files are additions, not replacements for the queue, handlers, or Zendesk clients.

## Outside this delivery / not live-verified

- No live RedChirp/Zendesk credentials have been used. Unit tests use captured public documentation and synthetic HTTP responses; they are not proof of a live integration.
- No outgoing text, live staff upsert, Zendesk ticket creation, SLA measurement, group routing, or archive round trip has been live-tested.
- The PRD's nightly reconciliation (T11), images/payments (R9), Commerce7 matching, merge/follow-up behavior, timestamp conflict resolution, SLA/routing/plan-limit spike, and other inherited starter gaps are not completed by this scope.
- In particular, the original handler **skips** thanks-only messages on solved tickets, whereas PRD R3 says to add them without reopening. The original unarchive handler also skips RedChirp unarchive events. These inherited discrepancies were not silently fixed by changing protected sync handlers.
- Preserving the queue/handlers means their existing retry, loop prevention, and remote-write semantics are inherited, not newly certified as exactly-once. No claim is made that the full outage/duplicate-message PRD acceptance test passes.
- Private blocked writes interact with the starter's unchanged state/loop-prevention bookkeeping. Do **not** enable live bidirectional writes until the private contract and that end-to-end behavior are reviewed.
- Production deployment, production migrations, backup policies, credential authorization, and GitHub push are not performed automatically. Do not publish as a completed sync.

## Private API handoff needed

Supply sanitized documentation or request/response examples for: authentication alongside `access-private-api`; listing/paginating open and recently archived conversations; stable conversation/employee IDs; assignment/archive timestamps and actor IDs; sending as a specified employee; assign/unassign; archive/unarchive; posting explanatory internal notes; write idempotency and error responses. Open-only snapshots alone cannot reliably reveal archived conversations, so that detection contract must be explicit.
