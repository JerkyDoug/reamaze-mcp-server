---
name: clean-code
description: How code is written in this repo — the clean-code standard every change is built and reviewed against. Read before writing code for an issue, and before reviewing a PR.
---

# Clean code in this repo

**Who decides what.** The issue gives the **architecture**: which class owns a rule, which
callers route through it, what is deleted, the seams other services rely on. It does not tell you
how to write the code, and when it shows code, that code is a contract or evidence, not an
instruction. **How the code is written is decided here**, by this standard plus this repo's
`CLAUDE.md`. Where the two disagree, the repo's `CLAUDE.md` wins: it knows this codebase, and it
says why.

Every rule below is judged case by case. Each one names the question to ask. A rule applied
without asking that question is cargo cult, not clean code.

## The order of precedence

1. The issue's **seams and acceptance**: these are fixed, because other services build against them.
2. The issue's **owners and deletions**: the structure is decided. Build it; do not redesign it.
3. This repo's `CLAUDE.md`: its conventions, its patterns, its exceptions, with their reasons.
4. This file.

If the structure the issue decides cannot be built cleanly, say so in the PR with the file:line
evidence. Do not quietly build something else.

## Classes and modules

- **One reason to change.** A class owns one rule, one calculation or one write. *Ask:* if the
  business changed this rule, which file would change? If it is more than one, the rule has no
  owner yet.
- **Duplication is knowledge, not text.** Merge two pieces of code only when they change for the
  **same reason**. Two blocks that look the same but answer to different rules stay apart, because
  merging them couples two rules that will diverge. *Ask:* would a change to one always be a
  change to the other?
- **Depend inward.** Business rules do not import the framework, the database driver or a vendor
  SDK. Those sit behind an adapter the rule calls. *Ask:* could this rule be tested with no
  network and no database?
- **Tell, don't ask.** Give the object that holds the state the job of changing it, rather than
  reading its fields and deciding outside it.
- **Leave the old way gone.** When the issue names a copy to delete, delete it. A second path left
  "for safety" is the duplication the issue exists to remove.

## Functions

- **Small, and doing one thing.** One level of abstraction per function. If you need "and" to
  describe it, it is two functions.
- **Names say intent.** A reader should not need the body to know what a function returns or a
  variable holds. Use the domain's words, as the issue and this repo's `CLAUDE.md` use them.
- **Few arguments; no flag arguments.** A boolean that switches behaviour means two functions.
- **Command or query, not both.** A function either changes state or returns an answer.
- **No surprises.** No hidden side effects. A function named `get` does not write.

## Errors and boundaries

- **Fail loudly, with context.** Throw, or return a typed failure, rather than returning `null`
  for "it went wrong". Never swallow an error to keep a happy path green.
- **Validate at the boundary**, once, where data enters (a request, a webhook, a vendor response,
  a file). Inside, trust the type.
- **Every external write is safe to retry**, or says in its name and its test why it is not.

## Tests

- **Fast, independent, repeatable, self-checking, written with the code.** A test that needs a
  live vendor is not a unit test.
- **Test the behaviour the issue's acceptance names**, through the owner's public surface, not
  its private helpers.
- **A bug fix starts with the failing test.**

## Comments

- Code says **what**. A comment says **why**: the reason a choice was made, the incident behind a
  guard, the constraint the code cannot show. A comment that repeats the code gets deleted.

## Scope

- **Boy-scout rule, inside the files you touch.** Leave them a little cleaner. Do not refactor
  files the issue does not touch: that is a separate issue, and it makes the review unreadable.

---

*Golden source: `slashbin-engineering-manager/.claude/skill-templates/shared/clean-code/SKILL.md`.
Do not hand-edit this copy; the next publish reverts it. A rule that is wrong for this repo goes
in this repo's `CLAUDE.md`, with its reason.*
