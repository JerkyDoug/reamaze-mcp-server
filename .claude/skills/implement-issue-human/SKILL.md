---
description: Implement ONE GitHub issue end to end on this repo's working branch — build to the house standards, verify against real data, and open the PR
---

# Implement Issue

When told "implement issue &lt;number-or-url&gt;". Implements exactly one issue, end to end.

**Argument:** a GitHub issue number or URL. If none was given, ask which issue.

## Phase 0: Sync

1. `git checkout <working branch>` — named in this repo's `CLAUDE.md` under `## Engineering standards`.
2. `git pull --ff-only origin <working branch>`. If it fails (conflict, diverged, network), STOP and report. Do not auto-resolve.
3. Confirm the tree is clean. If it is dirty with unrelated changes, STOP and ask.

## Phase 1: Read the issue

1. `gh issue view <number> --json title,body,labels,state,comments`
2. Read the **whole** body. These issues carry a plan — Grounding Evidence, Required Changes, Acceptance. Treat it as the spec.
3. Read these sections explicitly:
   - **Acceptance** — this is what to implement.
   - **Out of scope** — a hard boundary. Do not implement it even if it is mentioned elsewhere.
   - **References** — informational only. NEVER implement work cited here.
4. If acceptance criteria are genuinely unclear, or the work spans another repo, STOP and report rather than guessing.

## Phase 2: Plan

1. Restate in one or two lines what the issue wants and how you will do it.
2. List the exact files you expect to touch. Scope is whatever the issue names.
3. **Classify the change** — this drives Phase 4:
   - **UI change** — modifies a served frontend file. If a change is both UI and non-UI, treat it as UI.
   - **Non-UI change** — server logic, data, config, tooling, docs. An endpoint the UI calls is still non-UI; verify it with `curl`.

## Phase 3: Implement

**Build within the owning abstraction.** Read this repo's `CLAUDE.md` "Architecture & Invariant Ownership" and the issue's `## Owning abstraction & invariant impact` section. Implement every change to that domain's state **through the owning abstraction named there** — do NOT add a second mechanism for an operation the owner already performs, do NOT mutate the domain's state outside its owner, and do NOT create a transition that holds only because the call sites happen to line up (an emergent invariant is a latent S1; review will REQUEST_CHANGES it). If the issue's spec cannot be implemented this way — the named owner doesn't exist, the issue says "no owner — establish it" but the change you'd have to make is larger/ambiguous than the issue describes, or honoring single-ownership contradicts the spec — **STOP and surface it**: comment on the issue describing the conflict and do NOT ship a call-site patch as a substitute. A patch that "works" by bypassing the owner is a failed implementation, not a shortcut.

**Build to the established patterns, not the nearest example in this repo.** The defaults below already run in production across multiple repos. Reach for them FIRST; this repo's own code is the *second* place to look, because a repo can be drifting. If the issue's `## Existing Patterns to Follow` names a different approach, follow the issue and say why in the PR body.

- **Async / background work → a Redis queue + worker.** The full contract, including the three invariants this fleet has broken, is in `docs/standards/queue-worker-invariants.md`. Read it before touching a worker.
- **A schema change → a GENERATED migration** (`drizzle-kit generate`, which writes both the `.sql` and its journal entry). A hand-written `.sql` with no journal entry is invisible to the migrator and will never run. Never use `drizzle-kit push` as a path to production.
- **A backfill / cleanup → a DATA migration**, hand-written but listed in the `DATA_MIGRATIONS` array and guarded by the `data_migrations` table. A file in `migrations/` that is not in that array does not run.
- **A new UI surface → the standard web stack.** React + Vite + TypeScript, Tailwind + shadcn/ui, wouter, TanStack Query, Express + Passport, Drizzle, Zod, Vitest.

If a default genuinely cannot be followed, **STOP and comment on the issue** explaining the conflict. Do not silently substitute a different mechanism.

Match the surrounding code's style. Keep the diff to the issue's scope — no drive-by refactors.

## Phase 4: Validate — MUST PASS before committing

1. **Build / typecheck / tests.** Run whichever exist: `npm run build`, `npx tsc --noEmit`, `npm test`. All must pass.
2. **Never modify a test to make code pass.** Tests define expected behaviour. If a test is genuinely wrong, that is its own issue.
3. **Test integrity.** If you changed a query predicate, it must be covered by a test that fails when the predicate is altered — `docs/standards/test-integrity.md`. Alter it deliberately and watch the suite go red. If it stays green, the test asserts something other than what you changed.
4. **Scope checkpoint.** Run `git diff --staged` and review every changed file. Each change must map to an acceptance criterion. If a change addresses something outside it — even something related — revert that change and file a separate issue. Do not bundle.
5. **Blast-radius check on contract changes.** If you changed a function's signature, return type, parameter list, or thrown-error shape, grep for callers in this repo. Verify each handles the new contract. If any would break, fix it in the same commit or find a backward-compatible approach.

Then commit on the working branch, staging specific files — never `git add .` or `git add -A`.

Use **`Related to #<N>`** in the PR body, never `Closes #N` or `Fixes #N`. Issues are closed after production verification, not on a dev merge.

## Phase 5: Verify against real data

**A change to a query predicate, a worker or batch selector, or a guard or refusal path must carry execution evidence in the PR body** — `docs/standards/pre-pr-verification.md`. The predicate run with its row count, the selector cycled several times over a representative table, or the guard replayed against both the state it must refuse and the state it must let through. Paste the command and its literal output.

Read freely; **never create in a system whose writes are externally visible.** A SkuVault wave is a picking job on the warehouse floor; a ShipStation label is real money; a Klaviyo send reaches real customers. Dev credentials pointed at a production tenant are still production. If the change cannot be proven without such an action, say so plainly and stop.

### Non-UI change → verify, then open the PR

1. Confirm the module parses and boots.
2. If the issue touches an endpoint or runtime behaviour, smoke it — start the server and `curl` the affected endpoint, or run whatever check the acceptance criteria describe. Stop the server when done.
3. Open the PR to the base branch named in `CLAUDE.md`.

### UI change → hand off to a browser before the PR

1. Start the dev server. If it does not boot, read the output, fix the cause, retry. Do not proceed until it boots.
2. Poll health until ready.
3. Give the reviewer the URL and **wait**:
   > Server is up. Please check it in the browser at &lt;url&gt; — tell me when it looks right.
4. **Do not open the PR yet.**
   - Confirmed → open the PR and report the URL.
   - Problem reported → fix it (back to Phase 3) and re-verify.

## Rules

- One issue per invocation.
- Never modify tests to make code pass.
- Never commit `.env` or secrets.
- Never `--force` push, never `--no-verify` a commit.
- Stage specific files; never `git add .` or `git add -A`.
