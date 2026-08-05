#!/usr/bin/env python3
"""Guard the registry-source files against retired / inflated numbers.

Backs the `honest-numbers drift guard` job in
.github/workflows/registry-refresh.yml. The public registries (Glama, PulseMCP,
the official MCP registry) pull from the SOURCE files in this repo, not from the
live mcp.json, so a stale paste here resurfaces on journalist-facing pages.

★2026-08-05 — WHY THIS IS NO LONGER INLINE, AND NO LONGER HARDCODED.

This guard used to carry the canonical figures twice in the workflow YAML: once
in a comment and once in its own ::error:: message, both frozen at the
2026-07-30 values ("81 tools · 15,300+ facilities"). By 2026-08-05 live canon
was 82 tools / 16,500+ facilities — so a job written to STOP stale numbers was
itself publishing two of them, in the very message a human reads to learn what
the right number is.

The denylist had a sharper edge: it forbade "17,000+ facilit" outright. The
fleet grows. The first day canon crossed 17,000, this job would have rejected
the TRUE count as stale and blocked the correction — a guard against reality.

So: canon is READ from canonical/canon_phrases.json (the committed snapshot of
/api/v1/canon/phrases, refreshed daily by daily-manifest-sync), never
transcribed; and any retired pattern that matches TODAY'S canon is dropped from
the denylist instead of firing against the truth. The denylist stays as the
belt-and-braces layer for values known to have shipped — broader quantity drift
is enforced by scripts/sync-tools-manifest.mjs.

There is deliberately no hardcoded fallback for a missing snapshot: a frozen
number republishes stale canon under a green check.
"""
import json
import os
import re
import sys

CANON_FILE = 'canonical/canon_phrases.json'

# Registry-source files a human or an aggregator actually reads.
SOURCE_FILES = ('mcp-server.json', 'integrations/chatgpt/openapi.json',
                'README.md', 'server.json')

# Values known to have SHIPPED and since been retired. Every retired figure
# joins this list when the canon moves — a value that was once published WILL
# try to come back through a stale paste. Notes on the non-obvious ones:
#   311 markets  — an OVER-claim (score rows, not scored markets; live was 306)
#   500,000+ mapped assets — predates the 07-29 wrong-table corrections (real 323,494)
#   182k power plants — misstates generating UNITS across all statuses as plants
#   180+ countries — the "186" was a legacy name/code double-count (backend #1949)
RETIRED = [
    r'\$?324B', r'\$324 ?billion',
    r'20,000\+ ?facilit', r'20,534', r'17,000\+ ?facilit', r'21,000\+ ?facilit',
    r'50,000\+ ?facilit', r'12,650\+?',
    r'140\+ ?countr', r'180\+ ?countr',
    r'DC Hub Nexus',
    r'232 ?(US )?(power |DCPI-scored |DCPI[- ])?markets?',
    r'311 ?(US )?(power |DCPI-scored |DCPI[- ])?markets?',
    r'1,[45]00\+ ?(tracked ?)?(M&A ?)?(deals|transactions)',
    r'500,000\+ ?mapped',
    r'182,?0?0?0?k? ?(\+ ?)?(global ?)?power plants',
]


def fatal(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def load_canon():
    try:
        with open(CANON_FILE, encoding='utf-8') as fh:
            return json.load(fh)
    except Exception as exc:  # noqa: BLE001 - any read/parse failure is fatal
        fatal(f"{CANON_FILE} is missing or unparseable ({exc}). It is the only source "
              f"of canonical quantities for this guard — there is no hardcoded fallback "
              f"by design. Restore it from git, or run scripts/refresh-canon-phrases.mjs.")


def phrase(canon, key):
    val = canon.get(key)
    if not isinstance(val, str) or not re.fullmatch(r'\d[\d,]*\+', val):
        fatal(f"{CANON_FILE} key '{key}' is {val!r}, not a floor phrase like '16,500+'. "
              f"Refusing to guard registry sources against a malformed snapshot.")
    return val


def main():
    canon = load_canon()
    fac = phrase(canon, 'facilities')
    deals = phrase(canon, 'deals')
    markets = phrase(canon, 'markets')
    countries = phrase(canon, 'countries')
    tools = canon.get('tools')

    summary = (f"{tools} tools · {fac} facilities · {markets} markets scored · "
               f"{countries} countries · {deals} deals · 320,000+ mapped assets · "
               f"DC Hub (not Nexus)")
    print(f"Canonical (read from {CANON_FILE}, retrieved "
          f"{canon.get('retrieved_at', '?')}): {summary}")

    # A retired pattern that matches TODAY'S canon has stopped being a
    # stale-number rule and become a rule against the truth. Drop it, loudly.
    probes = [
        f"{fac} facilities", f"{fac} facility",
        f"{deals} tracked M&A deals", f"{deals} deals",
        f"{deals} tracked M&A transactions",
        f"{markets} markets", f"{markets} US power markets",
        f"{markets} DCPI-scored markets",
        f"{countries} countries",
    ]
    active, retired_by_canon = [], []
    for pat in RETIRED:
        if any(re.search(pat, probe, re.I) for probe in probes):
            retired_by_canon.append(pat)
        else:
            active.append(pat)
    for pat in retired_by_canon:
        print(f"::notice::denylist entry {pat!r} now matches canonical copy — "
              f"skipping it. Canon has caught up with a figure this guard once "
              f"forbade; remove the entry from RETIRED when convenient.")
    if not active:
        fatal("every denylist entry matches current canon — the guard would scan "
              "nothing. This is almost certainly a malformed snapshot.")

    files = [f for f in SOURCE_FILES if os.path.exists(f)]
    print('Scanning:', ' '.join(files))
    pat = re.compile('|'.join(active), re.I)

    hits = []
    for path in files:
        with open(path, encoding='utf-8', errors='replace') as fh:
            for lineno, line in enumerate(fh, 1):
                # A `canon:frozen` line is a deliberate historical statement —
                # same exemption scripts/sync-tools-manifest.mjs honours.
                if 'canon:frozen' in line:
                    continue
                match = pat.search(line)
                if match:
                    hits.append(f"  {path}:{lineno}: {match.group(0)!r} "
                                f"— in: {line.strip()[:160]}")

    if hits:
        print('\n'.join(hits))
        fatal(f"Stale/inflated number reintroduced in a registry-source file. "
              f"Canonical (read live from {CANON_FILE}): {summary}. "
              f"Fix before this reaches the public registries.")

    print(f"✅ registry source is clean — no retired numbers. Canon: {summary}")


if __name__ == '__main__':
    main()
