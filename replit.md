# RedChirp ↔ Zendesk sync

The supplied sync-service ZIP is the baseline. Required behavior comes from the supplied PRD and RedChirp API contracts, subject to the user's narrower approved scope.

## Run & Operate

- `pnpm --filter redchirp-zendesk-sync run dev` — managed API workflow runs the imported service
- `pnpm --filter redchirp-zendesk-sync run test` — focused unit/contract tests
- `pnpm --filter redchirp-zendesk-sync run verify:baseline` — protected originals must remain byte-identical
- `pnpm --filter redchirp-zendesk-sync run typecheck` — imported service typecheck
- `pnpm --filter redchirp-zendesk-sync run build` — original TypeScript build
- `pnpm --filter redchirp-zendesk-sync run migrate` — original SQL schema, development only unless separately approved
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- The imported service retains its Express 4, `pg`, TypeScript, and `tsx` dependencies.
- The surrounding pnpm workspace and pre-existing scaffold are not a replacement implementation.
- The public vendor OpenAPI contract is retained for review; its permissive response schemas require explicit runtime validation.

## Where things live

- `artifacts/redchirp-zendesk-sync/`: imported baseline; its internal paths are unchanged.
- `artifacts/redchirp-zendesk-sync/docs/IMPLEMENTATION.md`: approved resolutions, traceability, and explicit blockers.
- The API artifact is only a hosting wrapper; it runs the imported package directly.

## Architecture decisions

- The user approved public spec hyphenated paths, Basic-auth credential ID plus secret, and a Secret-backed phone/group JSON map to preserve the database schema.
- Private conversation APIs are undocumented in the supplied public spec; keep them blocked rather than guessing payloads or attribution fields.

## Product

Public RedChirp message polling, a staff email-mapping job, and phone-map validation. Full two-way sync is blocked on the private conversations API contract and live acceptance checks.

## User preferences

- "Use the ZIP as the baseline codebase. Do not rebuild or restructure it."
- "Keep these as they are: DRY_RUN defaults to true, the database schema, the queue and loop prevention, and the Zendesk clients."
- "If anything in the OpenAPI file conflicts with the code or PRD, stop and ask me before changing it."
- No unapproved scope or behavior changes; the user intends an independent GitHub review against the spec.

## Gotchas

- Do not claim the entire PRD is implemented or enable production bidirectional writes while private operations remain blocked.
- Follow the baseline's PostgreSQL migration, not the unrelated scaffold Drizzle schema/push command.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
