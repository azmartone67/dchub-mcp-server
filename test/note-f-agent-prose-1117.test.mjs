// note-f-agent-prose-1117.test.mjs -- owner rule "note F, option A" (2026-11-17): agent-facing prose carries no
// price, plan name, "free tier", "higher limits", credits or calls-per-day wording. Measured live the same night on
// three surfaces this guard reads through the real express app:
//   1. initialize instructions: "KEYS: ... `claim_free_key`; save it ..." and "Both are free." (INSTR_FEEDBACK_LINE,
//      lib/claude-directory.mjs);
//   2. tools/list descriptions: claim_free_key / bind_email "WHAT AN EMAIL GETS (no card): 50 calls/day (up to 10
//      full answers per tool per day)", unlock_more_data "(previews plus 2 full answers per tool per day, 50/day with
//      an email)";
//   3. claim_free_key (no email): structuredContent.free_tier_rule "... With an email: 50 calls/day ... Higher limits:
//      dchub.cloud/pricing.", free_tier_decision_tools "previews on free; an email adds 10 full answers/day each",
//      "Free DC Hub dev key minted", "Your free key includes get_changes", "binding lifts it to 50 calls/day".
// They now say what the key KEEPS (lib/continuity-ask.mjs, the continuity wording of mcp#1524).
//
// Exempt: the tool NAME fields (name, the literal token claim_free_key; a title is the name title-cased), object
// KEYS (free_tier_rule and friends stay: renaming them breaks clients), and "free" in a data sense, the same
// carve-outs test/tool-descriptions-no-plan-or-price.test.mjs already makes (free-text parameters, retiring plants
// that free grid capacity, "about to free up", free county/state GIS polygons).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { offerWording } from '../lib/neutral-connect.mjs';

// ── the matchers ─────────────────────────────────────────────────────────────────────────────────────────────
export const NOTE_F_BANNED = [
  /\bfree\b(?![- ]text\b)(?! grid capacity\b)(?! up\b)(?! county\/state GIS\b)/i,
  /calls\/day/i,
  /credits/i,
  /higher limits/i,
  /wholesale power prices/i,
];
// The tool names are not prose: claim_free_key is exempt wherever it is written.
const NAME_TOKENS = /\bclaim_free_key\b/g;
export function noteFHits(s) {
  if (typeof s !== 'string' || !s) return [];
  const t = s.replace(NAME_TOKENS, 'TOOLNAME');
  const out = [];
  for (const re of NOTE_F_BANNED) {
    const m = re.exec(t);
    if (m) out.push(String(re) + ': "' + t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 30).replace(/\s+/g, ' ') + '"');
  }
  // lib/neutral-connect.mjs's offer wording (one-time pack, N/day, free key, $10 one-time ...) as well.
  if (offerWording(t)) out.push('offerWording: "' + t.slice(0, 120).replace(/\s+/g, ' ') + '"');
  return out;
}
// Every string VALUE in a JSON tree (keys are field names, exempt).
function values(o, acc = [], d = 0) {
  if (d > 40 || o == null) return acc;
  if (typeof o === 'string') acc.push(o);
  else if (Array.isArray(o)) o.forEach((x) => values(x, acc, d + 1));
  else if (typeof o === 'object') Object.values(o).forEach((v) => values(v, acc, d + 1));
  return acc;
}

// ── a real server behind a stub backend ─────────────────────────────────────────────────────────────────────
const _realFetch = globalThis.fetch;
const BLOCKED = [];
const MINTED = 'dch_live_notef_guard_00000000000001';
let S, PORT, httpServer, stub;
beforeAll(async () => {
  globalThis.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(u)) { BLOCKED.push(u.slice(0, 120)); return Promise.reject(new Error('fenced')); }
    return _realFetch(input, init);
  };
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/keys/claim') return res.end(JSON.stringify({ ok: true, api_key: MINTED, tier: 'free' }));
      if (url.pathname === '/api/v1/keys/validate') return res.end(JSON.stringify({ valid: false, tier: 'free' }));
      return res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60000);
