#!/usr/bin/env python3
"""
Secret Exposure Gate — PreToolUse hook.

BLOCKS any Bash command that can put a secret VALUE into the transcript.

Why this exists (2026-07-14): the agent ran `set -a; source ./.env` to load
tokens for a Doppler write. Two .env lines had unquoted values; the shell tried
to EXECUTE them and echoed the value back in a `command not found` error —
leaking a live AWS/Amazon SP-API refresh token into the session log. Nothing was
"echoed": the leak came through the shell's own error path.

That is the lesson: a *rule* ("never print secrets") only covers the paths the
agent thinks of. Secrets leak through side doors — shell errors, `set -x`,
value-printing CLIs, a stray `cat`. So the gate is on the COMMAND, not on the
intent, and it deliberately OVER-BLOCKS: there is always a safe alternative
(below), so a false positive costs one redirect while a false negative costs a
rotation.

THE GOVERNING DISTINCTION: THIS GATE BLOCKS READS, NOT WRITES.
--------------------------------------------------------------
A secret leaks when a value is RENDERED — printed, echoed, dumped, quoted back in
an error. Putting a value INTO a store renders nothing, so writing is allowed
wherever the value travels by a path that cannot print it (stdin, never argv —
argv is world-readable in `ps`).

Read this before concluding you are blocked from changing something:

    railway variable list / railway variables   BLOCKED  (prints every value)
    railway variable set KEY --stdin            ALLOWED  (value never rendered)
    doppler secrets                             BLOCKED  (prints a value table)
    doppler secrets --only-names                ALLOWED  (names only)
    doppler secrets set KEY --silent            ALLOWED  (stdin, prints nothing)
    scripts/secrets/credential.mjs <any>        ALLOWED  (prints fingerprints only)

This distinction has been misread at least once (2026-08-08: the EM reported to
the owner that the gate prevented it from setting a Railway feature flag, and
declined to act. It never did — only the read forms are blocked, and the write
form was allowed the whole time). The cost of that misreading is not a leak; it
is the agent refusing work it was always permitted to do, and telling the owner
something false about its own tooling. If you believe this gate blocks a WRITE,
you have almost certainly matched a read pattern by accident — re-read the table
above rather than reporting yourself blocked.

To ASK what a Railway variable is set to — which no shell command may do, because
they all print values — describe it in the engineering-manager repo's credential registry as a
`railway-var` and run `credential.mjs verify <name> <env>`. It reads in-process
and prints a fingerprint, or the plain value for a descriptor declaring
`"secret": false`.

Blocked classes:
  1. Reading a dotenv file (.env, .env.*, *.env, .envrc) — cat, grep, awk, source,
     eval, anything. Shell evaluation and printing are the same risk class and are
     not worth distinguishing. Also blocked: COPYING one elsewhere (cp/mv/rsync/
     scp/tee/dd), because the copy prints nothing and the follow-up read names a
     path that no longer looks like a dotenv.

     Three narrowings, added 2026-08-09 after six false positives in one session
     (see tests/secret_exposure_cases.py for the exact commands):

       a. The read verb and the dotenv path must be in the SAME STATEMENT. They
          used to be matched independently across the whole command, so an
          unrelated `npm test | grep x` armed the rule for a `git add .env.example`
          later on the same line.
       b. `.env.example` and friends are TEMPLATES — committed placeholder files
          that every install guide tells you to copy. Reading one renders nothing;
          if one ever held a real value it is already public, since it is tracked.
          Writing INTO a dotenv stays fine: `cp .env.example .env` is allowed.
       c. An ESCAPED dot is a regex, not a filename. `grep "process\.env" app.js`
          reads source code, not a dotenv — the old pattern blocked grepping any
          file whose CONTENTS mentioned .env, including this hook's own source.

     These narrow the rule to what it was always for. They do not soften it: the
     same commit ADDED the copy/move block, which was a real hole — `cp .env
     /tmp/x && cat /tmp/x` passed the gate before it.
  2. Secret-store commands that print VALUES: `doppler secrets` without
     --only-names, `doppler secrets get/download`, `railway variables` /
     `railway variable list` (the WRITE forms `set`/`delete` stay allowed).
  2b. Reading the Doppler CLI config file (`~/.doppler/.doppler.yaml`, any
     `doppler.yaml`, or a path under a `.doppler/` config dir) — it stores the
     CLI auth token (`dp.ct.*`) in plaintext. Leaked live on 2026-07-25 by a
     `cat ~/.doppler/.doppler.yaml` that was only trying to read the
     path->project map. A normal `doppler <subcommand>` call never names the
     file, so blocking the path costs nothing.
  3. Whole-environment dumps: bare `env`, `printenv`, bare `export`, `export -p`,
     `export $(...)` (empty expansion == bare export), `declare -x`, `set -x`.
  4. Echoing a secret-shaped variable: echo/printf of $*_TOKEN, $*_SECRET,
     $*_KEY, $*_PASSWORD, $*_PW, $*_CREDENTIALS.

Safe alternatives (the agent is told these in the block message):
  - USE a secret without seeing it:  doppler run -p <p> -c <c> --command '...'
  - MOVE .env values into Doppler:   node the engineering-manager repo's env-to-Doppler tool ...
  - CONFIRM a key exists:            doppler secrets -p <p> -c <c> --only-names

Exit codes:  0 allow | 2 block (stderr shown to the model)
Fails OPEN (exit 0) on internal error — a hook bug must not wedge Bash.
"""

