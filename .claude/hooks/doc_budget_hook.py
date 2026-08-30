#!/usr/bin/env python3
"""PreToolUse/Edit|Write gate: refuse an edit that pushes a budgeted doc over
its word cap.

WHY THIS EXISTS
---------------
`docs/review-fix-completeness.md` grew monotonically for two months — 1,139 →
1,314 → 1,410 → 1,610 → 1,770 → 1,937 → 2,103 → 2,278 → 2,649 words across
nine revisions. Nothing was ever removed. Every entry was individually earned
(each says "Caught on <repo>#N"), but the file is read on EVERY review, so each
addition is a permanent tax on every future review.

The cost stayed hidden while the checks were only partially applied. On
2026-07-26/27 EM-authored issue volume stepped from 1-9/day to 48 then 91 —
a 10x discontinuity with no matching jump in doc size. The content had not
changed; the *application* had. Two months of accumulated checks went live at
once, and the post-merge acceptance path turned each one into filed work.

A policy that depends on remembering to forget is not a forgetting function —
it becomes the next appended entry. So the damping term is mechanical: you
cannot grow a budgeted file without retiring something from it.

CONTRACT
--------
Fails CLOSED on a real overage, OPEN on anything it cannot evaluate (unreadable
file, unparseable input) — a doc-size gate must never block unrelated work.
"""

import json
import os
import re
import sys

# path (repo-relative) -> word budget.
#
# The cap tracks READ FREQUENCY, not importance — a file read on every turn
# taxes every turn. Numbers are set just above the size at the time of writing
# (2026-07-28), so headroom is small on purpose: the squeeze is the mechanism.
# Budgets are declared BY THE REPO, not by a map this file carries. A hardcoded
# table is what kept this gate off every repo that needed it — and the repos that
# need it most are the ones nobody thought to list: jerky_skuvault_service's
# CLAUDE.md is 9,004 words against a stated thesis that past ~2,500 the rules stop
# being read as rules.
#
# Declaration, in `.claude/doc-budgets.json` at the repo root:
#     {"CLAUDE.md": 2500, "docs/architecture.md": 4000}
#
# A repo that declares no budgets is unguarded — the same state it is in today,
# so installing this hook can never make a repo worse.
import json as _json
import os as _os
from pathlib import Path as _Path


def _load_budgets():
    try:
        cfg = _Path(_os.environ.get("CLAUDE_PROJECT_DIR", ".")) / ".claude" / "doc-budgets.json"
        if not cfg.exists():
            return {}
        d = _json.loads(cfg.read_text(encoding="utf-8"))
        return {str(k): int(v) for k, v in d.items()}
    except Exception:
        return {}  # unreadable declaration -> unguarded, never wedged


BUDGETS = _load_budgets()

# Prose only. A fenced block is usually a command or a log excerpt — evidence,
# not rules — and counting it would push authors toward vaguer prose to stay
# under budget, which is the opposite of the goal.
def count_words(text: str) -> int:
    out, fenced = [], False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if not fenced:
            out.append(line)
    return len(" ".join(out).split())


try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = data.get("tool_name") or ""
ti = data.get("tool_input") or {}

