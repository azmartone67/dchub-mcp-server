#!/usr/bin/env node
// probe-chatgpt-directory.mjs — the no-key probe of the ChatGPT directory profile.
//
//   node scripts/probe-chatgpt-directory.mjs [https://dchub.cloud/mcp/chatgpt]
//
// Lists the tools anonymously, checks every tool's annotations carry only the
// five standard keys, calls every tool (no arguments, then plausible ones) and
// scans each raw response body for the patterns below. Exits 1 on any hit.
// subscribe_digest is called with NO email, so the probe never sends mail.
//
// The same patterns back test/chatgpt-directory-probe.test.mjs, so CI and the
// live check cannot drift apart.

export const PROBE_PATTERNS = {
  '/go/c': /\/go\/c\//,
  '/upgrade/h': /\/upgrade\/h\//,
  '$<digit>': /\$\s?\d/,
  'dch_ key': /\bdch_[a-z]+_[A-Za-z0-9]/,
  'session id': /\boai-[0-9a-f]{16,}|"(mcp_)?session_?id"|[?&]sid=|mcp-session-id/i,
  'for_your_human': /for_your_human|for your human/i,
  'checkout': /buy\.stripe\.com|\bcheckout\b/i,
  'claim token': /claim_free_key|auto_trial_key|persist_config|"claim_token"/i,
  'upgrade/unlock wording': /\bunlock|\bupgrade (to|now|your)\b|upgrade_required/i,
  // The /mcp anti-scraper block (server.mjs r-scraper-block) must never fire on
  // the profile: it refuses the call and its copy offers keys. The response
  // filter strips part of that copy, so match the sentences that survive it.
  'scraper block': /scraper_pattern_blocked|Automated usage detected|5-tool sweep|Anonymous sweep blocked|\b(enterprise|benchmark|dev) key\b/i,
};

export function probeHits(text) {
  const s = String(text || '');
  return Object.entries(PROBE_PATTERNS).filter(([, re]) => re.test(s)).map(([k]) => k);
}

// Refusals that say nothing about what the profile answers: the per-IP 429,
// the per-IP daily hard wall (anon_hard_wall, "Anonymous access is paused for
// this IP until UTC midnight"), and the /mcp scraper block. A run made of
// these is inconclusive, never clean.
export const REFUSED = /API 429|rate_limit_exceeded|anon_hard_wall|Anonymous access is paused|scraper_pattern_blocked|Automated usage detected|Anonymous sweep blocked/;

// 'refused' | 'data' | 'other' for one tools/call response.
export function classifyResponse(raw, msg) {
  const s = String(raw || '');
  if (REFUSED.test(s)) return 'refused';
  if (msg && msg.result && !msg.result.isError && !/\\"error\\":/.test(s)) return 'data';
  return 'other';
}

const STANDARD = new Set(['title', 'readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']);

export function annotationViolations(tools) {
  const out = [];
  for (const t of tools || []) {
    const extra = Object.keys(t.annotations || {}).filter((k) => !STANDARD.has(k));
    if (extra.length) out.push(`${t.name}: ${extra.join(', ')}`);
  }
  return out;
}

// Plausible arguments so most tools get past local validation and reach data.
// Tools strip what they do not declare.
export const GUESS_ARGS = {
  region_id: 'PJM', region: 'TX', iso: 'PJM', isos: 'PJM,ERCOT', market: 'northern-virginia',
  market_slug: 'northern-virginia', state: 'VA', lat: 39.04, lon: -77.48, lng: -77.48,
  location: 'Ashburn, VA', locations: '39.04,-77.48;33.45,-112.07', query: 'data center',
  q: 'data center', facility_id: 'test-facility', id: 'test-facility', slug: 'test-facility',
  intent: 'rank markets for a 200 MW AI campus', capacity_mw: 100, country: 'US', metro: 'ashburn',
  target_mw: 200, horizon_months: 24, from: '39.04,-77.48', to: '38.90,-77.03',
  question: 'What is driving data center demand in Northern Virginia?',
};

