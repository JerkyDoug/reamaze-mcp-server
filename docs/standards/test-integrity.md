# Test Integrity

**A test that cannot distinguish the thing you changed does not cover it.**

## The rule

Every change to a query predicate must be covered by a test that **fails when the predicate is altered**. Two proofs satisfy this:

1. An assertion on the **rendered SQL** — `.toSQL()` or the driver's equivalent.
2. Execution against a **real database**.

A mock that records the `where` argument as an opaque object satisfies neither.

## Why the rule is phrased that way

`jerky_service#61` shipped a case-sensitive bulk close that missed 23% of the pending queue. The repo had tests. They passed. From the review:

> The `db` mock records the `where` argument as an opaque object; nothing renders it to SQL or runs it against a row. `eq(customer_email, e)` and `eq(lower(customer_email), e)` are identical to every assertion in the file, including both mutation checks.

Two mutation checks — deliberate attempts to prove the tests could detect a broken predicate — and both passed against the broken code. The blank-address guard was caught, because that one is a plain TypeScript `if`. The case bug lived in SQL semantics the mock never reached.

**The tell:** you can change the predicate to something obviously wrong and the suite stays green.

## Applying it

Before you call a predicate covered, alter it deliberately and run the suite. If it still passes, the test asserts something other than what you changed.

One `.toSQL()` assertion closes the gap permanently, and it is cheaper than the alternative — which in #61's case was a reviewer querying production to discover that the button returned `{closed: 0}` on the ticket the operator was looking at.

## Scope

This is about **predicates**, not coverage percentage. It says nothing about how much of a codebase is tested. It says that the specific thing you changed must be the specific thing a test can see.