# Bash is a side door. Measured 2026-08-28: a `python3 -c` heredoc rewrote
# review-pr/SKILL.md and added words the Edit arm had just refused three times
# — not deliberately, but the budget was silently absent, which is worse than
# being argued with. The hook cannot simulate an arbitrary shell command, so it
# does not try: it blocks a write it can RECOGNISE as targeting a budgeted file
# and names the path that gets evaluated. Reads are untouched (`wc -w < f`,
# `grep x f > /tmp/o`) — the redirect must point AT the budgeted file to match.
if tool == "Bash":
    cmd = str(ti.get("command") or "")
    if cmd:
        for rel_path in BUDGETS:
            # Match the last TWO segments, not the basename: every skill file
            # on disk is called SKILL.md, so a bare-basename match blocked
            # writes to unbudgeted skills. Keep enough path to be unambiguous,
            # little enough that an absolute or ./-prefixed form still matches.
            parts = rel_path.split("/")
            suffix = "/".join(parts[-2:]) if len(parts) > 1 else parts[-1]
            base = re.escape(suffix)
            tgt = rf"(?:[\w./$-]*/)?{base}"
            # `[^\n|;]` throughout: the path and the write must appear in the
            # SAME expression. Measured 2026-08-28 — a script that read this
            # file on one line and wrote /tmp on another was blocked, because a
            # newline-spanning wildcard let any mention pair with any write.
            # A false block here is not harmless: it is the shape that gets a
            # gate switched off.
            writes = (
                rf">>?\s*[\"']?{tgt}",                     # cat > f / echo >> f
                rf"\btee\b(?:\s+-a)?\s+[\"']?{tgt}",       # tee f
                rf"\bsed\b[^\n|;]*?\s-i\b[^\n|;]*?{tgt}",  # sed -i ... f
                rf"\bperl\b[^\n|;]*?-[a-zA-Z]*i[^\n|;]*?{tgt}",
                rf"{tgt}[\"')\]\s]*\.write_text\(",        # pathlib, same expr
                rf"open\(\s*[\"'][^\"']*{base}[\"']\s*,\s*[\"'][wa]",
            )
            if any(re.search(w, cmd) for w in writes):
                print(
                    f"[doc-budget] BLOCKED — Bash write to {rel_path}\n\n"
                    f"That file carries a {BUDGETS[rel_path]}-word budget, and a shell write\n"
                    "cannot be measured before it lands, so it would bypass the cap\n"
                    "entirely. Use Edit or Write instead — the budget is evaluated\n"
                    "there, and it allows any change that does not grow the file.\n\n"
                    "This is a side door, not a stricter rule: the cap is the control,\n"
                    "and a control with a shell bypass is not a control.",
                    file=sys.stderr,
                )
                sys.exit(2)
    sys.exit(0)

path = ti.get("file_path") or ""
if not path:
    sys.exit(0)

root = os.environ.get("CLAUDE_PROJECT_DIR", ".")
try:
    rel = os.path.relpath(os.path.abspath(path), os.path.abspath(root))
except Exception:
    sys.exit(0)

budget = BUDGETS.get(rel.replace(os.sep, "/"))
if budget is None:
    sys.exit(0)

# Reconstruct what the file WOULD contain after this edit.
if tool == "Write":
    after = ti.get("content") or ""
elif tool in ("Edit", "MultiEdit"):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            after = fh.read()
    except Exception:
        sys.exit(0)  # can't evaluate -> don't block
    edits = ti.get("edits") or [ti]
    for e in edits:
        old, new = e.get("old_string"), e.get("new_string")
        if old is None or new is None:
            sys.exit(0)
        if e.get("replace_all"):
            after = after.replace(old, new)
        else:
            after = after.replace(old, new, 1)
else:
    sys.exit(0)

words = count_words(after)
if words <= budget:
    sys.exit(0)

try:
    with open(path, "r", encoding="utf-8") as fh:
        before = count_words(fh.read())
except Exception:
    before = None

# An edit that shrinks an already-over-budget file is progress, not a violation.
if before is not None and words < before:
    sys.exit(0)

delta = f" (was {before})" if before is not None else ""
print(
    f"[doc-budget] BLOCKED\n\n"
    f"{rel} would be {words} words{delta}; the budget is {budget}.\n\n"
    f"This file is read on every review, so every word is a tax on every\n"
    f"future review. To add a check, retire one — that is the whole point of\n"
    f"the budget, not an obstacle to route around.\n\n"
    f"Options, in order of preference:\n"
    f"  1. PROMOTE a check that keeps firing into a hook, a test, or a type,\n"
    f"     then delete its prose here.\n"
    f"  2. DELETE a check that has not fired since it was added — it is\n"
    f"     speculative.\n"
    f"  3. MOVE the incident narrative to docs/rule-origins.md and leave only\n"
    f"     trigger -> verdict here.\n\n"
    f"Raising the number in .claude/hooks/doc_budget_hook.py is not one of the\n"
    f"options. The cap is the control; editing it removes the control.",
    file=sys.stderr,
)
sys.exit(2)