import json
import os
import re
import sys

# 1. Any dotenv file reference: .env, ./.env, /path/.env, .env.local, foo.env, .envrc.
# The path is CAPTURED so each token can be judged individually (template vs real).
# A backslash cannot appear in the prefix: `process\.env` and `\.env` are ESCAPED
# DOTS inside a regex, never filenames. Before this exclusion, grepping source code
# for the string ".env" was read as reading a dotenv file — which blocked greps of
# ordinary .js and .py files, including this hook's own source (2026-08-09).
DOTENV_PATH = re.compile(
    r"(?:^|[\s'\"=;|&(<>])([^\s'\";|&()<>\\]*\.env(?:rc|\.[\w.-]+)?)(?=$|[\s'\";|&()<>])"
)
# Committed placeholder files. `.env.example` and friends exist to be read, copied
# and committed — every install guide we ship says `cp .env.example .env` — and by
# construction they hold placeholders, not values. If one ever held a real secret it
# is already public, since these files are tracked. Reading one renders nothing.
DOTENV_TEMPLATE = re.compile(
    r"\.env\.(?:example|examples|sample|samples|template|tmpl|dist|defaults?|template\.\w+)$"
    r"|(?:^|/)(?:example|sample|template)\.env$",
    re.IGNORECASE,
)
# `process.env.FOO` / `import.meta.env.FOO` are CODE, not dotenv files — reading an
# env var in a script is exactly what the safe path (`doppler run -- node x.mjs`)
# tells you to do. Neutralize them before the dotenv check, or every Node snippet
# containing `process.env` gets blocked as if it were `cat .env`.
ENV_OBJECT_ACCESS = re.compile(r"\b(?:process|import\.meta)\.env\b")

# The sanctioned commands that may touch .env — neither ever prints a value.
#   env-to-doppler.mjs   local file -> Doppler (values over stdin)
#   doppler-to-env.mjs   Doppler -> local file (values via `doppler run` env)
SAFE_ENV_HELPER = re.compile(r"scripts/secrets/(env-to-doppler|doppler-to-env)\.mjs")
# Metadata-only .env commands that cannot print a value.
SAFE_ENV_META = re.compile(r"^\s*git\s+check-ignore\b")

