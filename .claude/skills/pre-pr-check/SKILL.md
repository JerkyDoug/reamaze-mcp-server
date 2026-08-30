---
name: pre-pr-check
description: Run eight mechanical checks over your own change BEFORE opening the PR — each derived from a real defect found here. Run after the code is written and validated, and before `create-pr`. This is an author's checklist, NOT a review; it never approves anything and never substitutes for the reviewer.
argument-hint: "[base-branch, default: develop or main per repo]"
---

# Pre-PR Check

Eight mechanical checks over the change you just wrote. **Every one was derived from a real
changes-requested review on this codebase**, and 55% of the rework in the last two weeks would
not have happened if the author had run them first.

## This is NOT a review — read this before anything else

This skill is a **checklist you run on your own work**. It is not a review, and the two must
never be conflated.

- **It approves nothing.** It cannot mark a change correct, ready, safe, or mergeable. Passing
  every check means *you looked in eight specific places* — nothing more.
- **It does not reduce what the reviewer checks.** The reviewer verifies against the code and
  the live system regardless of what this produced. That is the entire value of the review, and
  anything that erodes it makes the change less safe, not more.
- **It is the author's word, not evidence.** You are the least independent possible source on
  your own change. What you write here is a record of where you looked — it is not proof of
  what you found.
- **Never use the reviewer's vocabulary.** No `APPROVE`, no `S1`/`S2`/`S3` severities, no
  "verified", no "reviewed", no verdicts. Those words mean something specific here and they
  belong to the review, not to this.

Its actual job is narrower and genuinely useful: **catch the cheap defects before a human has to
carry them back to you**, and tell the reviewer where your evidence stops.

**This is not a style pass either.** Nothing here is about naming, formatting, or structure.
Every check is about a defect that shipped-looking code hides.

**The rule for all eight: a check you cannot run is REPORTED, not assumed.**
"Probably fine" is the failure mode this skill exists to remove. Saying *"I could not check X
because Y"* is a fine outcome. Silently skipping it is not.

---

## Phase 0 — Scope the diff

```
git diff <base>...HEAD --stat
git log <base>..HEAD --oneline
```

Hold two lists while you work:
1. **Changed symbols** — every function, guard, constant, field, enum value you touched.
2. **Unverified claims** — anything you asserted but did not execute. This becomes Phase 2 output.

---

## Phase 1 — The eight checks

### 1. Sibling sweep — did you fix ONE instance of a class? *(most common finding)*

For every guard, branch, endpoint, or enum you touched, find its siblings and confirm each got
the same treatment.

**Probes:**
- Changed an auth/ownership guard? `grep -n "<guard-fn>" ` across all routes. List every route
  in the same class. Is each one covered?
- Added a status / enum value? `grep -rn "<the-new-value>"` **and** grep for the predicates that
  enumerate statuses. Every list that names statuses must include yours.
- Changed one branch of an if/else or one arm of a switch? Read the sibling arms in the same function.
- Fixed a bug in one handler? Grep the pattern that caused it — it is usually in two places.

**Fix before opening the PR** if you can name a sibling you did not check.

> Caught as: an auth fix applied to `/api/ranking` while `/api/profile` kept the identical hole ·
> a guard added to the upsell branch but not the reward branch · two new statuses added without
> updating the `PRE_SEND` predicate that enumerates them · an action that re-renders without
> saving while every sibling action saves first.

### 2. Guards fail CLOSED

For every new or changed conditional guard, evaluate the **falsy case** explicitly.

```js
if (x && y !== z) continue;    // fail-OPEN  — x empty ⇒ check skipped entirely
if (!x || y !== z) continue;   // fail-CLOSED — x empty ⇒ blocked
```

**Probe:** for each guard variable, `grep` where it is initialized and assigned. If it can be
`""`, `null`, `undefined`, or `0` — and especially if there is no validation before save — write
out what the guard does in that case.

**Fix before opening the PR** if a falsy value makes the guard skip rather than block.

> Caught as: `rewardVariantId &&` where it needed `!rewardVariantId ||` — one character, and it
> left a "free anything" discount hole open to anyone with a browser console.

### 3. An error is not a "no"

Any read, lookup, or existence check: can a **failure** return the same value as a legitimate
**empty result**?

**Probe:** read the error path of every lookup you added or called.
- `except: return []` / `catch { return null }` where `[]`/`null` also means "not found" ⇒ the
  caller cannot distinguish, and every decision downstream is wrong in one direction.
