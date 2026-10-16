// analyze-site-free-line.test.mjs — item 2 (owner, 2026-10-14): the analyze_site
// exemption to the published free-tier rule.
//
// The rule says "Free key: previews plus 2 full answers per tool per day". analyze_site
// is not that: a free key runs it in full a few times per UTC month (LP free runs, owner
// 2026-10-10), then previews. The analyze_site wall already said "a few free full site
// reports each month", so an agent reading the rule and then the wall read two different
// allowances (Grok catch-up 2026-10-12, item 2).
//
// WHAT THIS PINS
//   * ANALYZE_SITE_FREE_LINE is the owner's 2026-10-11 sentence byte for byte (dchub-backend
//     ai_surface_canon ANALYZE_SITE_FREE_LINE), with no number in it (decision 2: "a few");
//   * it is never joined into the rule: _freeTierRuleText() stays the pinned D2/B1 sentence;
//   * the full instructions (served as dchub://instructions) carry it right after the FREE
//     TIER block, and drop it when DCHUB_LP_FREE_RUNS=0, so the text never promises runs
//     the gate does not grant;
//   * the frozen directory profiles (/mcp/chatgpt in OpenAI review, /mcp/claude, /mcp/core)
//     do not carry it: they serve their own strings;
//   * every repo doc that quotes the free-tier rule as the free-tier summary carries it
//     right after the decision-tools clause, and mcp-server.json right after the rule.
//
// Not pinned: the lean initialize handshake. At 93 characters the line puts /mcp/grok and
// every pack path over the 2,048 budget (test/initialize-instructions-length.test.mjs), so
// whether the handshake carries it is an open owner call.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_LINE = 'analyze_site: a free key gets a few free full site reports each month; after that, previews.';
// Item 3 (owner draft 2026-10-16): the decision-tools clause now states the email allowance.
const CLAUSE = 'previews on free; an email adds 3 full grid/queue answers/day';

let S, TC, httpServer, stub, PORT, prevBase;

async function rpc(path, method, params, session) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: 1 }), method, params }),
  });
  const raw = await res.text();
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  let json = null;
  try { json = JSON.parse(body); } catch (_) { /* a notification answers 202 with no body */ }
  return { json, session: res.headers.get('mcp-session-id') };
}
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'analyze-site-free-line-test', version: '1' } };

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{}'); }); });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  TC = await import('../lib/tier-canon.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

describe('the sentence', () => {
  it('is the owner wording, byte for byte, with no number', () => {
    expect(TC.ANALYZE_SITE_FREE_LINE).toBe(OWNER_LINE);
    expect(TC.ANALYZE_SITE_FREE_LINE).not.toMatch(/\d/);
  });
  it('never joins the pinned rule', () => {
    expect(TC._freeTierRuleText()).not.toContain('site reports');
    expect(TC._freeTierRuleText()).toMatch(/ Paid plans: dchub\.cloud\/pricing\.$/);
    expect(S._INSTR_FREE_TIER).not.toContain('site reports');
  });
  it('follows the monthly free runs switch', () => {
    expect(S._analyzeSiteFreeSentence({})).toBe(OWNER_LINE);
    for (const off of ['0', 'false', 'no', 'OFF']) {
      expect(S._analyzeSiteFreeSentence({ DCHUB_LP_FREE_RUNS: off }), off).toBe('');
    }
  });
});

describe('instructions', () => {
  it('the full text carries it right after the FREE TIER block', () => {
    expect(S._INSTR_FREE_TIER.length).toBeGreaterThan(40);
    expect(S._INSTRUCTIONS).toContain(S._INSTR_FREE_TIER + ' ' + OWNER_LINE);
  });
  it('dchub://instructions serves it, as read over /mcp', async () => {
    const { session } = await rpc('/mcp', 'initialize', INIT);
    expect(session, 'initialize returned no mcp-session-id').toBeTruthy();
    await rpc('/mcp', 'notifications/initialized', {}, session);
    const r = (await rpc('/mcp', 'resources/read', { uri: S.INSTRUCTIONS_RESOURCE_URI }, session)).json;
    const text = (r?.result?.contents || []).map((c) => c.text || '').join('');
    expect(text.length, JSON.stringify(r).slice(0, 300)).toBeGreaterThan(1000);
    expect(text).toContain(S._INSTR_FREE_TIER + ' ' + OWNER_LINE);
  });
  it('the frozen directory profiles do not carry it', async () => {
    for (const p of ['/mcp/chatgpt', '/mcp/claude', '/mcp/core']) {
      const ins = (await rpc(p, 'initialize', INIT)).json?.result?.instructions;
      expect(typeof ins, p).toBe('string');
      expect(ins, p).not.toContain('site reports each month');
    }
  });
});

describe('repo docs', () => {
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  // smithery.yaml's pricing row is one ;-separated string, so the sentence sits there without its period.
  const LINE = OWNER_LINE.slice(0, -1);
  it('each free-tier summary carries it right after the decision-tools clause', () => {
    const docs = ['README.md', 'REGISTRY-LISTINGS.md', 'integrations/README.md', 'llms-install.md',
      'npm-launcher/README.md'];
    for (const p of docs) expect(read(p), p).toContain(CLAUSE + '. ' + OWNER_LINE);
    expect(read('smithery.yaml')).toContain(CLAUSE + '; ' + LINE + '"');
  });
  it('mcp-server.json carries it right after the rule', () => {
    const d = JSON.parse(read('mcp-server.json')).description;
    expect(d).toContain(TC._freeTierRuleText() + ' ' + OWNER_LINE);
  });
});
