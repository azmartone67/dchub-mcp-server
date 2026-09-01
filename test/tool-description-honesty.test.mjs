// ── a tool description may not promise what the payload does not carry ──────
//
// THE DEFECT (measured live 2026-09-01, free tier, dchub.cloud/mcp)
// Three tools described a payload they do not serve:
//
//   get_backup_status   promised "database backup status, data freshness across
//                       49 sources, agentic heartbeat score (0-100), MCP call
//                       volume (last hour), and DCPI recompute cadence".
//                       Returned: 9 feeds and a summary rollup. None of the
//                       other four fields exists. The handler is a bare
//                       passthrough to /api/health/data-freshness — the route
//                       was corrected off /api/v1/stats in v2.1.0 (see the
//                       migration block at the top of server.mjs) and the
//                       description was never moved with it.
//
//   get_agent_registry  promised "recognized MCP clients include Claude and
//                       Cursor". The live roster returned 11 platforms and
//                       Cursor is not among them. An enumeration in a
//                       description cannot track a backend-owned list.
//
//   get_gas_economics   promised "gas_to_grid_status carries the reason".
//                       The handler builds its output from an explicit field
//                       ALLOWLIST and never copied g2g.gas_to_grid_status, so
//                       the withdrawn $/MWh arrived as SILENT absence: four
//                       $/MMBtu layers, no $/MWh, and nothing saying why.
//
// ★ WHY THE THIRD ONE IS THE SERIOUS ONE. The other two mislead a reader. This
// one destroys a signal that was deliberately built: gas_to_grid_status exists
// precisely so the withdrawal is DECLARED rather than inferred. Without it an
// agent cannot tell "withdrawn on purpose 2026-08-08" from "this endpoint is
// broken this morning" — the same conflation #289 removed from the About-field
// step, where a failed READ was reported as a drift VERDICT.
//
// ★ WHY THIS SUITE RUNS THE TOOL INSTEAD OF GREPPING FOR THE FIELD NAME. A
// source guard would pass the moment someone types the string anywhere in
// server.mjs. Before this commit `gas_to_grid_status` DID appear in the file —
// twice — in the two description strings that promised it, and in no code path
// at all. Grepping for it would have reported the contract as kept at the exact
// moment it was broken. So the tests below boot the app, point it at a stub
// backend, and assert on what the tool ACTUALLY RETURNED.
//
// Deterministic and offline: the stub listens on 127.0.0.1 and DCHUB_API_BASE
// is pointed at it before server.mjs is imported (the module captures API_BASE
// once at evaluation), then restored so a sibling test in this worker cannot
// inherit it — same discipline as required-args / capacity-context.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

let S, PORT, httpServer, stub, STUB_PORT, TOOLS;

