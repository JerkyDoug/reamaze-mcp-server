---
description: Act on review feedback for ONE PR — read every comment including inline, fix in severity order, verify, and push
---

# Revise PR Feedback

When told "revise PR &lt;number&gt;" or "address the review on &lt;number&gt;".

**Argument:** a PR number or URL. If none was given, ask which PR.

## Phase 0: Read the feedback — all of it

1. Review-level comments and verdicts:
   ```
   gh pr view <number> --comments --json comments,reviews
   ```
2. **Inline, line-anchored comments — these are where the findings actually are:**
   ```
   gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[] | {path, line, body}'
   ```
   A review that reads "one blocker" in its body usually carries the detail inline. Skipping this step is how a revision addresses the summary and misses the finding.
3. Categorise each finding by severity (S1, S2, S3, S4) as the reviewer stated it.
4. Build a checklist. Every finding gets an outcome — fixed, or answered with a reason.

## Phase 1: Fix, in severity order

1. Check out the PR's head branch and pull.
2. If the pull conflicts, STOP and report. Do not auto-resolve.
3. Work S1 first, then S2, then S3, then S4.
4. **Never modify a test to make code pass.**
5. **A finding you disagree with is answered, not silently ignored.** Reply on that inline comment with the reason. An unanswered finding reads as missed.

## Phase 2: Validate — the same bar as the original implementation

1. Build / typecheck / tests must pass.
2. **If a fix changed a query predicate, the test-integrity rule applies to the fix too** — `docs/standards/test-integrity.md`. This is the most common place it is forgotten: the original change was covered, the revision was not.
3. **If a fix touched a predicate, a worker selector, or a guard, it needs execution evidence** — `docs/standards/pre-pr-verification.md`. Re-run it; do not carry the original evidence forward, because the code has changed.
4. Scope checkpoint: `git diff` against the pre-revision head. Every change maps to a review finding. A revision is not an opportunity to fix something else you noticed.

## Phase 3: Push and signal

1. Stage specific files, never `git add .` or `git add -A`.
2. Commit: `fix: address review feedback (#<PR-number>)`. Multiple commits are fine if the fixes are logically separate.
3. Push. Never `--force`, never `--no-verify`.
4. Comment on the PR with the checklist: each finding, what you did, and where. For anything you did not change, the reason.

## Rules

- One PR per invocation.
- Never modify tests to make code pass.
- Never force-push a branch under review — the reviewer's line anchors are how the findings are addressed.
- A revision addresses the review. It does not expand scope.
