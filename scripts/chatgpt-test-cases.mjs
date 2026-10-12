#!/usr/bin/env node
// Runs the 5 positive ChatGPT directory test cases (see the submission's
// "Testing" step) against a live MCP endpoint, plus /plans and /terms, from
// whatever IP this runs on. Meant for a GitHub Actions runner so the result is
// not laptop-IP flavoured. Exit 1 on any transport error, JSON-RPC error,
// isError result or empty body. Gated/preview answers are reported, not failed.
//   node scripts/chatgpt-test-cases.mjs [--base https://dchub.cloud] [--path /mcp/chatgpt]
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://dchub.cloud').replace(/\/$/, '');
const PATH = arg('--path', '/mcp/chatgpt');
const OUT = arg('--out', 'chatgpt-test-cases-result.json');
const URL_ = BASE + PATH;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
            'user-agent': 'dchub-chatgpt-test-cases/1 (github-actions)' };
let sid = null; let rid = 0;

async function rpc(method, params, note = false) {
  const body = note ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rid, method, params };
  const res = await fetch(URL_, { method: 'POST', headers: { ...H, ...(sid ? { 'mcp-session-id': sid } : {}) },
                                  body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  sid = res.headers.get('mcp-session-id') || sid;
  const text = await res.text();
  if (note) return { status: res.status };
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${method}: ${text.slice(0, 200)}`);
  const m = text.match(/^data: (.*)$/m);
  const j = JSON.parse(m ? m[1] : text);
  if (j.error) throw new Error(`JSON-RPC ${j.error.code} on ${method}: ${j.error.message}`);
  return j.result;
}

async function call(name, args) {
  const t0 = Date.now();
  const r = await rpc('tools/call', { name, arguments: args });
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json = null; try { json = JSON.parse(text); } catch { /* prose is fine */ }
  const gated = /preview|upgrade|human_url|human_message|plan required/i.test(text);
  return { tool: name, args, ms: Date.now() - t0, isError: !!r.isError, bytes: text.length, gated, json,
           head: text.slice(0, 160).replace(/\s+/g, ' ') };
}

function firstId(r) {
  const rows = r?.json?.results || r?.json?.items || (Array.isArray(r?.json) ? r.json : []);
  const row = rows.find((x) => x && (x.id || x.slug || x.facility_id));
  return row ? String(row.id || row.slug || row.facility_id) : null;
}

const results = []; let failed = 0;
const record = (tc, r, note) => {
  const bad = r.isError || r.bytes === 0;
  if (bad) failed++;
  results.push({ tc, ...r, json: undefined, ok: !bad, note });
  console.log(`${bad ? 'FAIL' : 'ok  '} TC${tc} ${r.tool} ${r.ms}ms ${r.bytes}B${r.gated ? ' [gated/preview]' : ''} | ${r.head}`);
};
async function step(tc, name, args, note) {
  try { const r = await call(name, args); record(tc, r, note); return r; }
  catch (e) { failed++; results.push({ tc, tool: name, args, ok: false, error: String(e.message || e) });
              console.log(`FAIL TC${tc} ${name} | ${e.message}`); return null; }
}

const ip = await fetch('https://api.ipify.org').then((r) => r.text()).catch(() => 'unknown');
console.log(`runner ip: ${ip}\nendpoint: ${URL_}`);
for (const p of ['/plans', '/terms']) {
  const s = await fetch(BASE + p, { redirect: 'follow', headers: { 'user-agent': H['user-agent'] } }).then((r) => r.status).catch(() => 0);
  if (s !== 200) failed++;
  results.push({ check: p, status: s, ok: s === 200 });
  console.log(`${s === 200 ? 'ok  ' : 'FAIL'} GET ${p} -> ${s}`);
}

try {
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dchub-test-cases', version: '1' } });
  await rpc('notifications/initialized', {}, true);
} catch (e) { console.log(`initialize failed (${e.message}); continuing stateless`); }

// TC1 live grid headroom / time-to-power
await step(1, 'get_grid_scoreboard', {});
await step(1, 'get_grid_intelligence', { region_id: 'ERCOT' });
await step(1, 'get_interconnection_queue', { iso: 'ERCOT' });
// TC2 market ranking
await step(2, 'rank_markets', { criteria: 'best_overall' });
await step(2, 'get_market_dcpi_rank', { market_slug: 'northern-virginia' });
// TC3 facility search + detail
const s = await step(3, 'search', { query: 'operational data centers in Ashburn, Virginia over 50 MW' });
await step(3, 'search_facilities', { query: 'Ashburn Virginia' });
const id = firstId(s);
if (id) await step(3, 'fetch', { id }); else { failed++; console.log('FAIL TC3 fetch | search returned no id'); results.push({ tc: 3, tool: 'fetch', ok: false, error: 'no id from search' }); }
// TC4 site scoring: analyze_site is not in the /mcp/chatgpt profile (and is paid), so score a facility.
if (id) await step(4, 'score_facility', { facility_id: id }, 'analyze_site not served on this profile');
else { failed++; results.push({ tc: 4, tool: 'score_facility', ok: false, error: 'no id' }); }
// TC5 hyperscaler deals + M&A pipeline
await step(5, 'hyperscaler_deals', { limit: 10 });
await step(5, 'list_transactions', {});
await step(5, 'get_pipeline', {});

writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ip, endpoint: URL_, failed, results }, null, 1));
console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${failed} failure(s); detail in ${OUT}`);
process.exit(failed ? 1 : 0);