# 2. Secret stores that print values.
DOPPLER_VALUES = re.compile(r"\bdoppler\s+secrets\b(?!.*--only-names)")
DOPPLER_SAFE = re.compile(r"\bdoppler\s+(run|setup|configs|projects|me)\b")
DOPPLER_GET = re.compile(r"\bdoppler\s+secrets\s+(get|download)\b")
# The sanctioned WRITE, per docs/runbooks/configure-new-railway-service-env.md:
#   printf '%s' "$v" | doppler secrets set KEY --project p --config c --silent
# Value arrives on stdin (never argv, never stdout) and --silent suppresses the
# echo-back table. Allowed. The inline `set KEY=VALUE` form puts the value in argv
# (visible in `ps`) and is NOT allowed.
DOPPLER_SET_SAFE = re.compile(r"\bdoppler\s+secrets\s+set\b(?=.*--silent)")
DOPPLER_SET_INLINE_VALUE = re.compile(r"\bdoppler\s+secrets\s+set\s+[A-Za-z_][A-Za-z0-9_]*=")
# `doppler secrets notes set` writes a NOTE (documentation), never prints a secret
# value — the only `notes` subcommand is `set`. Without this it trips DOPPLER_VALUES
# (it's `doppler secrets` without --only-names) and secret documentation is impossible.
DOPPLER_NOTES_SAFE = re.compile(r"\bdoppler\s+secrets\s+notes\b")
# `doppler secrets delete` removes a key. The old comment here claimed it "prints
# only names, never a value" — that is FALSE. By default it prints the REMAINING
# secrets as a full name+VALUE table, so an un-silenced delete leaks every other
# secret in the config into the transcript. Require --silent, exactly like
# DOPPLER_SET_SAFE. (Found in the 2026-07-25 audit, issue #239 item 1.)
DOPPLER_DELETE_SAFE = re.compile(r"\bdoppler\s+secrets\s+delete\b(?=.*--silent)")
# Blocks every READ form. Railway CLI v4 RENAMED the plural `railway variables`
# to `railway variable list`, and this pattern only knew the old spelling — so on
# CLI 4.x (4.36.1 here) `railway variable list` printed every secret value and
# sailed straight through the gate. Found 2026-07-16 while configuring
# slashbin_health_api. A CLI rename silently un-did a security control: match the
# ACTION, not one spelling of it.
#
# The sanctioned WRITE path stays allowed: `railway variable set KEY --stdin`
# (singular, via the engineering-manager repo's Doppler-to-Railway sync) — the value goes over
# stdin, never argv, never stdout.
#
#   railway variables            -> BLOCK (legacy read)
#   railway variable list        -> BLOCK (v4 read)
#   railway variable             -> BLOCK (bare: defaults to listing)
#   railway variable set K --stdin -> allow (sanctioned write)
#   railway variable delete K    -> allow (names only, prints no value)
RAILWAY_VARS = re.compile(
    r"\brailway\s+variables\b"                       # legacy plural read
    r"|\brailway\s+variable\s+list\b"                # v4 read
    r"|\brailway\s+variable\s*(?:$|[;|&])"           # bare -> lists
)
# The write/delete forms that cannot print a value.
RAILWAY_VAR_SAFE = re.compile(r"\brailway\s+variable\s+(?:set|delete|help|--help|-h)\b")

# 2b. Doppler CLI config file — stores the auth token (dp.ct.*) in plaintext.
# A legit `doppler <subcommand>` invocation never contains the file path literally,
# so matching the path (any tool: cat/grep/less/strings/source/…) is safe.
DOPPLER_CONFIG_FILE = re.compile(
    r"/\.doppler/"                                    # any path under a .doppler/ dir
    r"|(?:^|[\s'\"=;|&(<>/])\.?doppler\.ya?ml\b"      # .doppler.yaml / doppler.yaml
)

# 2c. MCP client config — stores hosted-bundle BEARER TOKENS in plaintext, under
# `headers.Authorization`. These are not env-var references; they are live values
# sitting in the file. A dump that filters the `env` key still prints them, which
# is how the jerky em_bot and slashbin-ai-knowledge bearers reached a transcript
# on 2026-07-29. Same shape as 2b: match the path, any read tool.
MCP_CONFIG_FILE = re.compile(
    r"(?:^|[\s'\"=;|&(<>/])\.mcp\.json\b"             # .mcp.json (any dir)
    r"|mcp-daemon/config\.json\b"                     # scripts/mcp-daemon/config.json
)

# 2d. API/browser CAPTURES — a saved request/response holding a live cookie jar.
#
# 2026-08-24: the owner saved a Chrome "Copy as fetch" of Whatnot's internal
# orders GraphQL call into attachments/ so we could design an ingest against it.
# `cat` on it put the whole cookie jar in the transcript — including a live
# `__Secure-refresh-token`, which mints access tokens with no password — and the
# remedy was a logout the owner had to perform.
#
# Every existing rule keys on a PATH (.env, .doppler/, .mcp.json). A capture has
# no canonical name or extension; it was `orders_fetch_by_status.txt`. So this
# rule keys on CONTENT instead: read the head of any existing file the statement
# would read, and block if it looks like a credential-bearing capture.
#
# Patterns are VALUE-shaped (a marker plus a long opaque value), so source code
# that merely mentions `cookie` or `Authorization` — including this hook — does
# not trip them.
CAPTURE_CREDENTIALS = re.compile(
    r"__Secure-[\w-]+=[^\s;\"']{16,}"                     # __Secure-* cookie with a value
    r"|__Host-[\w-]+=[^\s;\"']{16,}"                      # __Host-* cookie with a value
    r"|(?i:set-cookie|\bcookie)\"?\s*:\s*\"[^\"]{200,}"   # a header holding a real jar
    r"|(?i:authorization)\"?\s*:\s*\"?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{40,}",
)
# The sanctioned reader: strips every credential and writes `<name>.redacted<ext>`,
# reporting only names and byte lengths. Reading its OUTPUT is always allowed.
SAFE_CAPTURE_TOOL = re.compile(r"scripts/secrets/redact-capture\.mjs")
REDACTED_ARTIFACT = re.compile(r"\.redacted\.[\w.-]+$|\.redacted$")
# Cap the sniff: a capture's credentials sit in the headers, near the top. Reading
# more would make the gate slow on large files for no extra signal.
CAPTURE_SNIFF_BYTES = 262_144