- A vendor that reports "not found" as `200` with an `Errors` array is **not** an outage.
- Three states minimum: **found**, **confirmed absent**, **could not determine**. The third must
  be distinguishable — raise, or return a distinct value.

**Fix before opening the PR** if "I couldn't tell" is indistinguishable from "it isn't there."

> Caught as: a SkuVault lookup that swallowed every exception and returned `[]` · the same
> lookup treating "SKU not found" as "SkuVault is down", which aborted every new batch before
> anything was created.

### 4. A field name is a claim — find the writer

For every field you read, write, or add: locate the code that assigns it and confirm the value
matches the name.

**Probe:** `grep -rn "<field>"` → read the assignment, not the schema and not the comment.

Two specific traps:
- **A fallback erases the distinction.** `x ?? "email"`, `|| ""`, `|| 0` — once stored, nothing
  separates a real value from the fallback. That is a defect unless a second field records which
  it was.
- **A protected / conditional source may never arrive.** If the field depends on a permission,
  scope, or approval, confirm it is actually present in a real payload before building on it.

**Fix before opening the PR** if you cannot name the line that writes the value.

> Caught as: `channel` populated from the inbox slug rather than the medium (so an SMS renders
> "via support") · `customerType` computed from a protected field the app never receives, so it
> recorded "new" for every order with no way to tell afterward · an empty-string email reaching
> a customer search and returning **another real customer's** orders.

### 5. Don't state what you haven't run

Every factual claim — in a comment, a PR body, a doc table, or a commit message — needs the
command that verified it.

**Probe:** for each claim, name the check.
- *"this is the only caller"* → `grep`
- *"the API returns X"* → call it, at the version the app pins
- *"dev has every var"* → read the config source
- *"this field exists"* → introspect the schema

**Fix before opening the PR** on any claim you inferred from docs, a template, or another file's comment.

> Caught as: a documentation PR whose entire purpose was correcting a table — and whose two new
> correcting sentences were themselves false.

### 6. Exercise the path — compiling is not working

**Probe, by change type:**
- **CI / workflow step** → run it locally the way the workflow does. `npm ci` in a clean tree,
  then invoke the binary. Read the **lockfile**, not `package.json` — `npm ci` obeys the lockfile.
- **External API call** → execute it against the real API **at the version this app pins**, and
  read the response for `warnings` as well as `errors`. A filter that silently degrades returns
  a 200 and the wrong rows.
- **UI affordance** → click each one you added, plus the ones sharing the surface.
- **Queue / retry / timer** → run it. A retry policy with no backoff burns every attempt inside
  one tick and looks identical to a working one in a unit test.

**Fix before opening the PR** if the only evidence is "it builds" or "tests pass."

> Caught as: a deploy workflow with no `shopify` binary after `npm ci` — red on its first run,
> every run · a GraphQL field that does not exist at the pinned API version · a search filter
> Shopify accepted, silently degraded, and returned zero rows from.

### 7. Destructive paths need their marker on every artifact

Anything that deletes, overwrites, cancels, or voids: enumerate **every artifact class** it
touches and confirm each carries the marker that distinguishes a valid target.

**Probe:** for each destructive call, ask *"can this match something a real run produced?"*
If a test artifact and a real artifact are byte-identical in the field being matched, the guard
does not exist for that class.

Also: a **terminal state that leaves the polled set is one-way.** If setting a status removes
the row from the query that would recover it, nothing is watching afterward.

**Deleting a source file is the same check.** Before removing one, grep for importers — including
**build-tool aliases**, which a plain filename grep misses (Vite `@assets`, `@/`, tsconfig `paths`).
A deleted file whose importer still resolves through an alias fails at build or, worse, at runtime
on one route nobody opened.

**Fix before opening the PR** if any artifact class is matched by name/pattern alone with no marker check.

> Caught as: a teardown that deleted live artwork and the live catalog entry, because the
> test-vs-real guard covered products but not filenames or catalog ids · a ticket stamped
> `cancelled` 12 hours before its replacement existed, permanently leaving the polled set.

### 8. Honor the invariants already written in this file, and ship one change

**8a — Read the comments in the code you are changing.** If a comment states a load-bearing
property, confirm your change preserves it. Making an unconditional write conditional is the
usual way this breaks.

> Caught twice: the file said *"stamping the key on EVERY attempt is load-bearing — it guarantees
> the rotation always advances."* Two separate PRs made that write conditional, and the sync went
> blind while still logging success.

**8b — One PR, one change.**