afterAll(async () => {
  globalThis.fetch = _realFetch;
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

async function post(path, headers, body) {
  const res = await _realFetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  const raw = await res.text();
  const json = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json };
}
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'note-f-guard', version: '1.0' } };
async function session(path) {
  const init = await post(path, {}, { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT });
  const sid = init.headers.get('mcp-session-id');
  const h = sid ? { 'mcp-session-id': sid } : {};
  if (sid) await post(path, h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  let instructions = '';
  try { instructions = JSON.parse(init.json).result.instructions || ''; } catch (_) { /* no body */ }
  return { sid, h, instructions };
}
async function listTools(path) {
  const { sid, h, instructions } = await session(path);
  const r = await post(path, h, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  if (sid) S._releaseSession(sid);
  let tools = [];
  try { tools = JSON.parse(r.json).result.tools || []; } catch (_) { tools = []; }
  return { tools, instructions };
}
async function claimNoEmail(path) {
  const { sid, h } = await session(path);
  const r = await post(path, h, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claim_free_key', arguments: {} } });
  if (sid) S._releaseSession(sid);
  return JSON.parse(r.json).result || {};
}

const PATHS = ['/mcp', '/mcp?catalog=full', '/mcp/oauth', '/mcp/registry', '/mcp/grok', '/mcp/core', '/mcp/claude', '/mcp/chatgpt'];

describe('the matchers can fail (not vacuous)', () => {
  it('flag every string the owner saw live on 11-17', () => {
    for (const bad of [
      "call request_enhancement. Both are free.",
      'WHAT AN EMAIL GETS (no card): 50 calls/day (up to 10 full answers per tool per day)',
      'previews plus 2 full answers per tool per day, 50/day with an email',
      'With an email: 50 calls/day (up to 10 full answers per tool per day). Higher limits: dchub.cloud/pricing.',
      'Grid/queue/market-intel tools: previews on free; an email adds 10 full answers/day each.',
      '✅ **Free DC Hub dev key minted for `mcp-agent`**',
      'Your free key includes get_changes.',
      'relay the link in its human_url to your human (a one-time pack of 1,000 API credits).',
      'joined with wholesale power prices for the same place',
    ]) expect(noteFHits(bad), bad).not.toEqual([]);
  });
  it('leave the tool names, data-sense "free" and the continuity lines alone', () => {
    for (const ok of [
      'KEYS: get your human\'s email, then `claim_free_key`: the key keeps saved shortlists, alerts and tracked changes',
      'Use this when the user asks where retiring power plants free grid capacity:', 'about to free up',
      'Free-text search over facility name', '(free county/state GIS polygons, covering a set', 'More detail is available at dchub.cloud/connect.',
    ]) expect(noteFHits(ok), ok).toEqual([]);
  });
});

describe('initialize instructions and tools/list descriptions carry none of it', () => {
  it.each(PATHS)('%s', async (path) => {
    const { tools, instructions } = await listTools(path);
    expect(instructions.length, `${path} served no instructions`).toBeGreaterThan(0);
    expect(tools.length, `${path} served no tools`).toBeGreaterThan(0);
    const bad = noteFHits(instructions).map((x) => 'instructions ' + x);
    for (const t of tools) for (const x of noteFHits(t.description)) bad.push(t.name + ' ' + x);
    expect(bad).toEqual([]);
  }, 30000);
  it('the key line is the continuity line and the tool names stay', async () => {
    const { instructions } = await listTools('/mcp');
    expect(instructions).toContain('`get_api_key`: the key keeps saved shortlists, alerts and tracked changes (get_changes) across sessions');
    expect(instructions).toContain('`recover_my_key` re-sends a lost one');
    expect(instructions).not.toContain('Both are free');
  }, 30000);
});

describe('claim_free_key (no email)', () => {
  it('still resolves under the same name, next to bind_email and unlock_more_data', async () => {
    const names = new Set((await listTools('/mcp?catalog=full')).tools.map((t) => t.name));
    for (const n of ['get_api_key', 'bind_email', 'unlock_more_data', 'recover_my_key']) expect(names.has(n), n).toBe(true);
    const r = await claimNoEmail('/mcp');
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent.api_key).toBe(MINTED);
  }, 30000);
  it.each(['/mcp', '/mcp/grok'])('%s: structuredContent and content carry none of it', async (path) => {
    const r = await claimNoEmail(path);
    expect(r.structuredContent && r.structuredContent.api_key).toBe(MINTED);
    const bad = [];
    for (const s of values(r.structuredContent)) for (const x of noteFHits(s)) bad.push('sc ' + x);
    (r.content || []).forEach((b, i) => { for (const x of noteFHits(b.text)) bad.push(`content[${i}] ` + x); });
    expect(bad).toEqual([]);
    // the field names stay; their values say what the key keeps
    expect(r.structuredContent.free_tier_rule).toMatch(/keeps your saved shortlists, alerts and the changes you track/);
    expect(r.structuredContent.return_hook).toMatch(/^This key keeps get_changes working across sessions/);
  }, 30000);
  it('no socket left loopback', () => { expect(BLOCKED).toEqual([]); });
});
