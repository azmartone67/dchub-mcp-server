// tools/value_harness_classify.py + tools/mcp_value_harness.sh (2026-11-22).
// From at least 2026-11-13 DC Hub refused the harness key, every call was walled, and the job stayed green:
// the wall's text is prose, which the old check filed as CI rate-limit noise. These pin the new verdicts and
// run the real script against a local fake gateway so a refused key, a gated preview or a zero-pass run
// cannot read green again.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLASSIFY = path.join(ROOT, 'tools', 'value_harness_classify.py');
const HARNESS = path.join(ROOT, 'tools', 'mcp_value_harness.sh');

const env = (sc, text) => JSON.stringify({ jsonrpc: '2.0', id: 2, result: {
  content: [{ type: 'text', text: text ?? JSON.stringify(sc) }], ...(sc ? { structuredContent: sc } : {}) } });
const classify = (raw, rk) => execFileSync('python3', [CLASSIFY, rk], { input: raw }).toString().trim();

const REFUSED = { iso: 'PJM', demand_mw: 89684,
  identity: { credential_source: 'header', tier: 'anonymous', credential_refused: 'rejected' },
  completeness: { status: 'partial', kind: 'taste', withheld: ['capacity'] } };
const GATED = { demand_mw: 89684, completeness: { status: 'partial', kind: 'taste', withheld: ['capacity'] } };
const FULL = { demand_mw: 89684, provenance: { completeness: 'unrestricted' } };

describe('value_harness_classify.py', () => {
  it('a refused key is AUTH, even when the preview carries the required key', () => {
    expect(classify(env(REFUSED, 'demand 89,684 MW (DC Hub). Withheld here: ...'), 'demand_mw')).toBe('AUTH:key-refused(rejected)');
  });
  it('a gated preview is GATED, not PASS on the teaser value', () => {
    expect(classify(env(GATED), 'demand_mw')).toBe('GATED:taste');
    expect(classify(env({ demand_mw: 1, free_preview_only: true }), 'demand_mw')).toBe('GATED:preview');
  });
  it('a full answer passes from structuredContent or from the text JSON', () => {
    expect(classify(env(FULL), 'demand_mw')).toBe('PASS');
    expect(classify(env({ next_session: {} }, JSON.stringify({ transactions: [{ id: 1 }] })), 'transactions')).toBe('PASS');
  });
  it('a full answer with the required key empty is a REGRESSION', () => {
    expect(classify(env({ data: [], market: 'x' }), 'data')).toMatch(/^REGRESSION:empty\(data\)/);
  });
  it('CI noise stays TRANSIENT', () => {
    expect(classify('', 'data')).toBe('TRANSIENT:empty-response');
    expect(classify('<html>', 'data')).toBe('TRANSIENT:non-json');
    expect(classify(env(null, 'Too many requests'), 'data')).toBe('TRANSIENT:text-not-json');
    expect(classify(env({ error: 'rate limited' }), 'data')).toBe('TRANSIENT:error-envelope');
  });
});

// A fake gateway: initialize hands out a session id; tools/call answers with `mode`'s body as SSE.
function fakeGateway(bodyFor) {
  return http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const m = JSON.parse(b || '{}');
      if (m.method === 'initialize') { res.setHeader('mcp-session-id', 'fake-sid'); res.end('event: message\ndata: {"result":{}}\n\n'); return; }
      if (m.method !== 'tools/call') { res.statusCode = 202; res.end(); return; }
      res.setHeader('content-type', 'text/event-stream');
      res.end(`event: message\ndata: ${bodyFor(m.params.name)}\n\n`);
    });
  });
}
const REQ = { get_grid_intelligence: 'demand_mw', get_market_intel: 'market', get_energy_prices: 'avg_rate_kwh',
  search_facilities: 'data', hyperscaler_deals: 'deals', get_fiber_intel: 'features', get_grid_scoreboard: 'grids',
  list_transactions: 'transactions', get_interconnection_queue: 'project_count', get_pipeline: 'data' };

function runHarness(port) {
  return new Promise((resolve) => {
    const p = spawn('bash', [HARNESS], { env: { ...process.env, DCHUB_MCP_URL: `http://127.0.0.1:${port}/mcp`, DCHUB_MCP_KEY: 'dchub_live_test_only', DCHUB_HARNESS_PAUSE: '0' } });
    let out = ''; p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { out += c; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

describe('mcp_value_harness.sh end to end (fake gateway)', () => {
  let srv; let mode = 'full';
  beforeAll(async () => {
    srv = fakeGateway((tool) => {
      if (mode === 'refused') return env(REFUSED, 'Withheld here: ...');
      if (mode === 'walled-prose') return env(null, 'You have used your free calls. Connect at https://dchub.cloud/connect');
      return env({ [REQ[tool]]: [{ ok: 1 }] });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  });
  afterAll(() => new Promise((r) => srv.close(r)));

  it('a refused key fails at the first tool, names the secret, never prints the key', async () => {
    mode = 'refused';
    const { code, out } = await runHarness(srv.address().port);
    expect(code).toBe(1);
    expect(out).toContain('::error::value-harness: DC Hub refused the DCHUB_MCP_PAID_KEY key (key-refused(rejected))');
    expect(out).not.toContain('dchub_live_test_only');
    expect(out).not.toContain('get_market_intel');   // stopped after the first tool
  }, 60000);

  it('a run where every answer is skipped as noise fails instead of reading green', async () => {
    mode = 'walled-prose';
    const { code, out } = await runHarness(srv.address().port);
    expect(code).toBe(1);
    expect(out).toContain('no tool passed');
    expect(out).not.toContain('ALL GREEN');
  }, 60000);

  it('full answers pass', async () => {
    mode = 'full';
    const { code, out } = await runHarness(srv.address().port);
    expect(code).toBe(0);
    expect(out).toContain('ALL GREEN (10 passed');
  }, 60000);
});
