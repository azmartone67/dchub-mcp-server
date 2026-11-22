#!/usr/bin/env python3
"""Classify one MCP tools/call response for tools/mcp_value_harness.sh.

Usage: value_harness_classify.py <required-key>   (the SSE `data:` JSON on stdin)
Prints one verdict:
  PASS                 full answer, required key non-empty
  REGRESSION:...       full answer, required key empty            -> hard fail
  AUTH:key-refused(r)  DC Hub refused the harness key (identity.credential_refused) -> hard fail, stop
  GATED:...            the answer is a gated preview (completeness.status 'partial') -> hard fail
  TRANSIENT:...        empty / non-JSON / {error} body (CI per-IP rate limit)      -> retry, else skip

Why AUTH and GATED exist (2026-11-22): the harness exists to prove a PAID key gets full data. From at least
2026-11-13 the backend refused the key in DCHUB_MCP_PAID_KEY, so every call was served anonymously behind the
quota wall. The wall answer's content[0].text is prose, so the old check read it as 'text-not-json', called it
CI rate-limit noise, and the job stayed green for every run while checking nothing. structuredContent says what
happened (identity.credential_refused, completeness.status), so it is read first.
"""
import json
import sys

SKIP_KEYS = ('next_session', 'citation', 'freshness')


def _nonempty(v):
    return v not in (None, '', [], {})


def classify(raw, rk):
    if not raw.strip():
        return 'TRANSIENT:empty-response'
    try:
        d = json.loads(raw)
    except Exception:
        return 'TRANSIENT:non-json'
    res = d.get('result') if isinstance(d, dict) else None
    if not isinstance(res, dict):
        return 'TRANSIENT:no-result'
    sc = res.get('structuredContent')
    sc = sc if isinstance(sc, dict) else {}

    ident = sc.get('identity') if isinstance(sc.get('identity'), dict) else {}
    refused = ident.get('credential_refused')
    if refused:
        return 'AUTH:key-refused(%s)' % str(refused)[:40]

    comp = sc.get('completeness')
    if isinstance(comp, dict) and comp.get('status') == 'partial':
        return 'GATED:%s' % str(comp.get('kind') or 'partial')[:40]
    if sc.get('free_preview_only') is True or sc.get('trial_preview') is True:
        return 'GATED:preview'

    o = sc if rk in sc else None
    if o is None:
        try:
            txt = res['content'][0]['text']
        except Exception:
            return 'TRANSIENT:no-content'
        try:
            o = json.loads(txt)
        except Exception:
            return 'TRANSIENT:text-not-json'
    if isinstance(o, dict) and ('error' in o or 'detail' in o) and rk not in o:
        return 'TRANSIENT:error-envelope'
    v = o.get(rk) if isinstance(o, dict) else None
    if _nonempty(v):
        return 'PASS'
    keys = [k for k in (o.keys() if isinstance(o, dict) else []) if not k.startswith('_') and k not in SKIP_KEYS]
    return 'REGRESSION:empty(%s);keys=%s' % (rk, keys[:6])


if __name__ == '__main__':
    print(classify(sys.stdin.read(), sys.argv[1] if len(sys.argv) > 1 else ''))
