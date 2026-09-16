#!/usr/bin/env python3
"""
sync_cf_worker_manifest.py — sync the out-of-repo `dchubapiproxy` CF worker's
hardcoded MCP manifest (MCP_FALLBACK_TOOLS + MCP_SERVER_INFO) to the LIVE tool
surface. Fixes the recurring registry-freshness drift where the worker-served
/.well-known/mcp.json + /mcp/manifest lag the real tools/list (e.g. 58 vs 70).

★ WHY THIS EXISTS: the manifest agents/registries discover you through is served
by a CF zone worker that hardcodes the tool array — it does NOT auto-sync from
server.mjs. This script IS the push: it pulls the authoritative live tools/list,
rebuilds the worker's fallback array + the counts the worker SERVES, and hands
back the full patched worker to paste over the live code. Idempotent; safe to
re-run.

Clipboard workflow (macOS) — no CF token needed, you paste the worker in/out:
  1. In the CF worker editor (dchubapiproxy): Cmd-A, Cmd-C.
  2. Terminal:
       pbpaste | python3 scripts/sync_cf_worker_manifest.py - --version 4.9.70-x \
         | pbcopy && echo "READY — paste it back"
  3. In the editor: Cmd-A, Cmd-V, Save/Deploy.

File mode:  python3 scripts/sync_cf_worker_manifest.py worker.js [out.js] [--version V]

  --version V   set WORKER_VERSION to V. The `x-dc-worker-version` response
                header is the ONLY way to confirm a paste actually reached
                production, so without a bump a deploy cannot be verified.
                Omitting it leaves WORKER_VERSION exactly as it was and says so.

The live tool surface is fetched from MCP_URL (default https://dchub.cloud/mcp).

WHAT THIS TOUCHES, and nothing else:
  • MCP_FALLBACK_TOOLS — rebuilt from the live tools/list. Each description is
    baked VERBATIM but for ONE edit: a comma-grouped FACILITY count is dropped
    on the way in (see _scrub_facility_magnitude). It is canon-derived upstream
    and stops tracking canon the moment it is frozen in a pasted worker.
  • "NN tools" / "manifest-NN" inside STRING LITERALS the worker serves at
    runtime (MCP_SERVER_INFO.description, MCP_LANDING_HTML_V1, the manifest
    `note` strings, …) — see _rewrite_served_counts.
  • WORKER_VERSION, and only when --version is given.

★ Counts in COMMENTS are history and are never rewritten. The worker's changelog
header (a /* */ block) and its `//` notes record what the counts WERE on a given
date — "MCP_SERVER_INFO description '70 tools' → '72 tools'", "v4.4.2:
/.well-known/mcp.json returns all 72 tools", "Phase manifest-72-sync". A blanket
s/NN tools/91 tools/ rewrote all of it, turning a changelog into a lie (and
collapsing "'70 tools' → '72 tools'" into "'91 tools' → '91 tools'"). Past events
do not move. Only the strings the worker hands to a client do.
"""
import json
import os
import re
import sys
import urllib.request

MCP_URL = os.environ.get("MCP_URL", "https://dchub.cloud/mcp")

# ── the facility-magnitude scrub ─────────────────────────────────────────────
# WHAT: a comma-grouped COUNT is dropped from a tool description as it is baked,
# and only where a facility noun follows it. The noun stays; every other
# magnitude in the same sentence stays, including one sitting right beside it.
#
#   "Search 21,900+ global data center facilities across 170+ countries"
#     -> "Search global data center facilities across 170+ countries"
#   "...21,900+ facilities + 330,000+ mapped power/grid/gas/fiber assets..."
#     -> "...facilities + 330,000+ mapped power/grid/gas/fiber assets..."
#
# WHY ONLY THIS ONE. Those three sentences (why_dchub, search_facilities,
# semantic_search) are built BACKEND-side through canon_text("{canon_facilities}")
# in dchub-backend routes/mcp_tool_catalog.py, so on the live surface the number
# is a rendered placeholder that re-reads canon on every tools/list. Baking the
# RENDERED text turns a phrase that tracks into a literal that cannot: worker.js
# imports no canon and ships by a manual Cloudflare dashboard paste, so the number
# is frozen for as long as that paste lasts — on the manifest agents and
# registries discover us through. Every other magnitude in these descriptions —
# deals, grid assets, queue projects, call quotas — is hand-written prose that
# tracks nothing upstream, so freezing it costs nothing and rewriting it would be
# this script inventing copy. Same rule as the count rewrite below: move only
# what goes stale, leave everything else byte-identical.
#
# WHY AT THE BAKE. dchub-backend #4635 removed the three literals by hand and
# fenced them in tests/test_wellknown_manifest_version_derived.py::
# test_fallback_tool_descriptions_carry_no_facility_count. A hand removal does not
# survive a re-sync — the next run of THIS script bakes them straight back and
# turns that fence red, with no commit responsible — so the removal has to live
# where the text is baked.
#
# ★ The lookahead is the fence's OWN tail, character for character. The predicate
# is COPIED, not re-derived, so "what this leaves behind" and "what the fence
# accepts" cannot drift into a scrub that runs and still ships red.
FACILITY_COUNT_TAIL = r"(?:[a-z][a-z-]*\s+){0,4}facilit\w*"
FACILITY_MAGNITUDE_RE = re.compile(r"~?\d{1,3}(?:,\d{3})+\+?\s*(?=" + FACILITY_COUNT_TAIL + ")")