```
git log <base>..HEAD --oneline
```

Every commit must belong to this PR's stated purpose. **Fix before opening the PR** if a commit from another PR is in
the list — especially one still under review. Rebase onto the base branch so the PR contains only
its own work.

> Caught as: a one-line Zipify fix whose branch also carried a still-blocked security hole from
> another PR, which merging would have shipped to production under an unrelated review.

---

## Phase 1b — Three checks against the issue *(skip if there is no linked issue)*

The eight above are about the **shape of your code**. These three are about **the spec**, and they
are the ones review runs *before* it reads a line of the diff — `docs/review-fix-completeness.md`
calls this the Gate, and a failure there is REQUEST_CHANGES regardless of how good the code is.
An author can pass all eight and still be bounced here, having never been told these existed.

### 9. Every root-cause file the issue names is in your diff

**Probe:** list the files the issue names as root cause. Diff them against
`git diff <base>...HEAD --name-only`.

A missing one is not automatically wrong — the issue may have been mistaken, or the real cause may
sit one layer up. But then the PR body must **say so and say why**. Silence reads as "didn't look."

**Fix before opening the PR** if a named root-cause file is absent from the diff and unexplained.

### 10. Post-deploy is not verification

Clean metrics after a deploy do not prove a fix works. They prove nothing happened that anyone
measured.

**Probe:** ask what would have to be *true and observable* for the fix to have actually run.
- Did the code path execute at all? Find the log line, the row, the counter that only the new path
  writes. Absence of errors is not presence of the fix.
- If the trigger is rare, the quiet window is the expected outcome either way — say that instead
  of reading it as success.

**Fix before opening the PR** if the only evidence a fix works is that nothing broke.

> This is the difference between "deployed" and "working" that `CLAUDE.md` states directly: an
> artifact existing is never proof it functions.

### 11. The runtime precondition holds for the real population, not your sample

If the fix only takes effect when some condition holds at runtime — a flag on, a field populated,
a role granted, a record present — confirm it holds for the rows that matter, not for the one you
tested.

**Probe:** count both sides against real data. *"How many rows does this condition actually hold
for?"* One row proving it works is n=1; the population is the question.

**Fix before opening the PR** if you cannot state what fraction of the affected population the
precondition currently holds for.

> Caught as: a fix gated on a field that was NULL for most of the table, so it changed nothing for
> the population it was written for while working perfectly on the row used to test it.

---

## Phase 2 — Fix, then disclose

### 2a. Fix first

Anything a check turns up, **fix it on the branch and re-run from Phase 0.** Do not carry a known
defect into the PR and describe it. The point of running early is that fixing is cheap here.

### 2b. Then write the disclosure block

This goes in the PR body. It is **a record of where you looked and where your evidence stops** —
deliberately not a verdict, and it must not read like one.

```
## Author's pre-PR check

Ran `pre-pr-check` before opening. This is the author's own checklist — **not a review, and not
evidence.** It records where I looked; it does not establish that the change is correct.

**Checks that applied, and the probe I actually ran:**
- <check name> — <the exact command / query / file read> → <what came back>
- <check name> — <probe> → <result>

**Not applicable:** <checks, and the one-line reason each doesn't apply to this diff>

**Could NOT check — reviewer should start here:**
- <what, and specifically why not>
```

Rules for the block:

- **Report probes and their output, never a pass mark.** `grep -n "requireAuth" server/routes/*
  → 6 routes, all covered` is useful. `PASS` is not — it is a judgment, and judgments here
  belong to the reviewer.
- **If you did not run the probe, it does not go in the "ran" list.** Reasoning about the code is
  not a probe. If you reasoned instead of ran, that belongs under "could NOT check", with what
  you reasoned and why you couldn't confirm it.
- **`Not applicable` is expected and legitimate** — most changes touch three or four of the
  eight, plus Phase 1b when a linked issue exists. Name the reason; "n/a" alone is not a reason.
- **The "could NOT check" list is the most valuable part of this block.** State the limit plainly:
  *"I confirmed the two fields are distinct in the schema. I did not execute the mutation —
  running it would create a live automatic discount on the production store."* That sentence
  saves the reviewer real time and costs you nothing to write honestly.
- **Never write anything that could be read as sign-off.** Not "ready to merge", not "verified",
  not "no issues found", not a severity count. If a sentence would look at home in a review, it
  does not belong here.
- **An empty block is a valid outcome.** If none of the checks applied, say exactly that.

Then hand off to `create-pr`.
