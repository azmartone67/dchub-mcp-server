#!/usr/bin/env python3
"""Anonymous wall matrix against the live MCP: per tool, commerce-class links in the text an agent reads
(u = /u/ short, long = /upgrade/h, gc = /go/c), /go/c in structuredContent, price/plan copy. Read-only (QA skip
headers). The daily "link-count == 1" check for DCHUB_ONE_LINK_V1: every wall=1 row should read text_links=1 sc_gc=0.
Usage: python3 scripts/wall-probe.py [tool ...]"""
import json, re, sys, urllib.request

URL = 'https://dchub.cloud/mcp'
ARGS = {'analyze_site': {'lat': 33.4, 'lon': -112.0}, 'compare_sites': {'sites': [{'lat': 33.4, 'lon': -112.0}, {'lat': 39.0, 'lon': -77.4}]},
        'get_dchub_recommendation': {'query': 'best market for 50MW'}, 'generate_site_analysis': {'lat': 33.4, 'lon': -112.0},
        'export_dataset': {'dataset': 'facilities'}, 'get_grid_intelligence': {'iso': 'WECC', 'market': 'Phoenix'},
        'get_market_intel': {'market': 'Phoenix'}, 'get_interconnection_queue': {'iso': 'PJM'},
        'get_energy_prices': {'market': 'Phoenix'}, 'search_facilities': {'query': 'Phoenix', 'limit': 5},
        'get_facility': {'facility_id': 1}, 'find_sites': {'state': 'AZ', 'min_mw': 50}, 'get_fiber_intel': {'market': 'Phoenix'},
        'get_power_pipeline': {'market': 'Phoenix'}, 'get_gas_intelligence': {'market': 'Phoenix'}}
tools = sys.argv[1:] or list(ARGS)
LINK = re.compile(r'https?://(?:(?:www|api)\.)?dchub\.cloud/(?:go/c/|upgrade/|u/|pricing|plans|signup|connect|ai#pricing)[^\s"\\)\]>]*|https://(?:buy|checkout)\.stripe\.com/[^\s"\\)\]>]*')
for t in tools:
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': t, 'arguments': ARGS.get(t, {})}}).encode()
    req = urllib.request.Request(URL, body, {'content-type': 'application/json', 'accept': 'application/json, text/event-stream',
                                              'user-agent': 'dchub-qa-readonly', 'X-DCHub-QA': '1'})
    try:
        raw = urllib.request.urlopen(req, timeout=60).read().decode()
        raw = raw[raw.find('{'):].split('\n')[0] if raw.lstrip().startswith('event') or 'data:' in raw[:20] else raw
        d = json.loads(re.sub(r'^data: ', '', raw.strip()))
    except Exception as e:
        print(f'{t:28s} ERR {e}'); continue
    r = d.get('result') or {}
    text = '\n'.join(b.get('text', '') for b in r.get('content', []) if isinstance(b, dict))
    sc = r.get('structuredContent') or {}
    sj = json.dumps(sc)
    tl = sorted(set(l.rstrip('.,') for l in LINK.findall(text)))
    gc_sc = len(set(re.findall(r'dchub\.cloud/go/c/[A-Za-z0-9._-]+', sj)))
    gc_tx = len(set(re.findall(r'dchub\.cloud/go/c/[A-Za-z0-9._-]+', text)))
    price = sorted(set(re.findall(r'\$\d[\d,]*(?:/mo)?|after (?:they|your human) pay\w*|\b(?:Developer|Starter|Founding)\b|\bPro\b', text)))
    short = sum(1 for l in tl if '/u/' in l); longl = sum(1 for l in tl if '/upgrade/h/' in l)
    wall = bool(sc.get('human_url') or sc.get('for_your_human') or '_wall' in sj)
    print(f'{t:28s} wall={int(wall)} text_links={len(tl)} (u={short} long={longl} gc={gc_tx}) sc_gc={gc_sc} dev_url={int(bool((sc.get("upgrade") or {}).get("developer_url")))} copy={price}')