COUNT_RE = re.compile(r"\b\d{2,3} tools\b")
MANIFEST_TOKEN_RE = re.compile(r"manifest-\d{2,3}")
WORKER_VERSION_RE = re.compile(r"""^(const\s+WORKER_VERSION\s*=\s*)(['"])(.*?)\2""", re.M)

# After one of these, a `/` opens a REGEX LITERAL; after a value (identifier,
# number, `)`, `]`, string) it is division. worker.js really does contain
# `.replace(/"/g, …)`, whose body holds a quote: a scanner that walks straight
# past it enters string mode on that `"` and mis-reads every byte after it.
_REGEX_PREV_CHARS = set("(,=:[!&|?{};+-*%~^<>")
_REGEX_PREV_WORDS = {"return", "typeof", "instanceof", "in", "of", "new", "delete",
                     "void", "do", "else", "case", "yield", "await", "throw"}


def _fetch_live_tools() -> list:
    """POST tools/list to the live MCP and return [{name, description, inputSchema}]."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}).encode()
    req = urllib.request.Request(MCP_URL, data=body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "dchub-cf-manifest-sync/1.0"})
    raw = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    # streamable-http may prefix "data: " (SSE) — grab the JSON object
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise SystemExit("could not parse tools/list response")
    tools = (json.loads(m.group(0)).get("result") or {}).get("tools") or []
    out = []
    for t in tools:
        out.append({"name": t.get("name"),
                    "description": t.get("description") or "",
                    "inputSchema": t.get("inputSchema") or {"type": "object", "properties": {}}})
    if len(out) < 40:
        raise SystemExit(f"only {len(out)} tools fetched — refusing to shrink the manifest")
    return out


def _prev_word(src: str, i: int) -> str:
    """The identifier ending at src[i] (exclusive), or ''."""
    j = i
    while j > 0 and (src[j - 1].isalnum() or src[j - 1] in "_$"):
        j -= 1
    return src[j:i]


def _end_of_quoted(src: str, i: int) -> int:
    """src[i] is ' or ". Return the index AFTER the closing quote. A raw newline
    ends it too: a JS string cannot span one, so stopping there bounds the damage
    of a mis-read to a single line instead of the rest of the file."""
    q, j, n = src[i], i + 1, len(src)
    while j < n:
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == q:
            return j + 1
        if c == "\n":
            return j
        j += 1
    return n


def _end_of_regex(src: str, i: int) -> int:
    """src[i] is the `/` of a regex literal. Return the index AFTER the flags, or
    i+1 if it turns out not to be one (a newline before the closing slash)."""
    j, n, in_class = i + 1, len(src), False
    while j < n:
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == "\n":
            return i + 1
        if in_class:
            if c == "]":
                in_class = False
        elif c == "[":
            in_class = True
        elif c == "/":
            j += 1
            while j < n and src[j].isalpha():
                j += 1
            return j
        j += 1
    return n


def _segments(src: str) -> list:
    """Split JS source into ('code'|'comment'|'string', start, end) segments.

    String- AND comment-aware, which is the whole point: MCP_FALLBACK_TOOLS is
    preceded and followed by `//` comment lines containing apostrophes ("this
    array's length", "that branch's"). A scanner that tracks strings but not
    comments flips into string mode on that apostrophe, never sees the closing
    `]`, and dies with "unbalanced array for MCP_FALLBACK_TOOLS".

    Also handles the two JS tokenising hazards this file actually contains:
    template literals with ${…} interpolation (the landing-page HTML), and regex
    literals whose body holds a quote (`.replace(/"/g, …)`, ×3).

    The `${`/`}` delimiters themselves belong to no segment. Callers rebuild the
    file by copying the untouched gaps verbatim, so unassigned bytes survive.
    """
    n, i = len(src), 0
    segs, seg_start = [], 0
    mode = "code"
    stack, brace_stack, brace = [], [], 0
    prev = ""  # last significant char in code, for regex-vs-division

    def flush(kind, start, end):
        if end > start:
            segs.append((kind, start, end))

    while i < n:
        c = src[i]

        if mode == "tmpl":
            if c == "\\":
                i += 2
                continue
            if c == "`":
                i += 1
                flush("string", seg_start, i)
                seg_start = i
                mode = stack.pop()
                prev = "x"  # a template is a value
                continue
            if c == "$" and src[i + 1:i + 2] == "{":
                flush("string", seg_start, i)
                i += 2
                seg_start = i
                stack.append("tmpl")
                brace_stack.append(brace)
                brace, mode, prev = 0, "code", ""
                continue
            i += 1
            continue

        # ── code ──────────────────────────────────────────────────────────────
        if c == "/" and src[i + 1:i + 2] in ("/", "*"):
            flush("code", seg_start, i)
            if src[i + 1] == "/":
                j = src.find("\n", i)
                j = n if j < 0 else j
            else:
                j = src.find("*/", i + 2)
                j = n if j < 0 else j + 2
            segs.append(("comment", i, j))
            i = seg_start = j
            continue

        if c in "\"'":
            flush("code", seg_start, i)
            j = _end_of_quoted(src, i)
            segs.append(("string", i, j))
            i = seg_start = j
            prev = "x"
            continue

        if c == "`":
            flush("code", seg_start, i)
            stack.append("code")
            seg_start, mode = i, "tmpl"
            i += 1
            continue

        if c == "/" and _starts_regex(src, i, prev):
            i = _end_of_regex(src, i)
            prev = "x"
            continue

        if c == "{":
            brace += 1
        elif c == "}":
            if brace == 0 and stack and stack[-1] == "tmpl":
                flush("code", seg_start, i)
                i += 1
                seg_start = i
                mode = stack.pop()
                brace = brace_stack.pop()
                continue
            brace -= 1

        if not c.isspace():
            prev = c
        i += 1

    flush("string" if mode == "tmpl" else "code", seg_start, n)
    return segs


def _starts_regex(src: str, i: int, prev: str) -> bool:
    """Does the `/` at src[i] open a regex literal (rather than divide)?"""
    if prev == "" or prev in _REGEX_PREV_CHARS:
        return True
    if prev.isalnum() or prev in "_$":
        # `return /x/` is a regex; `count / x` is division. Whitespace may sit
        # between the word and the slash, so step back over it first.
        j = i
        while j > 0 and src[j - 1].isspace():
            j -= 1
        return _prev_word(src, j) in _REGEX_PREV_WORDS
    return False


def _find_array_span(src: str, marker: str) -> tuple:
    """Return (start, end) char span of `marker = [ ... ]` — bracket-balanced,
    string-aware AND comment-aware (descriptions contain [ ] ' \" ` , and the
    surrounding comments contain apostrophes). end is index AFTER the ]."""
    m = re.search(re.escape(marker) + r"\s*=\s*\[", src)
    if not m:
        raise SystemExit(f"{marker} not found in worker")
    i = src.index("[", m.start())
    depth = 0
    for kind, s, e in _segments(src):
        if kind != "code" or e <= i:
            continue
        for j in range(max(s, i), e):
            c = src[j]
            if c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return m.start(), j + 1
    raise SystemExit(f"unbalanced array for {marker}")


def _count_array_elements(src: str, start: int, end: int) -> int:
    """How many top-level `{…}` elements the array at [start,end) holds."""
    n, depth = 0, 0
    for kind, s, e in _segments(src[start:end]):
        if kind != "code":
            continue
        for c in src[start + s:start + e]:
            if c == "{":
                if depth == 0:
                    n += 1
                depth += 1
            elif c == "}":
                depth -= 1
    return n


def _scrub_facility_magnitude(desc: str) -> str:
    """Drop comma-grouped facility COUNTS; keep the noun and every other number.

    Applied until STABLE rather than once. The fence looks up to four words back,
    so removing one magnitude can pull an earlier one into its reach:
    "1,234+ audits and 21,900+ facilities" -> "1,234+ audits and facilities",
    which the fence still reads as a facility count. Each pass deletes at least
    one character, so this terminates.
    """
    while True:
        out = FACILITY_MAGNITUDE_RE.sub("", desc)
        if out == desc:
            return out
        desc = out


def _build_array_js(marker: str, tools: list) -> str:
    elems = []
    for t in tools:
        elems.append("  { name: %s, description: %s, inputSchema: %s }" % (
            json.dumps(t["name"]),
            json.dumps(_scrub_facility_magnitude(t["description"])),
            json.dumps(t["inputSchema"])))
    return marker + " = [\n" + ",\n".join(elems) + "\n]"


def _worker_version_span(src: str) -> tuple:
    """(span_of_the_quoted_value, current_version) for `const WORKER_VERSION = '…'`."""
    ms = list(WORKER_VERSION_RE.finditer(src))
    if not ms:
        return None, None
    if len(ms) > 1:
        raise SystemExit(f"{len(ms)} WORKER_VERSION declarations — refusing to guess which one ships")
    m = ms[0]
    # span covers the whole quoted literal, opening quote through closing quote.
    return (m.start(2), m.end(0)), m.group(3)


def _rewrite_served_counts(src: str, n: int, skip: tuple = None) -> tuple:
    """Rewrite "NN tools" / "manifest-NN" ONLY inside string literals — the values
    the worker actually hands a client (MCP_SERVER_INFO.description, the landing
    HTML, manifest `note` strings). Never inside `//` or `/* */` comments, so the
    changelog header block and the historical `// canon sync — 80 tools` notes
    stay byte-identical.

    `skip` is a span left alone entirely: WORKER_VERSION, which moves only when
    --version says so.

    Returns (new_src, [(line_no, before, after), …])."""
    out, sites, last = [], [], 0
    for kind, s, e in _segments(src):
        if kind != "string":
            continue
        if skip and not (e <= skip[0] or s >= skip[1]):
            continue
        seg = src[s:e]
        new = MANIFEST_TOKEN_RE.sub(f"manifest-{n}", COUNT_RE.sub(f"{n} tools", seg))
        if new == seg:
            continue
        out.append(src[last:s])
        out.append(new)
        last = e
        # report the line of the first byte that actually moved, not the line of
        # the string's opening quote — a template literal spans many lines.
        k = 0
        while k < min(len(seg), len(new)) and seg[k] == new[k]:
            k += 1
        sites.append((src.count("\n", 0, s + k) + 1, seg, new))
    out.append(src[last:])
    return "".join(out), sites


def _parse_args(argv: list) -> tuple:
    version, positional = None, []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--version":
            if i + 1 >= len(argv):
                raise SystemExit("--version needs a value, e.g. --version 4.9.69-capacity-search")
            version = argv[i + 1]
            i += 2
            continue
        if a.startswith("--version="):
            version = a.split("=", 1)[1]
            i += 1
            continue
        if a.startswith("--") and a != "--":
            raise SystemExit(f"unknown option {a}")
        positional.append(a)
        i += 1
    if version is not None and not version.strip():
        raise SystemExit("--version needs a non-empty value")
    return version, positional


def main(argv=None):
    version, args = _parse_args(list(sys.argv[1:] if argv is None else argv))
    src = sys.stdin.read() if (not args or args[0] == "-") else open(args[0]).read()
    out_path = args[1] if len(args) > 1 else None

    tools = _fetch_live_tools()
    n = len(tools)
    scrubbed = [t["name"] for t in tools
                if _scrub_facility_magnitude(t["description"]) != t["description"]]

    s, e = _find_array_span(src, "MCP_FALLBACK_TOOLS")
    was = _count_array_elements(src, src.index("[", s), e)
    src = src[:s] + _build_array_js("MCP_FALLBACK_TOOLS", tools) + src[e:]

    # counts the worker SERVES — never the ones its changelog/comments remember
    vspan, old_version = _worker_version_span(src)
    src, sites = _rewrite_served_counts(src, n, skip=vspan)

    # WORKER_VERSION moves only on an explicit --version.
    changed = [f"MCP_FALLBACK_TOOLS {was} -> {n} tools"] if was != n else \
              [f"MCP_FALLBACK_TOOLS re-emitted, still {n} tools"]
    if sites:
        changed.append(f"{len(sites)} served count string(s) at line(s) " +
                       ", ".join(str(ln) for ln, _, _ in sites))
    else:
        changed.append("0 served count strings needed rewriting")
    if scrubbed:
        changed.append(f"facility count dropped from {len(scrubbed)} description(s): "
                       + ", ".join(scrubbed))

    if version is not None:
        vspan, old_version = _worker_version_span(src)
        if vspan is None:
            raise SystemExit("no `const WORKER_VERSION = '…'` in this worker — cannot set --version")
        src = src[:vspan[0] + 1] + version + src[vspan[1] - 1:]
        changed.append(f"WORKER_VERSION {old_version} -> {version}")
    else:
        sys.stderr.write(
            "[sync] WARNING: WORKER_VERSION was NOT changed"
            + (f" (still {old_version!r})" if old_version else "")
            + ". x-dc-worker-version is the only way to confirm a paste reached\n"
            "[sync]          production, so this paste will be UNVERIFIABLE from the outside.\n"
            "[sync]          Re-run with --version <new-version> to make it verifiable.\n")
        changed.append("WORKER_VERSION unchanged" + (f" ({old_version})" if old_version else ""))

    sys.stderr.write("[sync] " + "; ".join(changed) + "\n")
    if out_path:
        open(out_path, "w").write(src)
        sys.stderr.write(f"[sync] wrote {out_path}\n")
    else:
        sys.stdout.write(src)


if __name__ == "__main__":
    main()
