#!/usr/bin/env python3
"""
sync_cf_worker_manifest.py — sync the out-of-repo `dchubapiproxy` CF worker's
hardcoded MCP manifest (MCP_FALLBACK_TOOLS + MCP_SERVER_INFO) to the LIVE tool
surface. Fixes the recurring registry-freshness drift where the worker-served
/.well-known/mcp.json + /mcp/manifest lag the real tools/list (e.g. 58 vs 70).

★ WHY THIS EXISTS: the manifest agents/registries discover you through is served
by a CF zone worker that hardcodes the tool array — it does NOT auto-sync from
server.mjs. This script IS the push: it pulls the authoritative live tools/list,
rebuilds the worker's fallback array + count + version, and hands back the full
patched worker to paste over the live code. Idempotent; safe to re-run.

Clipboard workflow (macOS) — no CF token needed, you paste the worker in/out:
  1. In the CF worker editor (dchubapiproxy): Cmd-A, Cmd-C.
  2. Terminal:
       pbpaste | python3 scripts/sync_cf_worker_manifest.py - | pbcopy && echo "READY — paste it back"
  3. In the editor: Cmd-A, Cmd-V, Save/Deploy.

File mode:  python3 scripts/sync_cf_worker_manifest.py worker.js [out.js]

The live tool surface is fetched from MCP_URL (default https://dchub.cloud/mcp).
Nothing above the worker's changelog header / RAILWAY_BACKEND const is touched
except MCP_FALLBACK_TOOLS, the "NN tools" count string, and WORKER_VERSION.
"""
import json
import os
import re
import sys
import urllib.request

MCP_URL = os.environ.get("MCP_URL", "https://dchub.cloud/mcp")


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


def _find_array_span(src: str, marker: str) -> tuple:
    """Return (start, end) char span of `marker = [ ... ]` — bracket-balanced,
    string-aware (descriptions contain [ ] ' \" ` ). end is index AFTER the ]."""
    m = re.search(re.escape(marker) + r"\s*=\s*\[", src)
    if not m:
        raise SystemExit(f"{marker} not found in worker")
    i = src.index("[", m.start())
    depth, j, in_str, esc = 0, i, "", False
    while j < len(src):
        c = src[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == in_str:
                in_str = ""
        else:
            if c in "\"'`":
                in_str = c
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return m.start(), j + 1
        j += 1
    raise SystemExit(f"unbalanced array for {marker}")


def _build_array_js(marker: str, tools: list) -> str:
    elems = []
    for t in tools:
        elems.append("  { name: %s, description: %s, inputSchema: %s }" % (
            json.dumps(t["name"]), json.dumps(t["description"]),
            json.dumps(t["inputSchema"])))
    return marker + " = [\n" + ",\n".join(elems) + "\n]"


def main():
    args = [a for a in sys.argv[1:]]
    src = sys.stdin.read() if (not args or args[0] == "-") else open(args[0]).read()
    out_path = args[1] if len(args) > 1 else None

    tools = _fetch_live_tools()
    n = len(tools)

    s, e = _find_array_span(src, "MCP_FALLBACK_TOOLS")
    src = src[:s] + _build_array_js("MCP_FALLBACK_TOOLS", tools) + src[e:]

    # count string in MCP_SERVER_INFO description + anywhere "NN tools" appears
    src = re.sub(r"\b\d{2,3} tools\b", f"{n} tools", src)
    # bump a WORKER_VERSION / worker-version string's trailing manifest-NN token
    src = re.sub(r"manifest-\d{2,3}", f"manifest-{n}", src)

    sys.stderr.write(f"[sync] rebuilt MCP_FALLBACK_TOOLS to {n} tools; updated count + version tokens\n")
    if out_path:
        open(out_path, "w").write(src)
        sys.stderr.write(f"[sync] wrote {out_path}\n")
    else:
        sys.stdout.write(src)


if __name__ == "__main__":
    main()
