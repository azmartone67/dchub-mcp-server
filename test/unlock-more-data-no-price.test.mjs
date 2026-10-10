// unlock_more_data states no amount (owner 2026-10-10).
//
// Its copy described the pack as "$10 one-time = 1,000 API credits" in the ladder, the pack line
// after a Pro wall, the plans list and what_unlocks. It now says "a one-time pack of 1,000 API
// credits (usage capacity, not a subscription)"; the checkout page shows the price. This reads
// the served tools/list description on every surface that lists the tool, and drives the tool
// over real HTTP (stub backend on loopback) keyless and with a free key, with and without a Pro
// trigger, with the human relay on and off (off serves the raw ladder line), and with MPP off
// and on. MPP's "$0.50/call" is a different, per-call price and stays (out of scope).
//
// Non-vacuity: every case must offer the pack (the "1,000 API credits" phrase in the text and in
// the plans list) and carry a link, or "no $" would pass on an empty answer.
// Hard-gate qualified: loopback only, no disk writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_HUMAN_RELAY', 'MPP_ENABLED'];
const prevEnv = {};
let httpServer, stub, PORT;

beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const p = req.url.split('?')[0];
        if (p === '/api/v1/relay/short') return res.end(JSON.stringify({ ok: true, url: 'https://dchub.cloud/u/abcdef' }));
        if (p === '/api/v1/keys/validate') {
          return res.end(JSON.stringify({ valid: true, tier: 'free', tier_detail: { effective: 'free' } }));
        }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'unlock-more-data-no-price-test';
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
});

async function post(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'user-agent': 'claude-user', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.parse(b);
}
function strings(o, path = '', out = []) {
  if (typeof o === 'string') out.push([path, o]);
  else if (Array.isArray(o)) o.forEach((v, i) => strings(v, path + '[' + i + ']', out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) strings(v, path + '.' + k, out);
  return out;
}

describe('unlock_more_data description names no amount', () => {
  const SURFACES = ['/mcp', '/mcp/grok', '/mcp/claude', '/mcp/core', '/mcp/chatgpt'];
  it('is listed on /mcp (the check below reads a real description)', async () => {
    const l = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const t = l.result.tools.find((x) => x.name === 'unlock_more_data');
    expect(t && t.description.length).toBeGreaterThan(200);
  });
  it.each(SURFACES)('%s: wherever it is listed, its description has no "$"', async (path) => {
    const l = await post(path, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(Array.isArray(l.result.tools)).toBe(true);
    const t = l.result.tools.find((x) => x.name === 'unlock_more_data');
    if (t) expect(t.description).not.toContain('$');
  });
});

const CASES = [];
for (const path of ['/mcp', '/mcp/grok']) {
  for (const keyed of [false, true]) {
    for (const reason of [null, 'analyze_site returned a preview']) {
      for (const relay of ['1', '0']) {
        for (const mpp of ['', 'true']) {
          CASES.push({ path, reason, relay, mpp,
                       key: keyed ? 'dch_live_unlocknoprice' + String(CASES.length).padStart(4, '0') : null });
        }
      }
    }
  }
}
const label = (c) => `${c.path} ${c.key ? 'free key' : 'keyless'} ${c.reason ? 'after a Pro wall' : 'plain'} relay=${c.relay} mpp=${c.mpp || 'off'}`;

describe.each(CASES.map((c) => [label(c), c]))('unlock_more_data response, %s', (_n, c) => {
  let r;
  beforeAll(async () => {
    process.env.DCHUB_HUMAN_RELAY = c.relay;
    process.env.MPP_ENABLED = c.mpp;
    const headers = c.key ? { 'x-api-key': c.key } : {};
    r = (await post(c.path, { jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'unlock_more_data', arguments: c.reason ? { reason: c.reason } : {} } }, headers)).result;
  });

  it('offers the pack and a link (the check below is not vacuous)', () => {
    const sc = r.structuredContent;
    const text = r.content.map((b) => b.text || '').join('\n');
    expect(text).toMatch(/https:\/\/dchub\.cloud\//);
    expect(sc.human_message).toMatch(/https:\/\/dchub\.cloud\//);
    const credits = (sc.plans || []).find((p) => p.id === 'credits');
    expect(credits && credits.label).toMatch(/^One-time pack of 1,000 API credits \(usage capacity, not a subscription; /);
    if (c.reason) expect(sc.human_message).toContain('a one-time pack of 1,000 API credits (usage capacity, not a subscription)');
    if (c.relay === '0' && !c.reason) expect(sc.human_message).toContain('**a one-time pack of 1,000 API credits (usage capacity, not a subscription)**');
    // With the relay on, the one-link step still folds the unpriced pack rung into the plans page
    // (its regex knows both spellings), so the ladder line carries one link.
    if (c.relay === '1' && !c.reason) {
      expect(sc.user_message).toMatch(/^\*\*the plans that include the full answer\*\* → https:\/\/dchub\.cloud\/upgrade\/h\//);
      expect(sc.human_message).not.toContain('credits don’t expire →');
    }
  });

  it('states no amount in any text or structuredContent string (MPP $0.50/call excepted)', () => {
    const hits = [...strings(r.content, 'content'), ...strings(r.structuredContent, 'structuredContent')]
      .map(([p, s]) => [p, s.split('$0.50/call').join('')])
      .filter(([, s]) => s.includes('$')).map(([p, s]) => p + ': ' + s.slice(Math.max(0, s.indexOf('$') - 80), s.indexOf('$') + 40));
    expect(hits).toEqual([]);
  });
});