# A command only READS/SOURCES a file if it invokes a read tool. A bare *mention*
# of a path — in a `git commit -m` message, a doc string, an echo of a path — is
# not a read and must not be blocked (over-blocking on the mention wedged two
# legit commits on 2026-07-25). The dotenv (1) and Doppler-config (2b) gates now
# additionally require this to match. Read verbs are anchored to command position
# (start / after a separator / pipe / `$(`), plus POSIX dot-source and the common
# programmatic-read calls — so a read verb sitting inside a quoted message does
# NOT count, while cat/grep/source/awk/open()/readFileSync still do.
READ_CONTEXT = re.compile(
    r"(?:^|[;|&\n]|\|\|?|&&|\$\()\s*(?:sudo\s+|\w+=\S+\s+)*"
    r"(?:cat|tac|zcat|less|more|head|tail|nl|bat|view|grep|egrep|fgrep|rg|ag"
    r"|awk|gawk|sed|cut|strings|xxd|od|hexdump|base64|dd|readlink|realpath|xargs"
    r"|source|eval)\b"
    r"|(?:^|[;|&\n]|\|)\s*\.\s+[^\s;|&/]"            # POSIX dot-source `. file` (not ./x)
    r"|\bopen\s*\(|\breadFileSync\b|\breadFile\b|\.read\(|\bGet-Content\b"
)

# 3. Whole-environment dumps.
#
# 2026-08-28: this rule listed `export -p` but not BARE `export`, and the agent ran
# `export $(grep -o '...' /dev/null)` as a throwaway prefix to a gh call. The
# substitution expanded to nothing, so the shell saw `export` with no operands and
# printed all 162 exported NAME=VALUE pairs — Azure client secret, Conductor API
# key, Stripe and Postgres URLs. Nothing was being read from a dotenv, so no other
# rule applied. The lesson generalises: an operand list that comes from a
# SUBSTITUTION can be empty at runtime, so `export $(...)` is the same command as
# bare `export` whenever the inner command matches nothing. Both are blocked; the
# safe way to load values into a process is `doppler run -- <cmd>`, which never
# renders them.
ENV_DUMP = re.compile(
    r"(^|[;|&]\s*)(env|printenv)\s*($|[;|&])"
    r"|(^|[;|&]\s*)printenv\s+\S"                 # `printenv SECRET` prints that value
    r"|(^|[;|&]\s*)export\s*($|[;|&])"            # bare `export` lists NAME=VALUE for all
    r"|(^|[;|&]\s*)export\s+[$`]"                 # operands from a substitution: may be empty
    r"|\bexport\s+-p\b"
    r"|\b(?:declare|typeset)\s+-x\s*($|[;|&])"    # same dump under another builtin
    r"|\bset\s+-x\b"
)

# 6. Credential CREATION done by hand.
#
# The two ways a brand-new secret leaks, both seen on 2026-08-08:
#   (a) the value is GENERATED at the shell, so it prints before it is ever used;
#   (b) the value is embedded in role DDL, so it lands in argv and in the SQL echo.
# Neither is fixed by "being careful" — the value exists in the transcript the
# instant the command runs. the engineering-manager repo's credential tooling generates in-process,
# hands the value straight to Postgres and Doppler, and reports only a length and
# a short hash. Generation and DDL belong there, not here.
ROLE_PASSWORD_DDL = re.compile(
    r"\b(?:CREATE|ALTER)\s+(?:USER|ROLE)\b[^;]*\bPASSWORD\b", re.IGNORECASE)
SECRET_GENERATOR = re.compile(
    r"\bopenssl\s+rand\b|\bpwgen\b|/dev/u?random\b|\bgpg\s+--gen-random\b", re.IGNORECASE)
# The sanctioned tool — parameterised per customer/service/system, values never printed.
SAFE_CREDENTIAL_TOOL = re.compile(r"scripts/secrets/credential\.mjs")

# 4. Echoing a secret-shaped variable. Suffix list is deliberately greedy:
#    SMTP_PASS slipped an earlier PASSWORD-only pattern. Connection URLs are in
#    here because DATABASE_URL / REDIS_URL embed the password in the DSN.
SECRET_VAR = (
    r"[A-Za-z_][A-Za-z0-9_]*"
    r"(?:TOKEN|SECRET|KEY|PASS|PASSWD|PASSWORD|_PW|PWD|CREDENTIALS?"
    r"|DATABASE_URL|REDIS_URL|PG_URL|_DSN|_URI)"
)
ECHO_SECRET = re.compile(
    r"\b(echo|printf|print|cat)\b[^\n|;&]*\$\{?" + SECRET_VAR, re.IGNORECASE
)