// What the stubbed /gas-to-grid endpoint returns next. Each test sets it.
let g2gPayload = {};
let pricingPayload = {};

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    const url = req.url || '';
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.includes('/gas-to-grid')) return res.end(JSON.stringify(g2gPayload));
    if (url.includes('/gas-pricing')) return res.end(JSON.stringify(pricingPayload));
    return res.end('{}');            // telemetry, key validation, anything else
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  STUB_PORT = stub.address().port;

  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${STUB_PORT}`;
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;

  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
  TOOLS = await rpc('tools/list', {}).then((r) => (r.result || {}).tools || []);
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
});

async function rpc(method, params) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return JSON.parse(json);
}

async function callTool(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = (((r.result || {}).content || [])[0] || {}).text || '{}';
  try { return JSON.parse(text); } catch { return { __raw: text }; }
}

const descOf = (n) => (TOOLS.find((t) => t.name === n) || {}).description || '';

// ── the fix: a withdrawal must arrive DECLARED, never as silence ────────────
describe('get_gas_economics forwards gas_to_grid_status', () => {
  it('forwards the backend status VERBATIM, whatever shape it is', async () => {
    // Deliberately an unusual shape. The server must not reinterpret, reshape
    // or summarise it — the shape belongs to the backend.
    const exotic = { available: false, reason: 'withdrawn 2026-08-08', nested: { a: [1, 2] } };
    pricingPayload = { delivered_electric_usd_mmbtu: 1.9 };
    g2gPayload = { gas_to_grid_status: exotic };
    const out = await callTool('get_gas_economics', { market: 'dallas' });
    expect(out.gas_to_grid_status).toEqual(exotic);
  });

  it('declares UNMEASURED when the backend gives neither a $/MWh nor a status', async () => {
    // This is the live shape as of 2026-09-01 and the one that was silent.
    pricingPayload = { delivered_electric_usd_mmbtu: 1.9 };
    g2gPayload = {};
    const out = await callTool('get_gas_economics', { market: 'dallas' });
    expect(out.gas_to_grid_status, 'absence must be declared, never silent').toBeTruthy();
    expect(out.gas_to_grid_status.available).toBe(false);
    expect(out.gas_to_grid_status.reason).toMatch(/UNMEASURED/);
  });

  it('does NOT invent a withdrawal notice it was never given', async () => {
    // The honest verdict for an unexplained absence is "we do not know why".
    // Claiming a dated withdrawal the backend never stated would be the same
    // error class as reporting drift from a read that failed.
    pricingPayload = {};
    g2gPayload = {};
    const out = await callTool('get_gas_economics', { market: 'dallas' });
    expect(out.gas_to_grid_status.reason).not.toMatch(/2026-08-08|withdrawn on/i);
    expect(out.gas_to_grid_status.reason).toMatch(/not explained|UNMEASURED/i);
  });

  it('stays quiet when a $/MWh IS returned — nothing to declare', async () => {
    pricingPayload = { delivered_electric_usd_mmbtu: 1.9 };
    g2gPayload = { scenarios_usd_per_mwh: { ccgt: 31.2 } };
    const out = await callTool('get_gas_economics', { market: 'dallas' });
    expect(out.scenarios_usd_per_mwh).toEqual({ ccgt: 31.2 });
    expect(out.gas_to_grid_status).toBeUndefined();
  });

  it('declares even when the gas-to-grid read itself failed', async () => {
    pricingPayload = { delivered_electric_usd_mmbtu: 1.9 };
    g2gPayload = { error: 'upstream 502' };
    const out = await callTool('get_gas_economics', { market: 'dallas' });
    expect(out.gas_to_grid_status, 'a failed read is still not silence').toBeTruthy();
  });

  // ★ THE PAIRING INVARIANT — the one that generalises. If a description names
  // a response field, the tool must be able to produce it. This is the exact
  // contract that was broken, stated once so it cannot break silently again.
  it('the field the description NAMES is a field the tool can RETURN', async () => {
    const d = descOf('get_gas_economics');
    expect(d, 'control: the description must still name the field').toContain('gas_to_grid_status');
    pricingPayload = {};
    g2gPayload = {};
    const out = await callTool('get_gas_economics', { market: 'dallas' });
    expect(Object.keys(out)).toContain('gas_to_grid_status');
  });
});

// ── the two descriptions that outlived their endpoint ───────────────────────
describe('get_backup_status describes the endpoint it actually reads', () => {
  const GONE = [
    [/database backup status/i,        'database backup state'],
    [/heartbeat score/i,               'agentic heartbeat score'],
    [/call volume/i,                   'MCP call volume'],
    [/recompute cadence/i,             'DCPI recompute cadence'],
    [/\b49 sources\b/i,                'a hardcoded source count'],
  ];
  for (const [re, what] of GONE) {
    it(`no longer claims ${what}`, () => {
      expect(descOf('get_backup_status'), `still promises ${what}, which /api/health/data-freshness does not serve`)
        .not.toMatch(re);
    });
  }
  it('still says something useful (anti-vacuous control)', () => {
    const d = descOf('get_backup_status');
    expect(d).toMatch(/freshness/i);
    expect(d).toMatch(/get_changes/);              // still routes the neighbouring question
    expect(d.length).toBeGreaterThan(200);         // not emptied to pass the rules above
  });
});

describe('get_agent_registry does not enumerate a backend-owned roster', () => {
  it('names no specific client as recognized', () => {
    // Cursor was named here and is absent from the live roster. Any hardcoded
    // client name will drift the same way the moment the backend list moves.
    expect(descOf('get_agent_registry')).not.toMatch(/\bCursor\b|\bCline\b|\bContinue\b/);
  });
  it('warns that the statuses are editorial, not measured', () => {
    // The response carries as_of: null. A reader must not relay "MCP Active"
    // as a live connection count.
    const d = descOf('get_agent_registry');
    expect(d).toMatch(/as_of null|not measurements|EDITORIAL/i);
  });
  it('still points at the response as the source of truth (anti-vacuous control)', () => {
    expect(descOf('get_agent_registry')).toMatch(/platforms\[\]/);
  });
});
