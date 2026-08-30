# reamaze-mcp-server

A **Node/TypeScript MCP server over Re:amaze** — gives an agent tools to list and read conversations, reply, and work with contacts, notes and templates. A fork of `kennymkchan`'s project, not affiliated with Re:amaze.

> **⚠ ONE SECTION NEEDS THE OWNER.** *Conventions & gotchas* is empty because it can only come from someone who has worked here. Everything else is generated from the registry, the repo contents and the deployment record. Fill the `_TODO_` block and delete this banner.

## Why this exists

Re:amaze is where jerky.com's customer conversations live. Reamaze Rick triages tickets and drafts replies, and this server is how he reaches them — the tool layer, holding the credential so the agent does not.

## Scope boundary

**Belongs here:** MCP tools over the Re:amaze API — conversations, contacts, notes, templates.

**Does NOT belong here:**
- **Rick's persona and playbooks.** What Rick *knows* stays in `jerky_com_marketing:rick-bot/`. What Rick *does* is here.
- **Actions on the customer's account** — cancellations, refunds, subscription changes. Those belong to `jerky_service`, behind its own permissions and audit trail.

That dividing line is stated in `jerky_service/CLAUDE.md` and is the reason this repo stays small.

## As-built stack

Node + TypeScript. `src/`, `tsconfig.json`, build to `build/index.js`. `StdioServerTransport` — no HTTP listener, no Dockerfile, no Railway service.

## Hosting & delivery

| | |
|---|---|
| **Platform** | self-hosted — a **stdio** MCP server |
| **Lifecycle** | spawned per session on the agent host via `.mcp.json` or `claude mcp add reamaze`; runs `node build/index.js`. Nothing runs between sessions |
| **Lane** | `human` — Doug (JerkyDoug) implements. Fork of `kennymkchan` |
| **Working branch** | `features` → `develop` → `main` |

**There is no deploy step, and `build/` must be current.** A change to `src/` that is not rebuilt does nothing — the host runs the compiled output. This is the most likely way a fix here appears to have shipped and hasn't.

## External systems

`reamaze` — **read and write.** Replying to a conversation sends a real message to a real customer. This is not a sandbox; treat every write path as customer-facing.

## Running it locally

```bash
npm install
npm run build
npm start        # speaks MCP over stdio — it will look "hung"; that is correct
```

## Secrets

The Re:amaze API credential comes from the environment the agent host spawns this under. Values live in Doppler (project `jerky-com`); never commit them and never read a dotenv file to inspect them.

_TODO (owner): name the specific variables (brand subdomain, login email, API token) so a missing credential is distinguishable from an API error._

## Conventions & gotchas

_TODO (owner): what has bitten someone here. Candidates worth recording: that Re:amaze renders HTML as literal text so replies must be plain text; the `resolved` filter silently falling back to "all" (documented in `jerky_service`); pagination limits; and how a conversation slug differs from its id._

## Engineering standards

**Working branch:** `features`. PRs go `features` → `develop` → `main`. Never commit to `develop` or `main`.

**Read before you open a PR** — `docs/standards/`:

- **`pre-pr-verification.md`** — predicate, worker/batch selector or guard changes carry execution evidence in the PR body.
- **`test-integrity.md`** — a predicate change needs a test that fails when the predicate is altered.
- **`queue-worker-invariants.md`** — rotation key, unconditional stamp, terminal only on exhausted attempts.
- **`code-standards.md`** — the unified bar for TypeScript, error handling, config, logging, naming, security, performance, testing and observability.

**Stack defaults — deviation recorded:** this is a stdio MCP server, not a web app; the house web stack does not apply. Recorded here and in the service-registry entry.
