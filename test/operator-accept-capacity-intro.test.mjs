// ── accept_capacity_intro: the operator side of a deal registration ─────────
//
// The operator of a Capacity Source listing accepts a buyer's registration by
// lead id; the backend writes the acceptance into the lead register and returns
// a receipt. The switch is the backend's DCHUB_OPERATOR_TERMS_V1: while it is
// off the backend answers 404 not_enabled. Pinned here, against a real
// createServer() with the network stubbed:
//   * the backend's not_enabled answer reaches the agent as a structured refusal;
//   * nothing reaches the backend without confirm=true and a register-shaped lead id,
//     next to a control that proves the same stub sees an allowed call;
//   * the POST path and body; the receipt passes through untouched;
//   * a backend refusal (terms outdated, not the operator) stays structured, not "API 409";
//   * no fee, rate or price in the tool's text.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const BASE = 'http://127.0.0.1:1';
const TOOL = 'accept_capacity_intro';
const LEAD = 'LD-0123456789';
const FEE_RE = /\bfee\b|%|\$\s?\d|\bpercent/i;
const RECEIPT = {
  lead_id: LEAD, buyer_registered_at: '2026-11-18T10:00:00Z', accepted_at: '2026-11-20T12:00:00Z',
  operator_terms_version: '2026-11-13', ledger: { seq: 42, entry_hash: 'ab'.repeat(32) },
};

let S, TOOLS, realFetch, calls = [], responder = null;
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' } });

async function load() {
  vi.resetModules();
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  const mod = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  return mod;
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let pathname = '';
    try { pathname = new URL(url).pathname; } catch { /* not a URL */ }
    let body;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const rec = { url, pathname, method: String(init.method || 'GET').toUpperCase(), body };
    calls.push(rec);
    if (pathname.startsWith('/api/v1/listings')) {
      if (!responder) throw new Error(`unexpected listings call: ${rec.method} ${url}`);
      return responder(rec);
    }
    return json(200, {});
  };
  S = await load();
  TOOLS = S.createServer()._registeredTools;
}, 60_000);

afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; responder = null; });

const listingCalls = () => calls.filter((c) => c.pathname.startsWith('/api/v1/listings'));
const seat = { api_key: 'dch_live_operator_test', tier: 'free', platform: 'claude',
  client_name_raw: 'claude-ai', client_ip: '203.0.113.9', session_id: 'sess-operator' };
async function call(args) {
  const T = TOOLS[TOOL];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const payload = (r) => r.structuredContent || JSON.parse(r.content[0].text);

describe('accept_capacity_intro', () => {
  it('is registered as a write tool', () => {
    expect(TOOLS[TOOL]).toBeDefined();
    expect(TOOLS[TOOL].annotations.readOnlyHint).toBe(false);
  });

  it('relays the backend not_enabled answer (flag off) as a structured refusal', async () => {
    responder = () => json(404, { ok: false, error: 'not_enabled',
      message: 'Accepting a registration by lead id is not switched on yet. Use the accept link in DC Hub\'s lead email.' });
    const r = await call({ lead_id: LEAD, confirm: true });
    const text = r.content.map((c) => c.text || '').join('\n');
    expect(listingCalls()).toHaveLength(1);
    expect(text).toContain('not_enabled');
    expect(text).toContain('accept link');
    expect(text).not.toMatch(/"error":\s*"API 404"/);
  });

  it('sends nothing without confirm=true or with a malformed lead id', async () => {
    for (const args of [{ lead_id: LEAD }, { lead_id: LEAD, confirm: false },
      { lead_id: 'LD-123', confirm: true }, { lead_id: '../admin', confirm: true }]) {
      const out = payload(await call(args));
      expect(out.sent).toBe(false);
      expect(['operator_confirmation_required', 'invalid_lead_id']).toContain(out.error);
    }
    expect(listingCalls()).toHaveLength(0);
  });

  it('POSTs the accept and passes the receipt through (control for the gate above)', async () => {
    responder = () => json(200, { ok: true, lead_id: LEAD, decision: 'accept', status: 'accepted',
      duplicate: false, receipt: RECEIPT });
    const out = payload(await call({ lead_id: LEAD.toLowerCase(), confirm: true, note: '  Call me.  ' }));
    const [c] = listingCalls();
    expect([c.method, c.pathname]).toEqual(['POST', `/api/v1/listings/leads/${LEAD}/accept`]);
    expect(c.body).toEqual({ note: 'Call me.' });
    expect(out.receipt).toEqual(RECEIPT);
  });

  it('keeps a backend refusal structured', async () => {
    responder = () => json(409, { ok: false, error: 'operator_terms_outdated',
      message: 'The listing terms were updated to version 2026-11-13. Accept them first.',
      operator_terms: { current_version: '2026-11-13',
        accept: { method: 'POST', path: '/api/v1/listings/dfw-40/operator-terms/accept' } } });
    const r = await call({ lead_id: LEAD, confirm: true });
    const text = r.content.map((c) => c.text || '').join('\n');
    expect(text).toContain('operator_terms_outdated');
    expect(text).not.toMatch(/"error":\s*"API 409"/);
  });

  it('names no fee, rate or price', () => {
    const T = TOOLS[TOOL];
    const shape = JSON.stringify(T.inputSchema?._def ?? {});
    expect(T.description).not.toMatch(FEE_RE);
    expect(shape).not.toMatch(FEE_RE);
  });
});
