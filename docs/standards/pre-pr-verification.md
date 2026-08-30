# Pre-PR Verification

**Before you open a PR, three classes of change must carry the evidence that you executed them against real data.** Not that you read the code and believed it. That you ran it and saw the result.

Everything else carries no additional requirement. These three are here because they are what review actually rejects.

## The three classes

### 1. A query predicate

Any change to what a query matches — a `WHERE`, a filter, a comparison, a join condition.

**Evidence:** the predicate run against real data, with its row count. Both the predicate you are replacing and the one you are introducing, so the difference is visible.

### 2. A worker or batch selector

Any change to which rows a background job picks up — the `ORDER BY`, the `LIMIT`, the claim, the candidate set.

**Evidence:** the selector cycled over a representative table, several cycles, showing which rows it returns each time. A single cycle proves nothing; the failures in this class are all about the second and third pass.

### 3. A guard or refusal path

Any change to what gets blocked, skipped, refused or excluded.

**Evidence:** the guard replayed against the state it is meant to refuse, and against the state it must let through. Both directions. A guard that blocks everything passes a one-sided test.

## Why these three

Every one of them ships a defect that **looks correct in the diff** and that no unit test with a mocked dependency can catch. From `jerky_service`, all found by a reviewer who ran the code rather than reading it:

**#61 — a predicate.** `ignoreSender` lowercased the address then compared it to a column that stores raw. Postgres `=` is case-sensitive.

```
what the code does      customer_email = 'donotreply-voicemail@cox.com'   -> closes 0 pending
what the button says    lower(email)   = 'donotreply-voicemail@cox.com'   -> should close 8 pending
```

The biggest noise sender in production. 10 of 43 pending tickets unreachable, 23% of the queue. The diff looks right.

**#38 — a selector.** A batch of 100 with no `ORDER BY`, where `closed_externally` rows stay candidates forever and outnumber the live ones. On a freshly-inserted table the rows appear to rotate, because an updated tuple lands at the end of the heap. That is free-space luck, not a property. After VACUUM reclaims space the scan returns the same 100 rows forever, while the log says `checked 100` every cycle.

**#37 — a guard.** A credential collision check ran before the vendor branch, so a Shopify fault refused a healthy Recharge action and handed the operator a diagnosis about the wrong vendor.

## What counts as evidence

Pasted into the PR body: the command you ran and the literal output. Not a description of what you observed.

A screenshot of a passing test suite is not evidence for these three classes — that is the point of #61, where every assertion in the file passed against both the broken predicate and the correct one.

## What does not count

- "I verified the shape." Paste the shape.
- "The tests pass." See #61.
- A run against a fixture you wrote. The variation lives in the rows you did not think of.
- A single cycle of a selector. See #38.

## Reaching real data safely

Read freely. **Never create in a system whose writes are externally visible** — a SkuVault wave is a picking job on the warehouse floor, a ShipStation label is real money and a real parcel, a Klaviyo send reaches real customers. Check the repo's `depends_on_external` in `docs/service-registry/service-registry.json` before you touch anything.

Dev credentials pointed at a production tenant are still production. jerky.com's dev and prod are separate SkuVault *logins on one account* — a wave created from dev is a real wave on the OKC floor.

If a change cannot be proven without such an action, **say so plainly and stop.** An acknowledged gap is a legitimate deliverable. A fabricated one is not.
