# Unified Code Standards

These standards apply to **all 5 slashbin.io repos** (Console, Gateway, Worker, Docs) and **all consulting repos** (CMNEB, jerky.com). The Foreman's Review phase enforces these on every PR review.

---

## Review Priority Order

Every PR is evaluated in this order. If a higher-priority check fails, it must be resolved before lower-priority checks matter.

| Priority | Area | Question |
|---|---|---|
| **1** | Business Objectives | Does this code accomplish what the issue asked for? |
| **2** | Algorithmic Complexity | Is the code O(n) or better? If higher, it must be fixed. |
| **3** | Code Standards | Does the code follow the standards below? |

---

## 1. TypeScript

| Rule | Severity |
|---|---|
| Strict mode enabled — no `// @ts-ignore`, no `// @ts-nocheck` | S2 |
| No `any` type without inline justification comment | S3 |
| Named exports over default exports | S4 |
| Unused imports removed | S4 |
| No `as` type assertions when a type guard or narrowing works | S3 |

---

## 2. Error Handling

| Rule | Severity |
|---|---|
| All async operations wrapped in try/catch with structured error logging | S2 |
| Never swallow errors — every catch block must log or re-throw | S2 |
| External service calls (Redis, Postgres, HTTP) have timeouts | S2 |
| Retry logic has backoff and max-retry limits — no infinite loops | S2 |
| HTTP status codes are semantically correct (4xx client error, 5xx server error) | S3 |
| Error messages include enough context for debugging without leaking secrets | S3 |

---

## 3. Environment Variables & Config

| Rule | Severity |
|---|---|
| All env vars accessed through a centralized config module, not scattered `process.env` | S3 |
| Required env vars validated at startup — fail fast, not at runtime | S2 |
| No hardcoded secrets, API keys, or credentials in code | S1 |
| No secrets logged at info level or above | S1 |
| Magic strings extracted to named constants | S3 |

---

## 4. Logging

| Rule | Severity |
|---|---|
| Use the project's structured logger (Pino for Gateway/Worker, Winston for Console) — no bare `console.log` in production code | S3 |
| Log entries include relevant context fields (projectId, jobId, userId) as structured data, not interpolated strings | S3 |
| Error logs include the full error object, not just `error.message` | S3 |
| No sensitive data in logs (secrets, auth tokens, full request bodies with credentials) | S1 |

---

## 5. Naming & Structure

| Rule | Severity |
|---|---|
| Functions are focused — single responsibility, <50 lines preferred | S4 |
| Variable and function names are descriptive and consistent with existing codebase conventions | S4 |
| No dead code or commented-out blocks | S4 |
| Import ordering: node builtins → external packages → internal modules → relative imports | S4 |
| File organization follows the existing project structure — don't invent new directories without justification | S4 |

---

## 6. Security

| Rule | Severity |
|---|---|
| No `eval()`, `Function()`, or dynamic code execution on user input | S1 |
| SQL queries use parameterized queries via Drizzle ORM — no string concatenation | S1 |
| Input validation on all user-supplied data (request bodies, URL params, headers) | S2 |
| HMAC signature verification not weakened or bypassed | S1 |
| Sensitive headers redacted before storage (`authorization`, `cookie`, etc.) | S2 |
| CORS configuration not overly permissive | S3 |

---

## 7. Performance

| Rule | Severity |
|---|---|
| No O(n^2) or worse algorithms without explicit justification and bounded input proof | S2 |
| No N+1 query patterns | S2 |
| No blocking I/O on hot paths (especially Gateway ingest) | S2 |
| Database queries use appropriate indexes | S3 |
| No synchronous `JSON.stringify`/`JSON.parse` on large objects in hot paths | S4 |
| Redis operations pipelined where possible | S3 |
| Connection pool sizing appropriate for deployment context | S3 |

---

## 8. Testing

| Rule | Severity |
|---|---|
| New behavior has corresponding test coverage | S3 |
| Tests are deterministic — no time-dependent, no external service calls | S3 |
| Contract tests updated when cross-service interfaces change | S2 |
| Edge cases covered (empty payloads, missing fields, invalid types) | S3 |
| Test fixtures use realistic data shapes | S4 |

---

## 9. Observability

| Rule | Severity |
|---|---|
| New code paths have structured logging with relevant context | S3 |
| OpenTelemetry spans created for new pipeline operations (Gateway, Worker) | S3 |
| Health check endpoints reflect new dependency health | S3 |
| Error paths log sufficient context for debugging | S3 |

---

## Service-Specific Additions

These rules extend the shared standards for specific repos.

### Gateway
- Ingest path must have no blocking I/O before ACK
- Queue push must succeed before sending 200 response
- Config cache changes must not serve stale config

### Worker
- Destination fault isolation: a downed destination must **never** degrade other destinations (S1 HARD RULE)
- Pipeline must maintain at-least-once processing — no silent data loss
- All three webhook data models (event, transaction, time-series) considered for dispatch/recovery changes
- Migrations must be additive — no destructive renames or type changes (Console reads Worker tables)

### Console
- Every symbol in `client/` files must be imported or locally defined — undefined references crash the entire UI (S1)
- `npm run build` must pass clean — verify, don't trust
- Redis config schema changes coordinated with Gateway + Worker consumers
- Transform preview must produce identical results to Worker execution

### Docs Site
- No service-specific code standards — standard web content rules apply
- Links must resolve, images must load, navigation must work

### Consulting Repos (CMNEB, jerky.com)
- Follow the same shared standards above
- Additional repo-specific conventions defined in each repo's CLAUDE.md
