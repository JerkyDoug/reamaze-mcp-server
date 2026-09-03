Ship the current branch to dev or prod.

Usage: `/ship dev` or `/ship prod`

`/ship` is the **only** front door for releasing a human-lane repo. It covers the whole
rung — review, PR, merge, deploy, verify — because a release that stops halfway leaves
the branch merged and nobody watching whether it came up. It supersedes `create-pr` and
`create-promotion-pr`: if those still exist in this repo, delete them. Two documented
paths to the same rung is how a branch quietly starts lying about the state of the code.

> ## Repo configuration  (installed for this repo — the ONLY per-repo differences)
>
> | Setting | Value |
> |---|---|
> | `FEATURE` — where work is authored | `features` |
> | `INTEGRATION` — the dev rung | `develop` |
> | `RELEASE` — the prod rung | `main` |
> | `DEPLOY_DEV` | `none` |
> | `URL_DEV` / `HEALTH_DEV` | — / `—` |
> | `DEPLOY_PROD` | `none` |
> | `URL_PROD` / `HEALTH_PROD` | — / `—` |
>
> Railway environment ids (project `jerky-com`): production `2785f0df-47ea-44b6-a50b-9b3686bf89a0` · development `466d95c5-6c08-413f-853a-08dd431a7fe8`
>
> **This repo, specifically:**
>
> - There is no deploy at either rung. This is a **stdio** MCP server (`node build/index.js`, StdioServerTransport) spawned per session on the agent host — no Railway service, no HTTP listener, no URL. Merging IS the release.
> - `npm run build` must succeed before the PR: consumers run the compiled `build/index.js`, so a merge that does not compile ships a server that cannot start, and nothing downstream would catch it.

## Step 1 — Validate the branch

- `/ship dev` → must be on `FEATURE`. On `INTEGRATION` or `RELEASE` → STOP, we never
  author there. On any other branch → STOP; merge it into `FEATURE` first.
- `/ship prod` → must be on `INTEGRATION`. Anywhere else → STOP.

**Never skip a rung.** `FEATURE → INTEGRATION → RELEASE`, always, even for a one-line fix.
`release_ladder_hook.py` fails the command on the prod rung; nothing machine-checks the dev
rung, and that is precisely the one that drifts unnoticed.

## Step 2 — Land the work

Only for `/ship dev`; on `/ship prod` the branch must already be clean.

1. `git status --short` — clean → continue.
2. Dirty → stage **explicit paths** (never `git add -A` or `git add .`) and commit with a
   `type(scope): summary` message. A pre-commit hook that rejects the commit is a STOP,
   not a `--no-verify`.
3. `git push origin <current-branch>`. Rejected as non-fast-forward → STOP and report.
   Never force-push.

## Step 3 — Run `pre-pr-check` — REQUIRED, no exceptions

Invoke the **`pre-pr-check`** skill with the target branch as its base
(`INTEGRATION` for dev, `RELEASE` for prod).

**This is the author checking their own work. It is not a review and it approves nothing.**
Do not describe it as one, here or in the PR body.

- A check finds a defect → fix it, commit, push, run it again. Do **not** open the PR with
  a known defect and a note about it.
- "Could NOT check" entries → keep them; they are meant to reach the PR.
- The skill is missing entirely → STOP. That is a repo setup problem, not a reason to skip.

Keep the disclosure block; Step 5 puts it in the PR body verbatim.

## Step 4 — Review the diff

```bash
git diff origin/<target>...HEAD
```

- **dev** — surface findings as warnings and keep moving.
- **prod** — stop on blockers. Ask before proceeding past warnings. This is the last gate
  before customers see it; nobody downstream is going to catch it for you.

## Step 5 — Open or update the PR

```bash
gh pr list --head $(git branch --show-current) --base <target> --state open --json number,url
```

Existing open PR → reuse it; it already tracks the new pushes. Otherwise:

```bash
gh pr create --base <target> --head $(git branch --show-current) \
  --title "<concise summary>" --body-file /tmp/pr-body.md
```

Body = bullet summary of `git log --oneline origin/<target>..HEAD`, any `Closes #<n>`, then
the `pre-pr-check` disclosure block **verbatim**. Do not edit it into something more
confident and do not add a claim that the change is verified or reviewed.

## Step 6 — Merge

```bash
gh pr merge <number> --squash
```

Delete the branch (`--delete-branch`) only for a topic branch. **Never delete `FEATURE`,
`INTEGRATION` or `RELEASE`** — they are permanent rungs.

## Step 7 — Verify the deploy

Read `DEPLOY_DEV` / `DEPLOY_PROD` for the rung you just shipped. **A merged PR is not a
deploy and a live URL is not a working service** — you have not shipped until you have
exercised the path.

**`railway:<serviceId>@<envId>`**
```bash
until railway service status --json --service <serviceId> --environment <envId> 2>&1 \
  | grep -qE '"status": "(SUCCESS|FAILED)"'; do sleep 10; done
railway service status --json --service <serviceId> --environment <envId>
curl -sf <URL><HEALTH>
```
`FAILED`, or a non-2xx health response → STOP and report the status and the body.

**`gcp-run:<svc>@<region>`**
```bash
gcloud run services describe <svc> --region <region> \
  --format='value(status.latestReadyRevisionName,status.conditions[0].status)'
curl -sf <URL><HEALTH>
```
The ready revision must be the one built from the commit you just merged. A stale revision
serving 200s is the failure this step exists to catch.

**`shopify-theme`** — the Shopify↔GitHub integration syncs `RELEASE` to the live theme on
its own schedule. There is no CLI to poll. Load the storefront and confirm the change is
visibly present. If you cannot confirm it visually, say the deploy is **unverified** — do
not report it as live.

**`pull-on-host`** — merging does **not** deploy. The host pulls on its own cycle. Either
run the repo's healthcheck script against the host, or report plainly that the change is
merged and **not yet running**, and name what has to happen next.

**`none`** — there is no service for this rung (no dev environment, or a stdio MCP server
consumers spawn locally). Merging *is* the release. Say exactly that. Do **not** claim a
deploy, a URL or a health check that does not exist.

## Step 8 — Report

- What was deployed, to which environment, and the commit.
- The live URL and the health-check result — or, where the target is `none` /
  `pull-on-host` / unverified, the plain statement of what did *not* get verified.
- Any review findings you deferred in Step 4.
- Next step: `/ship prod` if this was dev; "you're live" if prod.
