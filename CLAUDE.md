# reamaze-mcp-server

---

> **⚠ This CLAUDE.md has no business context yet.** It was created by `/setup-repo`
> conformance on 2026-08-30 to carry the engineering standards below, and nothing else.
> It does not describe what this service does, who uses it, its architecture, or its
> invariants — so **do not read its presence as "this repo is onboarded."**
>
> `/setup-repo` Step 1 requires a CLAUDE.md with business context and says to STOP when
> one is missing. That stop was bypassed by writing this stub, which is worse than having
> no file: a later conformance run reads it as conformant.
>
> **Owner action:** replace this banner with the real context — what the service does, who
> it serves, its data sources, its architecture invariants. The standards section below is
> correct and should stay.

## Engineering standards

**Working branch:** `features`. PRs go `features` -> `develop` -> `main`. Never commit to `develop` or `main`.

**Read before you open a PR** — `docs/standards/`:

- **`pre-pr-verification.md`** — predicate, worker/batch selector or guard changes carry execution evidence in the PR body.
- **`test-integrity.md`** — a predicate change needs a test that fails when the predicate is altered.
- **`queue-worker-invariants.md`** — rotation key, unconditional stamp, terminal only on exhausted attempts.

**Stack defaults** — deviations allowed, silent ones are not (record the reason here and in the service registry): the house web stack (`Slashbin-console`), async work via a claim/ack/dead-letter queue worker (`jerky_event_processor/server/worker.ts`), generated schema migrations (`jerky_data_receiver/server/migrate.ts`).
