# Queue & Worker Invariants

**If a unit of work does not have to finish inside the request, it goes on a Redis queue and a worker drains it.** Not `setTimeout`, not fire-and-forget in the handler, not a cron that polls a table. The request path enqueues and returns.

Everything below is stated here in full, deliberately. A developer who has to open another repo's docs will not.

## The canonical shape

Reference implementation: `jerky_event_processor/server/worker.ts`.

| Step | Mechanism | Why |
|---|---|---|
| **Claim** | `BLMOVE <queue> <queue>:processing LEFT RIGHT 0` | Atomic and blocking. The item is never in limbo. |
| **Boot reconcile** | On start, re-queue everything left in `:processing` | Recovers items a crashed process was mid-handle on |
| **Ack** | `LREM <queue>:processing 1 <raw>` **after** the handler succeeds | Ack-on-success, never ack-on-receipt |
| **Retry** | `attempts` counter on the envelope, plus backoff, then re-enqueue | At-least-once delivery is the contract |
| **Give up** | Dead-letter queue after `MAX_ATTEMPTS` | Never silently drop; DLQ depth is an SLI |
| **Idempotency** | A key per item, checked by the handler | The queue is at-least-once, so handlers must be safe to re-run |
| **Connection** | The blocking client is a `redis.duplicate()` | A blocked connection cannot serve other commands |

**Use `BLMOVE`, not bare `BRPOP`.** `BRPOP` removes the item before the handler runs — if the process dies mid-handle the work is gone with no trace.

## Three invariants this fleet has broken

Each of these shipped, was caught in review, and cost a round trip. They are not hypothetical and they are not exotic.

### 1. A batch selector needs a rotation key

`jerky_service#38`. A batch of 100 with **no `ORDER BY`**, over a table where terminal rows stay candidates forever and outnumber the live ones. It appears to work: on a freshly-inserted table the updated tuple lands at the end of the heap and the sequential scan advances. That is free-space luck. Once VACUUM reclaims space and updates go HOT-in-place, the scan returns the same rows forever — while the log still says `checked 100`.

**The invariant:** any selector that repeatedly draws from a growing candidate set orders by a key it also writes. And bound the candidate set — a row closed 30 days ago is not coming back.

### 2. The rotation-key stamp is unconditional

`jerky_service#43`. The stamp was moved inside a conditional UPDATE, so rows in their steady state never advanced the key and permanently held the front of the ordering. The counter still incremented, so the log read healthy while the sweep went blind behind them.

**The invariant:** stamp the key on **every attempt**, including failures and no-ops. Log the difference separately if you need to know what changed. Correctness of the ordering must not depend on whether the work found anything to do.

### 3. A terminal state is reached by exhausting attempts, never on first failure

`jerky_service#52`. Any thrown error wrote `enrichment_state: "error"`, and nothing ever reset it. Correct for a genuine refusal; wrong for the failures that dominate in practice — a `429`, a `529`, a connection reset. Worse, the health metric counted only `IS NULL`, so a five-minute bad window would park ~125 rows in `error` while the one signal the module exposed read **0 unclassified**.

**The invariant:** terminal means *tried and kept failing*. Carry an attempt counter, select on `attempts < N`, and set the terminal state only when it is exhausted. **Whatever you park must stay visible** — fold it into the health count or report it alongside. A bad window must never read as a quiet, healthy pass.

## The tell

If you cannot answer *"what happens on the second cycle, and the hundredth?"* about a change to a worker, you have not finished designing it.