# 5. Process-argv exposure. Long-running services receive connection URLs and
#    API keys AS ARGV — the MCP supergateways are started as
#    `supergateway ... --stdio mcp-server-postgres postgresql://user:PASSWORD@host`
#    so anything that prints a full command line prints live credentials.
#    Categories 1-4 all guard secret *stores*; this is a distinct path that walks
#    straight past them. (2026-07-27: `ps -o args=` over the gateway PIDs put a
#    live Stripe key and seven DB/Redis passwords into a transcript.)
#
#    Blocked: ps showing args/command, pgrep -a, /proc/*/cmdline.
#    Allowed: PID-only and metadata-only forms — `ps -o pid=`, `ps -o rss=`,
#    `ps -p N -o ppid=`, bare `pgrep`, `pgrep -P`, and `ss -ltnp` (which prints
#    the process NAME and pid, never argv — it is the safe port->pid mapping).
PS_ARGS = re.compile(
    r"\bps\b[^\n|;&]*?(?:"
    r"-o\s*[\"']?[^\n|;&]*\b(?:args|cmd|command)\b"   # -o args= / -o cmd= / -o pid,args
    r"|(?:^|\s)-\w*f\w*(?:\s|$)"                      # -f / -ef / -Af  (full format => CMD)
    r"|(?:^|\s)a[ux][a-z]*(?:\s|$)"                   # BSD aux / ax / auxww / axjf => COMMAND
    r")"
)
PGREP_ARGS = re.compile(r"\bpgrep\b[^\n|;&]*(?:^|\s)-\w*a\w*(?:\s|$)")
PROC_CMDLINE = re.compile(r"/proc/[^\s/]+/cmdline")


# Verbs that COPY a file somewhere else. They print nothing, so a read-verb check
# alone waves them through — and the follow-up (`cat /tmp/copy`) names no dotenv at
# all, so nothing downstream catches it either. Copying a real dotenv is the first
# half of exactly the temp-file indirection the block message forbids, so it is
# blocked at the first half, where the intent is still visible.
EXFIL_VERB = re.compile(
    r"(?:^|[;|&\n]|\$\()\s*(?:sudo\s+)?(?:cp|mv|rsync|scp|tee|dd)\b"
)

# Statement separators. Correlation matters: the dotenv rule needs the read verb and
# the dotenv path to be in the SAME statement. Evaluating both over the whole command
# meant an unrelated `| grep` several statements away armed the rule — which is how
# `git add .env.example` came to be blocked by a test run earlier in the same line.
STATEMENT_SPLIT = re.compile(r"\|\||&&|[;|&\n]")


def statements(command: str) -> list:
    """The command's statements, for rules that must correlate two conditions."""
    return [s for s in STATEMENT_SPLIT.split(command) if s.strip()]


def dotenv_tokens(text: str) -> list:
    """Dotenv-looking paths in `text`, with `process.env`-style code neutralised."""
    scanned = ENV_OBJECT_ACCESS.sub("ENVOBJ", text)
    return [m.group(1) for m in DOTENV_PATH.finditer(scanned)]


def real_dotenvs(text: str) -> list:
    """Dotenv paths that could actually hold a live value (templates excluded)."""
    return [t for t in dotenv_tokens(text) if not DOTENV_TEMPLATE.search(t)]


def exfil_sources(statement: str) -> list:
    """Non-destination arguments of a copy/move verb.

    `cp .env.example .env` writes INTO a dotenv, which renders nothing and is the
    documented install step. `cp .env /tmp/x` reads one out. The difference is
    whether a real dotenv appears anywhere other than the final argument.
    """
    parts = statement.split()
    args = [p for p in parts[1:] if not p.startswith("-")]
    return args[:-1] if len(args) > 1 else args


def capture_files(statement: str) -> list:
    """Existing files named in `statement` whose CONTENT looks like a credentialed
    capture. Fails quiet (returns nothing) on anything unreadable — a sniff that
    cannot run must never wedge Bash."""
    hits = []
    for tok in re.split(r"[\s;|&()<>]+", statement):
        tok = tok.strip("\"'")
        # Only plausible file arguments; skip flags and the tool's own name.
        if not tok or tok.startswith("-") or REDACTED_ARTIFACT.search(tok):
            continue
        try:
            if not os.path.isfile(tok):
                continue
            with open(tok, "r", encoding="utf-8", errors="ignore") as fh:
                if CAPTURE_CREDENTIALS.search(fh.read(CAPTURE_SNIFF_BYTES)):
                    hits.append(tok)
        except (OSError, ValueError):
            continue
    return hits