// Our own traffic must not be published as external demand: `dchub` + `probe`
// satisfy server.mjs _INTERNAL_SELF_TAG, and the tag rides x-mcp-platform on
// EVERY request (r-ci-selftag). --as-chatgpt drops the self-tag and sends what
// ChatGPT sends instead (its UA and an openai/session _meta), which is the path
// a directory reviewer takes; use it for one-off verification runs only, since
// those calls count as ChatGPT connector traffic.
export const SELF_TAG = 'dchub-directory-probe';
export const CHATGPT_HEADERS = { 'user-agent': 'openai-mcp/1.0.0', 'x-mcp-platform': 'chatgpt' };
// A fresh session per run: a fixed id made every run inside the hour share one
// server-side session, so one run's calls counted against the next.
export const CHATGPT_META = { 'openai/session': `v1/probe-${randomUUID()}` };
const AS_CHATGPT = process.argv.includes('--as-chatgpt');
const MIN_DATA_ANSWERS = 20;

async function rpc(url, body) {
  if (AS_CHATGPT && body && body.params) body.params._meta = { ...CHATGPT_META };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               ...(AS_CHATGPT ? CHATGPT_HEADERS
                              : { 'user-agent': `${SELF_TAG}/1.0`, 'x-mcp-platform': SELF_TAG }) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  let msg = null;
  try { msg = JSON.parse(b); } catch (_) { /* reported as non-JSON below */ }
  return { status: res.status, headers: res.headers, raw, msg };
}

async function main() {
  const url = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'https://dchub.cloud/mcp/chatgpt';
  const failures = [];
  const init = await rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: AS_CHATGPT ? 'openai-mcp' : SELF_TAG, version: '1.0' } } });
  if (init.headers.get('mcp-session-id')) failures.push('initialize returned an Mcp-Session-Id');
  for (const h of probeHits(init.raw)) failures.push(`initialize: ${h}`);

  const list = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = (list.msg && list.msg.result && list.msg.result.tools) || [];
  if (!tools.length) failures.push(`tools/list returned no tools (HTTP ${list.status})`);
  for (const v of annotationViolations(tools)) failures.push(`annotations ${v}`);
  for (const h of probeHits(list.raw)) failures.push(`tools/list: ${h}`);

  let gated = 0;
  let rateLimited = 0;
  let dataAnswers = 0;
  let sample = null;
  let id = 10;
  const queue = [];
  for (const t of tools) {
    const variants = t.name === 'subscribe_digest' ? [{}] : [{}, GUESS_ARGS];
    for (const args of variants) queue.push({ name: t.name, args });
  }
  const worker = async () => {
    while (queue.length) {
      const { name, args } = queue.shift();
      const r = await rpc(url, { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } });
      const tag = `${name} ${args === GUESS_ARGS ? '(args)' : '(no args)'}`;
      for (const h of probeHits(r.raw)) failures.push(`${tag}: ${h}`);
      if (!r.msg) failures.push(`${tag}: non-JSON response HTTP ${r.status}`);
      // A run whose calls were all refused proves nothing about the answers,
      // so count what actually came back instead of reading silence as clean.
      const kind = classifyResponse(r.raw, r.msg);
      if (kind === 'refused') rateLimited += 1;
      else if (kind === 'data') dataAnswers += 1;
      if (r.raw.includes('dchub.cloud/plans')) {
        gated += 1;
        if (!sample || (args === GUESS_ARGS && r.raw.length < 4000 && r.raw.length > sample.raw.length)) sample = { tag, raw: r.raw };
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  console.log(JSON.stringify({
    url, as: AS_CHATGPT ? 'chatgpt' : SELF_TAG, tools: tools.length, calls: tools.length * 2 - (tools.some((t) => t.name === 'subscribe_digest') ? 1 : 0),
    data_answers: dataAnswers, rate_limited: rateLimited,
    gated_responses: gated, failures: failures.length,
  }));
  for (const f of failures) console.log('FAIL', f);
  if (sample) console.log('SAMPLE_GATED', sample.tag, sample.raw);
  if (failures.length) process.exit(1);
  // Clean but too few real answers: inconclusive, not a pass (exit 3).
  if (dataAnswers < MIN_DATA_ANSWERS) {
    console.log(`INCONCLUSIVE only ${dataAnswers} calls returned data (floor ${MIN_DATA_ANSWERS}); ${rateLimited} were rate-limited. Re-run from another network or later.`);
    process.exit(3);
  }
  process.exit(0);
}

import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
