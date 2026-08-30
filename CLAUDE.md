# reamaze-mcp-server

## Engineering standards

**Working branch:** `features`. PRs go `features` -> `develop` -> `main`. Never commit to `develop` or `main`.

**Read before you open a PR** — `docs/standards/`:

- **`pre-pr-verification.md`** — predicate, worker/batch selector or guard changes carry execution evidence in the PR body.
- **`test-integrity.md`** — a predicate change needs a test that fails when the predicate is altered.
- **`queue-worker-invariants.md`** — rotation key, unconditional stamp, terminal only on exhausted attempts.

**Stack defaults** — deviations allowed, silent ones are not (record the reason here and in the service registry): the house web stack (`Slashbin-console`), async work via a claim/ack/dead-letter queue worker (`jerky_event_processor/server/worker.ts`), generated schema migrations (`jerky_data_receiver/server/migrate.ts`).
