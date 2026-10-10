// gated-text-carries-human-link.test.mjs — r-gated-text-human-link (2026-10-01)
//
// Contract: a keyless call to a gated tool must carry the human relay line in
// content[].text, not only in structuredContent. Grok's reading (2026-10-01)
// was that some gated tools put the /upgrade/h/ link only in structuredContent;
// a client that renders the text block (the common case for a summarising
// agent) then has nothing to hand its human. This pins the invariant over the
// repo's own handler path (real /mcp handler, loopback stub backend, no
// network) for EVERY paid/metered tool in toolspec.json plus the two
// free_preview tools named in the finding.
//
// It does NOT assert placement: data leads and the relay line trails (see the
// r-data-first comments in server.mjs). It asserts presence + exactly one
// human ask: HUMAN_FIRST_MARKER occurs exactly once in the text blocks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import fs from 'node:fs';

// HARD GATE, NO NETWORK: refuse every non-loopback connect (same guard as
// automint-trial-rungs.test.mjs); the last test fails if one was attempted.
const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const SECRET = 'test-internal-key-not-a-real-secret';
const SPEC = JSON.parse(fs.readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8'));
const NAMED = ['get_market_dcpi_rank', 'unlock_more_data'];
// The Pro-only wall's own one-sentence user line (lib/wall-user-line.mjs,
// pinned by paywall-contract.test.mjs) is a deliberate alternative to the relay
// line on error walls: one sentence, one link, in the text block. It is the
// response's one human ask, so it counts as the human line here.
// v13 (owner 2026-10-10): the Pro-only line reads "Start a 7-day trial:" (no plan name).
const WALL_USER_LINE = /(?:, your user can open|Start a 7-day trial:) https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c)\//;
const LINK = /https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c)\//g;

let S, PORT, httpServer, stub, prevBase, prevSecret, GATED;

const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: 100 + i, name: `Site ${i}`, region_id: 'PJM', iso: 'PJM', score: 50 + i,
  lat: 39 + i / 10, lon: -77 - i / 10, city: 'Ashburn', state: 'VA', country: 'US',
}));

// Minimal valid arguments from the tool's own inputSchema.
function argsFor(schema) {
  const out = {};
  const props = (schema && schema.properties) || {};
  for (const k of (schema && schema.required) || []) {
    const p = props[k] || {};
    if (p.enum) out[k] = p.enum[0];
    else if (p.type === 'number' || p.type === 'integer') out[k] = p.minimum ?? 1;
    else if (p.type === 'boolean') out[k] = false;
    else if (p.type === 'array') out[k] = [];
    else if (p.type === 'object') out[k] = {};
    else if (/slug|market/.test(k)) out[k] = 'ashburn';
    else if (/iso|region/.test(k)) out[k] = 'PJM';
    else out[k] = 'PJM';
  }
  return out;
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      req.resume();
      if (url.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      if (url.pathname === '/api/v1/keys/auto-mint') { res.statusCode = 503; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS,
                               demand_mw: 18000, generation_mix: { NG: { mw: 9000 } } }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  // The paywall class the relay branch in trackedTool keys on (A2 split it
  // from the advertised `access`, which now also reads paid for Pro tools the
  // paywall does not gate, e.g. export_dataset).
  GATED = SPEC.map((t) => t.name).filter((n) =>
    ['paid', 'metered'].includes(S._accessGateClass(n)) || NAMED.includes(n));
});

afterAll(async () => {
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function rpc(body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'x-dc-client-ip': '198.51.100.77' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const j = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return JSON.parse(j).result || {};
}

let id = 1;
async function callTool(name) {
  const spec = SPEC.find((t) => t.name === name);
  const r = await rpc({ jsonrpc: '2.0', id: id++, method: 'tools/call',
                        params: { name, arguments: argsFor(spec.inputSchema) } });
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  return { r, text, sc: JSON.stringify(r.structuredContent || null) };
}

describe('a keyless gated response carries the relay line in the TEXT block', () => {
  it('the population is real (not a vacuous empty loop)', () => {
    expect(GATED.length).toBeGreaterThanOrEqual(25);
    for (const n of NAMED) expect(GATED).toContain(n);
  });

  it('every gated tool: any human link in the response means exactly one relay line in content[].text', async () => {
    const gaps = [];
    const dupes = [];
    let withLink = 0;
    for (const name of GATED) {
      const { text, sc } = await callTool(name);
      const anywhere = (text.match(LINK) || []).length + (sc.match(LINK) || []).length;
      if (!anywhere) continue;               // no wall in this response: nothing to relay
      withLink += 1;
      const lines = text.split('\n').filter((l) => l.includes(S.HUMAN_FIRST_MARKER) || WALL_USER_LINE.test(l));
      if (lines.length === 0) gaps.push(name);
      if (lines.length > 1) dupes.push(name);
      if (lines.length === 1) {
        expect(lines[0], `${name}: human line has no human link`).toMatch(/https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c)\//);
        // The text link is also what structuredContent carries, and the payload
        // survived the trailing line (it is not parsed from the text any more).
        const href = (lines[0].match(/https:\/\/dchub\.cloud\/(?:upgrade\/h|go\/c)\/[^\s)>\]"]+/) || [''])[0];
        if (href.includes('/upgrade/h/')) {
          expect(sc.includes(href), `${name}: text relay link differs from structuredContent's`).toBe(true);
        }
        expect(sc === 'null' || sc.length > 40, `${name}: structuredContent lost its payload`).toBe(true);
      }
    }
    // Non-vacuity: the stub must have produced walls for a real share of tools.
    expect(withLink, 'too few gated responses carried a wall; the loop proved nothing').toBeGreaterThanOrEqual(15);
    expect(gaps, `gated responses with a link but no relay line in text: ${gaps}`).toEqual([]);
    expect(dupes, `gated responses with more than one relay line: ${dupes}`).toEqual([]);
  }, 120000);

  it.each(NAMED)('%s: relay line is in text, once', async (name) => {
    const { text } = await callTool(name);
    expect(text.split(S.HUMAN_FIRST_MARKER).length - 1).toBe(1);
  }, 30000);

  it('no non-loopback connection was attempted', () => {
    expect(foreign).toEqual([]);
  });
});
