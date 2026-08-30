#!/usr/bin/env python3
"""PreToolUse/Bash gate: refuse a PR into a release branch that skips the
integration branch beneath it.

## The incident this exists for (2026-08-12, slashbin-ai-team v2.1.0 / v2.1.1)

`CONTRIBUTING.md` in that repo publishes the flow as `features -> develop ->
main`. The EM shipped two releases the same afternoon by opening
`--base main --head features` — skipping `develop` both times.

Three things followed, none of them noticed at the time:

  1. `develop` fell 10 commits behind and kept describing a state of the code
     that had not been true for three days. Nobody reads a branch to check
     whether it is lying.
  2. An outside contributor (#47) had correctly targeted `develop`, following
     our published instructions. He was merged around, then thanked — which is
     worse than being ignored, because it teaches a contributor that the
     documented process is decorative.
  3. The EM then WROTE THE BYPASS INTO A RUNBOOK as the official procedure,
     the same day, complete with a copy-pasteable
     `gh pr create --base main --head features`. The error stopped being a
     mistake and became the documentation.

## Why a doc could not fix this

The runbook WAS the doc, and it said the wrong thing with total confidence.
A second doc telling the truth would have been one more file to disagree with
the first. The only control that survives a confidently-wrong document is one
that fails the command.

Note the shape of the failure: skipping the middle rung is INVISIBLE at the
moment you do it. The release works. The tests pass. The tag publishes. Every
signal says success, and the only casualty — an integration branch quietly
drifting out of date — is the one thing nobody looks at. Failures that leave
no mark at the time they happen are exactly the ones that need a machine
watching, because a human never gets the feedback that would teach them.

## What it does and does not defend against

Defends against: opening or merging a PR whose base is a release branch and
whose head skips the ladder's integration rung.

Does NOT defend against: someone editing .claude/release-ladder.json, or pushing directly to
`main` where protection allows it. No PreToolUse hook can stop deliberate
circumvention, and claiming otherwise would be false assurance. What it does
is make the honest path the easy one and the shortcut loud.

## Contract

Release ladders are DATA. To add a repo, add an entry — do not reason about
whether "this case is different." That reasoning is what produced the incident.
"""
import json
import re
import sys

# The ladder is declared BY THE REPO, not by a map this file carries. A hardcoded
# per-repo table is what kept this gate off every repo that needed it: a repo not
# listed is silently unguarded, and nobody notices an absent block.
#
# Declaration, in `.claude/release-ladder.json` at the repo root:
#     {"release": "main", "integration": "develop", "feature": "features"}
#
# A repo with no such file is unguarded — the same state it is in today, so
# installing this hook can never make a repo worse.
import json as _json
from pathlib import Path as _Path


def _ladder_for(cwd):
    """(release, integration, feature) from the repo's own declaration, or None."""
    try:
        cfg = _Path(cwd or ".") / ".claude" / "release-ladder.json"
        if not cfg.exists():
            return None
        d = _json.loads(cfg.read_text(encoding="utf-8"))
        return (d["release"], d["integration"], d["feature"])
    except Exception:
        return None  # unreadable declaration -> unguarded, never wedged

SHELL_BREAK = re.compile(r"\|\||&&|[;|\n]")
# Flags whose NEXT token is a value, so a branch name inside a title or body is
# never mistaken for a real --base/--head argument.
VALUE_FLAGS = {
    "-t", "--title", "-b", "--body", "-F", "--body-file", "-a", "--assignee",
    "-l", "--label", "-p", "--project", "-m", "--milestone", "-r", "--reviewer",
    "--subject",
}


def block(msg: str) -> None:
    print(f"[release-ladder] BLOCKED\n\n{msg}", file=sys.stderr)
    sys.exit(2)


def strip_quoted(command: str) -> str:
    """Remove quoted payloads. A PR body that quotes `--base main --head features`
    (this hook's own docs do exactly that) must not trip the gate."""
    out = re.sub(r"'[^']*'", "''", command)
    return re.sub(r'"(?:[^"\\]|\\.)*"', '""', out)


def flag_value(tokens: list[str], *names: str) -> str | None:
    for i, tok in enumerate(tokens):
        for name in names:
            if tok == name and i + 1 < len(tokens):
                return tokens[i + 1]
            if tok.startswith(name + "="):
                return tok.split("=", 1)[1]
    return None


def repo_of(tokens: list[str], cwd: str) -> str | None:
    explicit = flag_value(tokens, "-R", "--repo")
    if explicit:
        return explicit.rstrip("/").split("/")[-1]
    # Fall back to the working directory's name, which is how these repos are
    # cloned. Wrong guesses are harmless: an unknown repo has no ladder.
    return (cwd or "").rstrip("/").split("/")[-1] or None


data = json.load(sys.stdin)
cmd = (data.get("tool_input") or {}).get("command", "") or ""
cwd = data.get("cwd") or ""

for segment in SHELL_BREAK.split(strip_quoted(cmd)):
    if not re.search(r"\bgh\s+pr\s+create\b", segment):
        continue

    tokens = segment.split()
    repo = repo_of(tokens, cwd)
    ladder = _ladder_for(cwd)
    if not ladder:
        continue

    release, integration, work = ladder
    base = flag_value(tokens, "-B", "--base")
    head = flag_value(tokens, "-H", "--head")

    if base != release:
        continue
    # A PR into the release branch may only come from the integration branch.
    if head is None or head == integration:
        continue

    block(
        f"`{head} -> {release}` skips `{integration}` on {repo}.\n\n"
        f"The published flow is `{work} -> {integration} -> {release}`. A release is TWO\n"
        f"promotions, never one — `{integration}` is where a change is integration-exercised\n"
        f"before the world clones it, and outside contributors target it because\n"
        f"CONTRIBUTING.md tells them to.\n\n"
        f"This is the 2026-08-12 incident: v2.1.0 and v2.1.1 both shipped\n"
        f"`{work} -> {release}`. `{integration}` fell 10 commits behind and went on\n"
        f"describing code that had not been true for days, while a contributor who had\n"
        f"correctly targeted it was merged around.\n\n"
        f"Do this instead:\n"
        f"  1. gh pr create --base {integration} --head {head}\n"
        f"  2. exercise it — for the bot harness that means running the fleet on it\n"
        f"  3. gh pr create --base {release} --head {integration}   <- the release PR\n\n"
        f"If you believe this case is genuinely different, say so to the owner FIRST.\n"
        f"Do not resolve it by editing this hook — that reasoning is what caused the\n"
        f"incident."
    )

sys.exit(0)
