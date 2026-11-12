# RedChirp ↔ Zendesk sync

The user-supplied baseline is preserved in [`artifacts/redchirp-zendesk-sync`](artifacts/redchirp-zendesk-sync). Its internal `src/`, `scripts/`, SQL schema, and Zendesk clients have not been restructured.

Start with the [implementation scope and review checklist](artifacts/redchirp-zendesk-sync/docs/IMPLEMENTATION.md). It records the approved resolutions, implemented public API behavior, unchanged originals, tests, and private API blockers. This is a partial, public-API delivery—not a completed or production-verified bidirectional sync.

```sh
pnpm --filter redchirp-zendesk-sync run typecheck
pnpm --filter redchirp-zendesk-sync run test
pnpm --filter redchirp-zendesk-sync run verify:baseline
```