def fail_open(reason: str) -> None:
    sys.stderr.write(f"[secret-exposure-gate] could not evaluate ({reason}); allowing\n")
    sys.exit(0)


def block(what: str) -> None:
    sys.stderr.write(
        "[secret-exposure-gate] BLOCKED\n\n"
        f"{what}\n\n"
        "This command can put a secret VALUE into the transcript. A transcript is a "
        "permanent log — a leaked value means a real rotation for the owner.\n"
        "Do NOT rewrite this command to sneak around the gate (no `bash -c`, no base64, "
        "no temp-file indirection). Use the safe path instead:\n\n"
        "  * USE a secret without seeing it:\n"
        "      doppler run -p <project> -c <config> --command '<cmd that reads $VAR>'\n"
        "  * MOVE .env values into Doppler (parses without shell eval, prints names only):\n"
        "      node the engineering-manager repo's env-to-Doppler tool --project <p> --config <c> \\\n"
        "        --keys KEY_A,KEY_B [--prune]\n"
        "  * CONFIRM a key exists (names, never values):\n"
        "      doppler secrets -p <project> -c <config> --only-names\n"
        "  * CREATE or ROTATE a credential (never generate one at the shell):\n"
        "      node the engineering-manager repo's credential tooling list\n"
        "      node the engineering-manager repo's credential tooling verify    <name> <env>\n"
        "      <admin ctx> -- node scripts/secrets/credential.mjs provision <name> <env> [--dry-run]\n"
        "      <admin ctx> -- node scripts/secrets/credential.mjs rotate    <name> <env> [--dry-run]\n"
        "      node the engineering-manager repo's credential tooling store  <name> <env> --from-env VAR\n"
        "      node the engineering-manager repo's credential tooling sync   <name> <env>\n"
        "    It generates in-process, hands the value straight to the target system and\n"
        "    Doppler, sets the Doppler note, mirrors to Railway, and reports only a length\n"
        "    and a short hash. Credentials are DATA in the engineering-manager repo's credential registry —\n"
        "    add a customer/service/environment there rather than running commands by hand.\n"
        "    <admin ctx> supplies the admin connection WITHOUT putting it in argv, e.g.\n"
        "      railway run --service <svc> --environment <env> --\n"
        "      doppler run -p <proj> -c <cfg> --command '<...>'\n\n"
        "  * THE TOOL DOESN'T COVER YOUR CREDENTIAL TYPE? EXTEND THE TOOL.\n"
        "    If you hit `<verb> not implemented for kind \"<k>\"`, or no `kind` fits what\n"
        "    you need to mint, that is NOT a dead end and NOT a licence to improvise —\n"
        "    it is a missing driver, and adding it IS the task. Add the `kind` to\n"
        "    scripts/secrets/credential.mjs (it already has generate(), dopplerSet(),\n"
        "    dopplerNote() and railwaySync() — a new driver is usually a few lines),\n"
        "    add the descriptor to credentials.json, then run the normal command.\n"
        "    credential.mjs is meant to be THE ONE PLACE secrets are minted, stored,\n"
        "    mirrored and verified. Every credential type that lives outside it is a\n"
        "    future leak, because the next person will reach for the shell instead.\n"
        "    This gate is what forces that consolidation — do not route around it.\n"
        "    (2026-08-19: `provision` was postgres-role only, so minting a plain shared\n"
        "    token had no safe path at all. The fix was a ~40-line `shared-secret`\n"
        "    driver, not a workaround.)\n"
        "  * NEED the value for a human: send it to the destination system directly, "
        "or ask the owner to paste it where it belongs. Never through chat.\n"
    )
    sys.exit(2)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        fail_open("stdin not valid JSON")
        return

    if payload.get("tool_name") != "Bash":
        sys.exit(0)

    command = (payload.get("tool_input") or {}).get("command", "")
    if not isinstance(command, str) or not command.strip():
        sys.exit(0)

    # --- 1. dotenv files -----------------------------------------------------
    # Evaluated PER STATEMENT: the read verb must apply to the dotenv path, not
    # merely appear somewhere in the same command line. Templates (.env.example)
    # are excluded — they are committed placeholders that render nothing.
    for stmt in statements(command):
        real = real_dotenvs(stmt)
        if not real:
            continue
        if SAFE_ENV_HELPER.search(stmt) or SAFE_ENV_META.match(stmt.strip()):
            continue
        if READ_CONTEXT.search(stmt):
            block(
                "It reads/sources a dotenv file (.env / .envrc). Reading, sourcing, "
                "grepping or cat-ing a dotenv file is banned outright — `source .env` "
                "leaks values through shell errors on unquoted lines, which is exactly "
                "how a live token was leaked on 2026-07-14.\n"
                f"The file that tripped this: {real[0]}\n"
                "(Naming the path in a commit message, staging it with `git add`, or "
                "reading a .env.example template are all fine — this fires only when a "
                "read verb is applied to a real dotenv in the same statement.)"
            )
        if EXFIL_VERB.search(stmt) and any(
            t for src in exfil_sources(stmt) for t in real_dotenvs(f" {src} ")
        ):
            block(
                "It copies a real dotenv file somewhere else (cp/mv/rsync/scp/tee/dd). "
                "The copy itself prints nothing, which is exactly the problem: the "
                "follow-up read names a path that no longer looks like a dotenv, so "
                "nothing downstream can catch it. This is the temp-file indirection the "
                "gate forbids, blocked at the point where the intent is still visible.\n"
                "Writing INTO a dotenv is fine — `cp .env.example .env` is allowed.\n"
                "To move values into Doppler, use the sanctioned helper:\n"
                "  node the engineering-manager repo's env-to-Doppler tool --project <p> --config <c> --keys A,B"
            )

    # --- 2b. Doppler CLI config file (holds the auth token) ------------------
    if any(
        DOPPLER_CONFIG_FILE.search(s) and READ_CONTEXT.search(s) for s in statements(command)
    ):
        block(
            "It reads a Doppler CLI config file (~/.doppler/.doppler.yaml or a "
            "doppler.yaml). That file stores the CLI auth token (dp.ct.*) in "
            "plaintext — cat/grep/source of it leaks a live workplace token (this "
            "happened 2026-07-25). To read the path->project/config map safely, use "
            "`doppler configs` / `doppler setup --json`; never read the raw file."
        )

    # --- 2c. MCP client config (holds hosted-bundle bearer tokens) -----------
    if any(
        MCP_CONFIG_FILE.search(s) and READ_CONTEXT.search(s) for s in statements(command)
    ):
        block(
            "It reads an MCP client config (.mcp.json / scripts/mcp-daemon/config.json). "
            "Those files hold live bearer tokens in plaintext under "
            "`headers.Authorization` — reading one leaks a working credential for the "
            "hosted MCP gateways even if you filter the `env` key (this happened "
            "2026-07-29: the jerky em_bot and slashbin-ai-knowledge bearers). There is "
            "no safe way to read this file from Bash — any filter you write still runs "
            "in a shell whose output is the transcript, so this gate blocks the read "
            "outright rather than trusting the filter. To answer the question you "
            "actually have:\n"
            "  * WHICH servers are wired / are they up -> `claude mcp list`\n"
            "  * IS a bundle healthy -> `npm run healthcheck:jerky` (or its prod form)\n"
            "  * CALL a bundle -> use the mcp__* tools, or a script that resolves the "
            "bearer itself via scripts/jerky-com/lib/mcp-client.mjs `fetchVerifyBearer`\n"
            "The Read tool is NOT a workaround — it prints the same tokens."
        )

    # --- 2d. API/browser captures (hold a live cookie jar) -------------------
    # Content-sniffed, not path-matched: a capture has no canonical name. Only
    # statements that actually apply a read verb are sniffed, and the sanctioned
    # redactor is exempt so the safe path stays runnable.
    for stmt in statements(command):
        if not READ_CONTEXT.search(stmt) or SAFE_CAPTURE_TOOL.search(stmt):
            continue
        found = capture_files(stmt)
        if found:
            block(
                "It reads a saved API/browser capture that still contains live "
                "credentials. A 'Copy as fetch' or HAR carries the whole cookie jar "
                "inline with the payload you want — on 2026-08-24 reading one put a "
                "live `__Secure-refresh-token` (a working login, no password needed) "
                "into the transcript, and the owner had to log the session out.\n"
                f"The file that tripped this: {found[0]}\n"
                "Strip it first, then read the redacted copy:\n"
                "  node scripts/secrets/redact-capture.mjs <file>\n"
                "That writes `<name>.redacted<ext>` (every cookie value and auth "
                "header removed, request body and response preserved) and prints only "
                "names and byte lengths. Reading a `*.redacted.*` file is allowed.\n"
                "Redaction does NOT un-leak a captured token — if the capture held a "
                "session or refresh token, invalidate it at the source as well."
            )

    # --- 2. secret stores that print values ----------------------------------
    if DOPPLER_SET_INLINE_VALUE.search(command):
        block(
            "`doppler secrets set KEY=VALUE` puts the value in argv, where `ps` can "
            "read it. Pipe the value on stdin instead:\n"
            "  printf '%s' \"$v\" | doppler secrets set KEY -p <p> -c <c> --silent"
        )
    if DOPPLER_GET.search(command):
        block("`doppler secrets get/download` prints secret values to stdout.")
    if (
        DOPPLER_VALUES.search(command)
        and not DOPPLER_SAFE.search(command)
        and not DOPPLER_SET_SAFE.search(command)
        and not DOPPLER_NOTES_SAFE.search(command)
        and not DOPPLER_DELETE_SAFE.search(command)
    ):
        block(
            "`doppler secrets` prints a table of VALUES by default. Add --only-names "
            "if you just need to confirm a key exists; to WRITE, use the stdin form "
            "with --silent."
        )
    if RAILWAY_VARS.search(command) and not RAILWAY_VAR_SAFE.search(command):
        block(
            "It reads Railway service variables (`railway variables` / `railway "
            "variable list`), which prints every secret VALUE to stdout.\n"
            "\n"
            "To ASK whether a variable is set, and to what — the question this block\n"
            "used to leave unanswerable — describe it once in credentials.json as a\n"
            "`railway-var` and read it through the tool. It reads in-process and\n"
            "prints a fingerprint, or the plain value when the descriptor declares\n"
            "\"secret\": false:\n"
            "  node the engineering-manager repo's credential tooling verify <name> <dev|prd>\n"
            "\n"
            "To WRITE, use the stdin form — value never touches argv or stdout:\n"
            "  printf '%s' \"$v\" | railway variable set KEY --stdin\n"
            "  node scripts/secrets/credential.mjs set <name> <env> --value V   (non-secret only)\n"
            "or mirror a secret from Doppler with "
            "scripts/secrets/sync-doppler-to-railway.sh (see "
            "docs/runbooks/configure-new-railway-service-env.md)."
        )

    # --- 3. whole-environment dumps ------------------------------------------
    if ENV_DUMP.search(command):
        block("It dumps the whole environment (env / printenv / bare `export` / "
              "`export $(...)` whose operands can expand to nothing / declare -x / "
              "set -x), which prints every secret currently loaded.")

    # --- 3b. creating a credential by hand -----------------------------------
    if not SAFE_CREDENTIAL_TOOL.search(command):
        if ROLE_PASSWORD_DDL.search(command):
            block(
                "It sets a database role's password inline (CREATE/ALTER ROLE ... PASSWORD). "
                "The value lands in argv and in the echoed SQL.\n"
                "Use the credential tool — it passes the password as a bound parameter and "
                "never renders it:\n"
                "      <admin context> -- node the engineering-manager repo's credential tooling rotate <name> <env>"
            )
        if SECRET_GENERATOR.search(command):
            block(
                "It generates secret material at the shell (openssl rand / pwgen / "
                "/dev/urandom). Whatever it produces is printed before it is ever stored, "
                "so the secret exists in the transcript from the moment it exists at all.\n"
                "Generate INSIDE the tool that will store it:\n"
                "      <admin context> -- node the engineering-manager repo's credential tooling rotate <name> <env>"
            )

    # --- 4. echoing a secret-shaped variable ---------------------------------
    if ECHO_SECRET.search(command):
        block("It prints a secret-shaped variable ($..._TOKEN / _SECRET / _KEY / "
              "_PASSWORD) to stdout.")

    # --- 5. process argv exposure --------------------------------------------
    if PS_ARGS.search(command) or PGREP_ARGS.search(command) or PROC_CMDLINE.search(command):
        block(
            "It prints full process command lines (`ps` with args/cmd/aux/-f, "
            "`pgrep -a`, or /proc/<pid>/cmdline).\n"
            "Long-running services take credentials AS ARGV — the MCP supergateways "
            "are launched with Postgres/Redis DSNs and API keys on the command line, "
            "so this prints live secrets even though you never named one.\n"
            "Use metadata-only forms instead — they answer nearly every real question:\n"
            "  ps -o pid=,ppid=,rss= -p <pid>     # counts, memory, parentage\n"
            "  pgrep -P <ppid>                     # children, PIDs only\n"
            "  ss -ltnp                            # port -> pid + process NAME (no argv)\n"
            "If you genuinely need to identify a process, map it by listening port or "
            "by PID file, never by its command line."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
